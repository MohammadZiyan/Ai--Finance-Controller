"""
Inference module for AI Finance Controller.
Runs single-transaction or batch predictions using trained models.
Generates risk scores, predicted exception classes, and explainability evidence.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd

# Local module import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("predict")


class FinanceAnomalyPredictor:
    """Predictor class that loads models and computes reconciliation risk scores."""

    def __init__(self, model_dir: Optional[str] = None):
        if model_dir is None:
            model_dir = os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "models"
            )

        self.model_dir = model_dir
        self.bin_model_path = os.path.join(model_dir, "binary_model.joblib")
        self.multi_model_path = os.path.join(model_dir, "multiclass_model.joblib")
        self.le_path = os.path.join(model_dir, "label_encoder.joblib")
        self.features_path = os.path.join(model_dir, "feature_columns.json")

        if not os.path.exists(self.bin_model_path):
            raise FileNotFoundError(
                f"Trained binary model not found at {self.bin_model_path}. "
                f"Please run 'python ml/train_model.py' first."
            )

        logger.info("Loading models from: %s", model_dir)
        self.binary_model = joblib.load(self.bin_model_path)
        self.multi_model = joblib.load(self.multi_model_path)
        self.label_encoder = joblib.load(self.le_path)

        with open(self.features_path, "r", encoding="utf-8") as f:
            self.feature_columns = json.load(f)

    def _build_feature_row(self, record: Dict[str, Any]) -> pd.DataFrame:
        """Construct a single-row DataFrame conforming to the trained feature schema."""
        amount = float(record.get("amount", 0.0))
        gross_amount = record.get("gross_amount")
        gross = float(gross_amount) if gross_amount is not None else np.nan

        fees = float(record.get("fees", 0.0))
        tax = float(record.get("tax", 0.0))
        net_amount = float(record.get("net_amount", 0.0))
        avg_amt = float(record.get("avg_transaction_amount", amount))
        status = str(record.get("status", "captured")).lower()

        # Engineered signals
        captured_missing_settlement = 1 if (status == "captured" and np.isnan(gross)) else 0
        settlement_net_diff = ((gross - fees - tax) - net_amount) if not np.isnan(gross) else 0.0
        pay_gross_diff = (amount - gross) if not np.isnan(gross) else 0.0
        fee_rate = (fees / (gross + 1e-5)) if not np.isnan(gross) else 0.0
        tax_fee_ratio = (tax / (fees + 1e-5)) if fees > 0 else 0.0
        amount_to_avg_ratio = amount / (avg_amt + 1e-5)

        row_data = {
            "amount": amount,
            "international": int(record.get("international", 0)),
            "order_repeat_count": int(record.get("order_repeat_count", 1)),
            "captured_missing_settlement": captured_missing_settlement,
            "settlement_net_diff": settlement_net_diff,
            "pay_gross_diff": pay_gross_diff,
            "fee_rate": fee_rate,
            "tax_fee_ratio": tax_fee_ratio,
            "amount_to_avg_ratio": amount_to_avg_ratio,
            "risk_score": float(record.get("risk_score", 0.2)),
            "avg_transaction_amount": avg_amt,
            "pay_ord_delay_sec": float(record.get("pay_ord_delay_sec", 0.0)),
            "set_pay_delay_days": float(record.get("set_pay_delay_days", 1.0)),
            "hour": int(record.get("hour", 12)),
            "dayofweek": int(record.get("dayofweek", 2)),
            "has_dispute": int(record.get("has_dispute", 0)),
            "has_refund": int(record.get("has_refund", 0)),
            "refund_to_pay_ratio": float(record.get("refund_to_pay_ratio", 0.0)),
            "method": str(record.get("method", "card")).lower(),
            "status": status,
            "bank": str(record.get("bank", "HDFC")),
            "business_type": str(record.get("business_type", "ecommerce")).lower(),
        }

        df = pd.DataFrame([row_data])
        for col in ["method", "status", "bank", "business_type"]:
            df[col] = df[col].astype("category")

        return df[self.feature_columns]

    def predict_single(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Generate prediction, risk score, and explainability for a single transaction."""
        X = self._build_feature_row(record)

        # Binary risk prediction
        prob = float(self.binary_model.predict_proba(X)[0, 1])
        is_anomaly = bool(prob >= 0.50)

        # Multi-class taxonomy prediction
        multi_pred_enc = self.multi_model.predict(X)[0]
        multi_probs = self.multi_model.predict_proba(X)[0]
        anomaly_type = str(self.label_encoder.inverse_transform([multi_pred_enc])[0])

        # Explainable risk flags
        risk_flags: List[str] = []
        if X["captured_missing_settlement"].iloc[0] == 1:
            risk_flags.append("MISSING_SETTLEMENT: Payment captured but settlement record absent")
        if abs(X["settlement_net_diff"].iloc[0]) > 0.5:
            diff = X["settlement_net_diff"].iloc[0]
            risk_flags.append(f"SETTLEMENT_MISMATCH: Net settlement deviates by INR {diff:.2f}")
        if X["order_repeat_count"].iloc[0] > 1:
            cnt = X["order_repeat_count"].iloc[0]
            risk_flags.append(f"DUPLICATE_PAYMENT: Order ID repeated {cnt} times")
        if X["fee_rate"].iloc[0] > 0.045:
            rate = X["fee_rate"].iloc[0] * 100
            risk_flags.append(f"FEE_RATE_ABNORMAL: Effective fee rate is {rate:.2f}% (standard ~2%)")
        if X["amount_to_avg_ratio"].iloc[0] > 5.0:
            ratio = X["amount_to_avg_ratio"].iloc[0]
            risk_flags.append(f"UNUSUAL_VOLUME: Amount is {ratio:.1f}x higher than merchant avg")
        if X["has_dispute"].iloc[0] == 1:
            risk_flags.append("CHARGEBACK_RISK: Dispute record linked to payment")

        # Recommendation
        if not is_anomaly and prob < 0.25:
            recommendation = "AUTO_RESOLVE"
        elif prob < 0.75:
            recommendation = "HUMAN_REVIEW"
        else:
            recommendation = "UNRESOLVED_EXCEPTION"

        return {
            "is_anomaly": is_anomaly,
            "risk_score": round(prob, 4),
            "predicted_anomaly_type": anomaly_type if is_anomaly else "none",
            "confidence": round(float(np.max(multi_probs)), 4),
            "recommendation": recommendation,
            "risk_flags": risk_flags,
        }

    def predict_batch_from_csv(self, input_csv: str, output_csv: str) -> pd.DataFrame:
        """Run batch inference over a CSV file and output augmented predictions."""
        logger.info("Reading input CSV: %s", input_csv)
        df = pd.read_csv(input_csv)

        results = []
        for _, row in df.iterrows():
            pred = self.predict_single(row.to_dict())
            results.append(pred)

        res_df = pd.DataFrame(results)
        output_df = pd.concat([df.reset_index(drop=True), res_df], axis=1)

        os.makedirs(os.path.dirname(output_csv) or ".", exist_ok=True)
        output_df.to_csv(output_csv, index=False)
        logger.info("Batch inference saved to: %s (%d rows)", output_csv, len(output_df))
        return output_df

    def predict_from_dataset(self, data_dir: str, split: str = "test", limit: Optional[int] = None) -> pd.DataFrame:
        """Run inference on the multi-table dataset for a specific split."""
        from ml.data_loader import extract_features, load_raw_dataset
        tables = load_raw_dataset(data_dir)
        df = extract_features(tables)
        if split:
            df = df[df["split"] == split].copy()
        if limit:
            df = df.head(limit).copy()

        results = []
        for _, row in df.iterrows():
            pred = self.predict_single(row.to_dict())
            results.append(pred)

        res_df = pd.DataFrame(results)
        return pd.concat([df.reset_index(drop=True), res_df], axis=1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run AI Finance Controller Inference")
    parser.add_argument("--model-dir", type=str, default=None, help="Directory containing saved models")
    parser.add_argument("--input-csv", type=str, default=None, help="CSV file for batch prediction")
    parser.add_argument("--output-csv", type=str, default=None, help="Output destination CSV file")
    parser.add_argument("--data-dir", type=str, default=None, help="Path to 100k multi-table dataset directory")
    parser.add_argument("--split", type=str, default="test", help="Dataset split (train, validation, test)")
    parser.add_argument("--limit", type=int, default=20, help="Number of records to evaluate")
    args = parser.parse_args()

    predictor = FinanceAnomalyPredictor(args.model_dir)

    if args.data_dir:
        res = predictor.predict_from_dataset(args.data_dir, split=args.split, limit=args.limit)
        print(f"\n--- Evaluated {len(res)} records from {args.split} split ---")
        cols = ["payment_id", "amount", "is_anomaly", "risk_score", "predicted_anomaly_type", "recommendation"]
        print(res[cols].to_string(index=False))
        if args.output_csv:
            res.to_csv(args.output_csv, index=False)
            print(f"Results saved to {args.output_csv}")
    elif args.input_csv and args.output_csv:
        predictor.predict_batch_from_csv(args.input_csv, args.output_csv)
    else:
        # Run demo test scenarios
        print("\n--- Running Demo Inference Scenarios ---")
        demo_cases = [
            {
                "case_name": "Normal UPI Payment",
                "record": {
                    "amount": 1500.0,
                    "gross_amount": 1500.0,
                    "fees": 30.0,
                    "tax": 5.4,
                    "net_amount": 1464.6,
                    "avg_transaction_amount": 1400.0,
                    "risk_score": 0.15,
                    "method": "upi",
                    "bank": "HDFC",
                    "status": "captured",
                },
            },
            {
                "case_name": "Settlement Net Discrepancy",
                "record": {
                    "amount": 2500.0,
                    "gross_amount": 2500.0,
                    "fees": 50.0,
                    "tax": 9.0,
                    "net_amount": 2100.0,  # ₹341 missing
                    "avg_transaction_amount": 2400.0,
                    "risk_score": 0.25,
                    "method": "card",
                    "bank": "ICICI",
                    "status": "captured",
                },
            },
            {
                "case_name": "Unusual Amount Spike (20x merchant avg)",
                "record": {
                    "amount": 65000.0,
                    "gross_amount": 2500.0,
                    "fees": 50.0,
                    "tax": 9.0,
                    "net_amount": 2441.0,
                    "avg_transaction_amount": 2200.0,
                    "risk_score": 0.35,
                    "method": "card",
                    "bank": "SBI",
                    "status": "captured",
                },
            },
            {
                "case_name": "Missing Settlement on Captured Payment",
                "record": {
                    "amount": 1200.0,
                    "gross_amount": None,
                    "avg_transaction_amount": 1300.0,
                    "risk_score": 0.2,
                    "method": "upi",
                    "bank": "Axis",
                    "status": "captured",
                },
            },
        ]

        for demo in demo_cases:
            res = predictor.predict_single(demo["record"])
            print(f"\nScenario: {demo['case_name']}")
            print(f"  * Is Anomaly:      {res['is_anomaly']}")
            print(f"  * Risk Score:      {res['risk_score'] * 100:.1f}%")
            print(f"  * Exception Type:  {res['predicted_anomaly_type']}")
            print(f"  * Recommendation:  {res['recommendation']}")
            if res["risk_flags"]:
                print("  * Risk Flags:")
                for rf in res["risk_flags"]:
                    print(f"    - {rf}")


if __name__ == "__main__":
    main()
