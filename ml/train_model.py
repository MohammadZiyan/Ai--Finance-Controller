"""
Model training and evaluation pipeline for AI Finance Controller.
Trains gradient-boosted models on the multi-table finance dataset (500K / 100K):
1. Binary Anomaly Classifier: predicts whether a transaction has an anomaly / exception.
2. Multi-Class Exception Classifier: predicts the exact category of financial anomaly.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.preprocessing import LabelEncoder

# Local module import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ml.data_loader import (
    FEATURE_COLUMNS,
    extract_features,
    load_raw_dataset,
    prepare_train_val_test_splits,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("train_model")


def train_and_evaluate(
    data_dir: str,
    output_dir: str,
    n_estimators: int = 120,
    learning_rate: float = 0.1,
) -> Dict[str, Any]:
    """Train binary and multi-class anomaly models and evaluate on the test split."""
    os.makedirs(output_dir, exist_ok=True)

    # 1. Load and prepare data
    logger.info("Starting dataset loading from: %s", data_dir)
    tables = load_raw_dataset(data_dir)
    df = extract_features(tables)

    (
        X_train, y_bin_train, y_multi_train,
        X_val, y_bin_val, y_multi_val,
        X_test, y_bin_test, y_multi_test,
    ) = prepare_train_val_test_splits(df)

    # 2. Train Binary Anomaly Detection Model
    logger.info("--- Training Binary Anomaly Detection Model ---")
    bin_model = lgb.LGBMClassifier(
        n_estimators=n_estimators,
        learning_rate=learning_rate,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
        verbose=-1,
    )
    bin_model.fit(
        X_train,
        y_bin_train,
        eval_set=[(X_val, y_bin_val)],
        callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)],
    )

    # Evaluate Binary Model on Test Split
    bin_test_probs = bin_model.predict_proba(X_test)[:, 1]
    bin_test_preds = bin_model.predict(X_test)

    bin_auc = float(roc_auc_score(y_bin_test, bin_test_probs))
    bin_acc = float(accuracy_score(y_bin_test, bin_test_preds))
    bin_prec = float(precision_score(y_bin_test, bin_test_preds, zero_division=0))
    bin_rec = float(recall_score(y_bin_test, bin_test_preds, zero_division=0))
    bin_f1 = float(f1_score(y_bin_test, bin_test_preds, zero_division=0))
    bin_cm = confusion_matrix(y_bin_test, bin_test_preds).tolist()

    logger.info("Binary Test Results: ROC-AUC=%.4f, F1=%.4f, Precision=%.4f, Recall=%.4f, Acc=%.4f",
                bin_auc, bin_f1, bin_prec, bin_rec, bin_acc)

    # 3. Train Multi-Class Exception Classifier
    logger.info("--- Training Multi-Class Exception Classifier ---")
    label_encoder = LabelEncoder()
    y_multi_train_enc = label_encoder.fit_transform(y_multi_train)
    y_multi_val_enc = label_encoder.transform(y_multi_val)
    y_multi_test_enc = label_encoder.transform(y_multi_test)

    multi_model = lgb.LGBMClassifier(
        n_estimators=n_estimators,
        learning_rate=learning_rate,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
        verbose=-1,
    )
    multi_model.fit(
        X_train,
        y_multi_train_enc,
        eval_set=[(X_val, y_multi_val_enc)],
        callbacks=[lgb.early_stopping(stopping_rounds=15, verbose=False)],
    )

    multi_test_preds = multi_model.predict(X_test)
    multi_macro_f1 = float(f1_score(y_multi_test_enc, multi_test_preds, average="macro"))
    multi_weighted_f1 = float(f1_score(y_multi_test_enc, multi_test_preds, average="weighted"))
    multi_acc = float(accuracy_score(y_multi_test_enc, multi_test_preds))

    cls_report = classification_report(
        y_multi_test_enc,
        multi_test_preds,
        target_names=label_encoder.classes_,
        output_dict=True,
    )
    cls_report_text = classification_report(
        y_multi_test_enc,
        multi_test_preds,
        target_names=label_encoder.classes_,
    )

    logger.info("Multi-class Test Results: Macro F1=%.4f, Weighted F1=%.4f, Acc=%.4f",
                multi_macro_f1, multi_weighted_f1, multi_acc)

    # 4. Feature Importance
    importances = pd.DataFrame({
        "feature": FEATURE_COLUMNS,
        "binary_importance": bin_model.feature_importances_,
        "multiclass_importance": multi_model.feature_importances_,
    }).sort_values("binary_importance", ascending=False)

    top_features = importances.to_dict(orient="records")

    # 5. Save Artifacts
    bin_model_path = os.path.join(output_dir, "binary_model.joblib")
    multi_model_path = os.path.join(output_dir, "multiclass_model.joblib")
    le_path = os.path.join(output_dir, "label_encoder.joblib")
    features_path = os.path.join(output_dir, "feature_columns.json")
    report_path = os.path.join(output_dir, "evaluation_report.json")
    text_report_path = os.path.join(output_dir, "classification_report.txt")

    logger.info("Saving models and evaluation artifacts to %s...", output_dir)
    joblib.dump(bin_model, bin_model_path)
    joblib.dump(multi_model, multi_model_path)
    joblib.dump(label_encoder, le_path)

    with open(features_path, "w", encoding="utf-8") as f:
        json.dump(FEATURE_COLUMNS, f, indent=2)

    with open(text_report_path, "w", encoding="utf-8") as f:
        f.write("=== AI Finance Controller ML Evaluation Report ===\n\n")
        f.write("--- Binary Model (is_anomaly) ---\n")
        f.write(f"ROC-AUC: {bin_auc:.4f}\n")
        f.write(f"Accuracy: {bin_acc:.4f}\n")
        f.write(f"Precision: {bin_prec:.4f}\n")
        f.write(f"Recall: {bin_rec:.4f}\n")
        f.write(f"F1 Score: {bin_f1:.4f}\n")
        f.write(f"Confusion Matrix:\n{np.array(bin_cm)}\n\n")
        f.write("--- Multi-Class Exception Classifier ---\n")
        f.write(cls_report_text)
        f.write("\n\n--- Top 10 Feature Importances ---\n")
        for item in top_features[:10]:
            f.write(f"  {item['feature']}: binary={item['binary_importance']}, multiclass={item['multiclass_importance']}\n")

    report: Dict[str, Any] = {
        "dataset_size": len(df),
        "train_size": len(X_train),
        "validation_size": len(X_val),
        "test_size": len(X_test),
        "binary_metrics": {
            "roc_auc": bin_auc,
            "accuracy": bin_acc,
            "precision": bin_prec,
            "recall": bin_rec,
            "f1": bin_f1,
            "confusion_matrix": bin_cm,
        },
        "multiclass_metrics": {
            "accuracy": multi_acc,
            "macro_f1": multi_macro_f1,
            "weighted_f1": multi_weighted_f1,
            "per_class": cls_report,
        },
        "top_features": top_features[:10],
    }

    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    logger.info("Training pipeline completed successfully.")
    return report


DEFAULT_DATA_DIR = (
    r"C:\Users\ziyan\Downloads\ai_finance_controller_500k_dataset"
    if os.path.exists(r"C:\Users\ziyan\Downloads\ai_finance_controller_500k_dataset")
    else r"C:\Users\ziyan\Downloads\ai_finance_controller_100k_dataset"
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train AI Finance Controller ML models")
    parser.add_argument(
        "--data-dir",
        type=str,
        default=DEFAULT_DATA_DIR,
        help="Path to folder containing CSV files (defaults to 500k if available, else 100k)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"),
        help="Output directory to save models and metrics",
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=120,
        help="Number of boosting trees",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=0.1,
        help="Learning rate",
    )
    args = parser.parse_args()

    report = train_and_evaluate(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        n_estimators=args.n_estimators,
        learning_rate=args.learning_rate,
    )

    print("\n" + "=" * 60)
    print("      AI FINANCE CONTROLLER - ML EVALUATION SUMMARY      ")
    print("=" * 60)
    print(f"Total Dataset: {report['dataset_size']:,} records")
    print(f"Train / Val / Test: {report['train_size']:,} / {report['validation_size']:,} / {report['test_size']:,}")
    print("\n[1] Binary Risk Detection Model (Normal vs Anomaly):")
    print(f"  * ROC-AUC Score:      {report['binary_metrics']['roc_auc']:.4f}")
    print(f"  * Precision:          {report['binary_metrics']['precision'] * 100:.2f}%")
    print(f"  * Recall:             {report['binary_metrics']['recall'] * 100:.2f}%")
    print(f"  * F1-Score:           {report['binary_metrics']['f1'] * 100:.2f}%")
    print(f"  * Overall Accuracy:   {report['binary_metrics']['accuracy'] * 100:.2f}%")
    print("\n[2] Multi-Class Exception Classifier:")
    print(f"  * Overall Accuracy:   {report['multiclass_metrics']['accuracy'] * 100:.2f}%")
    print(f"  * Weighted F1-Score:  {report['multiclass_metrics']['weighted_f1'] * 100:.2f}%")
    print(f"  * Macro F1-Score:     {report['multiclass_metrics']['macro_f1'] * 100:.2f}%")
    print("\n[3] Key Feature Drivers:")
    for f in report["top_features"][:5]:
        print(f"  * {f['feature']:<28} (importance: {f['binary_importance']})")
    print("=" * 60)


if __name__ == "__main__":
    main()
