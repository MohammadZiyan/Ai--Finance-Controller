"""
Data ingestion and feature engineering pipeline for AI Finance Controller.
Loads multi-source financial reconciliation datasets (payments, settlements,
orders, ledger, merchants, customers, refunds, disputes) and extracts
reconciliation and anomaly detection signals.
"""

from __future__ import annotations

import os
import logging
from typing import Dict, List, Tuple
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)


FEATURE_COLUMNS = [
    "amount",
    "international",
    "order_repeat_count",
    "captured_missing_settlement",
    "settlement_net_diff",
    "pay_gross_diff",
    "fee_rate",
    "tax_fee_ratio",
    "amount_to_avg_ratio",
    "risk_score",
    "avg_transaction_amount",
    "pay_ord_delay_sec",
    "set_pay_delay_days",
    "hour",
    "dayofweek",
    "has_dispute",
    "has_refund",
    "refund_to_pay_ratio",
    "method",
    "status",
    "bank",
    "business_type",
]

CATEGORICAL_COLUMNS = [
    "method",
    "status",
    "bank",
    "business_type",
]


def load_raw_dataset(data_dir: str) -> Dict[str, pd.DataFrame]:
    """Load all raw CSV tables from the dataset directory."""
    files = {
        "payments": "payments.csv",
        "orders": "orders.csv",
        "settlements": "settlements.csv",
        "merchants": "merchants.csv",
        "customers": "customers.csv",
        "refunds": "refunds.csv",
        "disputes": "disputes.csv",
        "labels": "anomaly_labels.csv",
    }

    tables: Dict[str, pd.DataFrame] = {}
    for key, filename in files.items():
        filepath = os.path.join(data_dir, filename)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Required dataset file not found: {filepath}")
        logger.info("Loading %s...", filename)
        tables[key] = pd.read_csv(filepath)

    return tables


def extract_features(tables: Dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Perform multi-table relational feature engineering across all transaction streams.
    """
    payments = tables["payments"]
    orders = tables["orders"]
    settlements = tables["settlements"]
    merchants = tables["merchants"]
    refunds = tables["refunds"]
    disputes = tables["disputes"]
    labels = tables["labels"]

    logger.info("Merging transaction streams (payments: %d)...", len(payments))

    # Base join with labels
    df = payments.merge(labels, on="payment_id", how="left")

    # Merge Orders
    ord_sub = orders[["order_id", "amount", "created_at", "status"]].rename(
        columns={
            "amount": "ord_amount",
            "created_at": "ord_created_at",
            "status": "ord_status",
        }
    )
    df = df.merge(ord_sub, on="order_id", how="left")

    # Merge Settlements
    set_sub = settlements[
        ["payment_id", "gross_amount", "fees", "tax", "net_amount", "settlement_date"]
    ]
    df = df.merge(set_sub, on="payment_id", how="left")

    # Merge Merchants
    mrc_sub = merchants[
        ["merchant_id", "risk_score", "avg_transaction_amount", "business_type"]
    ]
    df = df.merge(mrc_sub, on="merchant_id", how="left")

    # Merge Refunds & Disputes aggregations
    ref_amt = refunds.groupby("payment_id")["amount"].sum()
    ref_pids = set(refunds["payment_id"])
    df["has_refund"] = df["payment_id"].isin(ref_pids).astype(int)
    df["refund_amount"] = df["payment_id"].map(ref_amt).fillna(0.0)
    df["refund_to_pay_ratio"] = df["refund_amount"] / (df["amount"] + 1e-5)

    disp_pids = set(disputes["payment_id"])
    df["has_dispute"] = df["payment_id"].isin(disp_pids).astype(int)

    # 1. Duplicate order signals
    order_counts = payments["order_id"].value_counts()
    df["order_repeat_count"] = df["order_id"].map(order_counts).fillna(1)

    # 2. Missing settlement signal
    df["captured_missing_settlement"] = (
        (df["status"] == "captured") & (df["gross_amount"].isna())
    ).astype(int)

    # 3. Settlement math reconciliation discrepancy
    df["settlement_net_diff"] = (
        (df["gross_amount"] - df["fees"] - df["tax"]) - df["net_amount"]
    ).fillna(0.0)

    # 4. Payment vs Settlement gross discrepancy
    df["pay_gross_diff"] = (df["amount"] - df["gross_amount"]).fillna(0.0)

    # 5. Fee & Tax ratios
    df["fee_rate"] = (df["fees"] / (df["gross_amount"] + 1e-5)).fillna(0.0)
    df["tax_fee_ratio"] = (df["tax"] / (df["fees"] + 1e-5)).fillna(0.0)

    # 6. Merchant volume deviation
    df["amount_to_avg_ratio"] = df["amount"] / (
        df["avg_transaction_amount"] + 1e-5
    )

    # 7. Temporal features
    df["pay_dt"] = pd.to_datetime(df["created_at"])
    df["ord_dt"] = pd.to_datetime(df["ord_created_at"])
    df["set_dt"] = pd.to_datetime(df["settlement_date"])

    df["pay_ord_delay_sec"] = (
        (df["pay_dt"] - df["ord_dt"]).dt.total_seconds().fillna(0.0)
    )
    df["set_pay_delay_days"] = (
        ((df["set_dt"] - df["pay_dt"]).dt.total_seconds() / 86400.0).fillna(0.0)
    )
    df["hour"] = df["pay_dt"].dt.hour
    df["dayofweek"] = df["pay_dt"].dt.dayofweek

    # Categorical columns
    for col in CATEGORICAL_COLUMNS:
        df[col] = df[col].astype("category")

    logger.info("Feature engineering complete. Dataset shape: %s", df.shape)
    return df


def prepare_train_val_test_splits(
    df: pd.DataFrame,
) -> Tuple[
    pd.DataFrame, pd.Series, pd.Series,
    pd.DataFrame, pd.Series, pd.Series,
    pd.DataFrame, pd.Series, pd.Series,
]:
    """
    Split the dataset into Train, Validation, and Test sets using the
    predefined 'split' column in anomaly_labels.csv.
    """
    train_mask = df["split"] == "train"
    val_mask = df["split"] == "validation"
    test_mask = df["split"] == "test"

    X_train = df.loc[train_mask, FEATURE_COLUMNS]
    y_bin_train = df.loc[train_mask, "is_anomaly"]
    y_multi_train = df.loc[train_mask, "anomaly_type"]

    X_val = df.loc[val_mask, FEATURE_COLUMNS]
    y_bin_val = df.loc[val_mask, "is_anomaly"]
    y_multi_val = df.loc[val_mask, "anomaly_type"]

    X_test = df.loc[test_mask, FEATURE_COLUMNS]
    y_bin_test = df.loc[test_mask, "is_anomaly"]
    y_multi_test = df.loc[test_mask, "anomaly_type"]

    logger.info(
        "Splits prepared: Train=%d, Validation=%d, Test=%d",
        len(X_train),
        len(X_val),
        len(X_test),
    )

    return (
        X_train, y_bin_train, y_multi_train,
        X_val, y_bin_val, y_multi_val,
        X_test, y_bin_test, y_multi_test,
    )
