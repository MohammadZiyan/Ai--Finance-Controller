import type { BankTransaction, Currency, LedgerEntry, PaymentRecord } from "@/lib/finance/types";

function parseCsvRows(csvText: string): Record<string, string>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i]!.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = parts[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function requireColumns(rows: Record<string, string>[], columns: string[], sourceName: string): void {
  if (rows.length === 0) {
    throw new Error(`${sourceName}: CSV has no data rows`);
  }

  const first = rows[0]!;
  const missing = columns.filter((col) => !(col in first));
  if (missing.length > 0) {
    throw new Error(`${sourceName}: missing required columns: ${missing.join(", ")}`);
  }
}

export function parseBankCsv(csvText: string): BankTransaction[] {
  const rows = parseCsvRows(csvText);
  requireColumns(
    rows,
    [
      "bank_transaction_id",
      "transaction_date",
      "value_date",
      "description",
      "reference",
      "amount",
      "currency",
      "transaction_type",
      "account_number_masked",
    ],
    "bank",
  );

  return rows.map((row) => ({
    bank_transaction_id: row.bank_transaction_id,
    transaction_date: row.transaction_date,
    value_date: row.value_date,
    description: row.description,
    reference: row.reference,
    amount: Number(row.amount),
    currency: row.currency as Currency,
    transaction_type: row.transaction_type as "DEBIT" | "CREDIT",
    account_number_masked: row.account_number_masked,
  }));
}

export function parseLedgerCsv(csvText: string): LedgerEntry[] {
  const rows = parseCsvRows(csvText);
  requireColumns(
    rows,
    [
      "ledger_entry_id",
      "transaction_date",
      "description",
      "invoice_number",
      "amount",
      "currency",
      "accounting_category",
      "vendor",
    ],
    "ledger",
  );

  return rows.map((row) => ({
    ledger_entry_id: row.ledger_entry_id,
    transaction_date: row.transaction_date,
    description: row.description,
    invoice_number: row.invoice_number,
    amount: Number(row.amount),
    currency: row.currency as Currency,
    accounting_category: row.accounting_category,
    vendor: row.vendor,
  }));
}

export function parsePaymentCsv(csvText: string): PaymentRecord[] {
  const rows = parseCsvRows(csvText);
  requireColumns(
    rows,
    ["payment_id", "payment_date", "merchant", "reference", "amount", "currency", "status", "settlement_date"],
    "payment",
  );

  return rows.map((row) => ({
    payment_id: row.payment_id,
    payment_date: row.payment_date,
    merchant: row.merchant,
    reference: row.reference,
    amount: Number(row.amount),
    currency: row.currency as Currency,
    status: row.status as "SETTLED" | "PENDING" | "FAILED",
    settlement_date: row.settlement_date,
    fee_amount: row.fee_amount ? Number(row.fee_amount) : 0,
  }));
}
