import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  batchName: text("batch_name").notNull(),
  sourceType: text("source_type").notNull().default("synthetic"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordsProcessed: integer("records_processed").notNull().default(0),
  ruleProcessingMs: integer("rule_processing_ms").notNull().default(0),
  aiProcessingMs: integer("ai_processing_ms").notNull().default(0),
  totalProcessingMs: integer("total_processing_ms").notNull().default(0),
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  bankTransactionId: text("bank_transaction_id").notNull(),
  transactionDate: date("transaction_date").notNull(),
  valueDate: date("value_date").notNull(),
  description: text("description").notNull(),
  reference: text("reference"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  transactionType: text("transaction_type").notNull(),
  accountNumberMasked: text("account_number_masked").notNull(),
  normalizedMerchant: text("normalized_merchant").notNull(),
  normalizedReference: text("normalized_reference"),
  syntheticTxnId: text("synthetic_txn_id"),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  ledgerEntryId: text("ledger_entry_id").notNull(),
  transactionDate: date("transaction_date").notNull(),
  description: text("description").notNull(),
  invoiceNumber: text("invoice_number"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  accountingCategory: text("accounting_category").notNull(),
  vendor: text("vendor").notNull(),
  normalizedMerchant: text("normalized_merchant").notNull(),
  normalizedReference: text("normalized_reference"),
  syntheticTxnId: text("synthetic_txn_id"),
});

export const paymentRecords = pgTable("payment_records", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  paymentId: text("payment_id").notNull(),
  paymentDate: date("payment_date").notNull(),
  merchant: text("merchant").notNull(),
  reference: text("reference"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: text("status").notNull(),
  settlementDate: date("settlement_date").notNull(),
  feeAmount: numeric("fee_amount", { precision: 14, scale: 2 }),
  normalizedMerchant: text("normalized_merchant").notNull(),
  normalizedReference: text("normalized_reference"),
  syntheticTxnId: text("synthetic_txn_id"),
});

export const reconciliationResults = pgTable("reconciliation_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  bankRecordId: integer("bank_record_id").references(() => bankTransactions.id, {
    onDelete: "set null",
  }),
  ledgerRecordId: integer("ledger_record_id").references(() => ledgerEntries.id, {
    onDelete: "set null",
  }),
  paymentRecordIds: jsonb("payment_record_ids").$type<number[]>().notNull().default([]),
  status: text("status").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  decisionMethod: text("decision_method").notNull(),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  recommendedAction: text("recommended_action").notNull(),
  expectedStatus: text("expected_status"),
  isCorrect: boolean("is_correct"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  exceptionId: text("exception_id").notNull(),
  transactionId: text("transaction_id").notNull(),
  exceptionType: text("exception_type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("OPEN"),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  amountDifference: numeric("amount_difference", { precision: 14, scale: 2 }),
  dateDifferenceDays: integer("date_difference_days"),
  reason: text("reason").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  sourceRecords: jsonb("source_records")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  humanDecision: text("human_decision"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditTrail = pgTable("audit_trail", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  transactionId: text("transaction_id").notNull(),
  stage: text("stage").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
