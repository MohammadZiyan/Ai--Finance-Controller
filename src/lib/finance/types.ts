export type Currency = "INR" | "USD" | "EUR";

export type ExceptionType =
  | "AMOUNT_MISMATCH"
  | "MISSING_LEDGER_RECORD"
  | "MISSING_BANK_RECORD"
  | "MISSING_PAYMENT_RECORD"
  | "DUPLICATE"
  | "AMBIGUOUS_MATCH"
  | "PARTIAL_PAYMENT"
  | "UNEXPECTED_FEE"
  | "CURRENCY_MISMATCH"
  | "UNRESOLVED";

export type ReconciliationStatus = "MATCHED" | "AI_MATCHED" | "REVIEW" | "UNRESOLVED";

export interface BankTransaction {
  bank_transaction_id: string;
  transaction_date: string;
  value_date: string;
  description: string;
  reference: string;
  amount: number;
  currency: Currency;
  transaction_type: "DEBIT" | "CREDIT";
  account_number_masked: string;
  synthetic_txn_id?: string;
}

export interface LedgerEntry {
  ledger_entry_id: string;
  transaction_date: string;
  description: string;
  invoice_number: string;
  amount: number;
  currency: Currency;
  accounting_category: string;
  vendor: string;
  synthetic_txn_id?: string;
}

export interface PaymentRecord {
  payment_id: string;
  payment_date: string;
  merchant: string;
  reference: string;
  amount: number;
  currency: Currency;
  status: "SETTLED" | "PENDING" | "FAILED";
  settlement_date: string;
  fee_amount?: number;
  synthetic_txn_id?: string;
}

export interface GroundTruthRecord {
  transaction_id: string;
  expected_status: ReconciliationStatus;
  expected_exception_type: ExceptionType | null;
  scenario: string;
}

export interface DatasetBundle {
  bank: BankTransaction[];
  ledger: LedgerEntry[];
  payments: PaymentRecord[];
  groundTruth: GroundTruthRecord[];
}

export interface ReconciliationThresholds {
  high: number;
  medium: number;
}

export interface ScoreWeights {
  description: number;
  amount: number;
  date: number;
  reference: number;
  consistency: number;
}

export interface ReconciliationConfig {
  thresholds: ReconciliationThresholds;
  weights: ScoreWeights;
  dateToleranceDays: number;
}

export interface MatchEvidence {
  descriptionSimilarity: number;
  amountSimilarity: number;
  dateSimilarity: number;
  referenceSimilarity: number;
  consistencyScore: number;
  overallScore: number;
  amountDifference: number;
  dateDifferenceDays: number;
}

export interface ReconciliationDecision {
  transactionId: string;
  bankRecordId?: string;
  ledgerRecordId?: string;
  paymentRecordIds: string[];
  status: ReconciliationStatus;
  confidence: number;
  decisionMethod: "EXACT" | "RULE" | "AI_ASSIST" | "UNRESOLVED";
  reason: string;
  riskFlags: ExceptionType[];
  recommendedAction: string;
  evidence: MatchEvidence;
}

export interface ExceptionRecord {
  exception_id: string;
  transaction_id: string;
  exception_type: ExceptionType;
  source_records: {
    bank_transaction_id?: string;
    ledger_entry_id?: string;
    payment_ids?: string[];
  };
  amount_difference?: number;
  date_difference?: number;
  confidence: number;
  reason: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  recommended_action: string;
  status: "OPEN" | "RESOLVED" | "REJECTED";
}

export interface EvaluationMetrics {
  totalTransactions: number;
  sourceRecordsProcessed: number;
  matched: number;
  aiMatched: number;
  reviewRequired: number;
  unresolved: number;
  exceptions: number;
  highConfidence: number;
  matchRate: number;
  precision: number;
  recall: number;
  f1Score: number;
  falsePositives: number;
  falseNegatives: number;
  exceptionDetectionAccuracy: number;
  autoResolutionRate: number;
  humanReviewRate: number;
  ruleProcessingMs: number;
  aiProcessingMs: number;
  totalProcessingMs: number;
  throughputPerSecond: number;
}

export interface ReconciliationRunOutput {
  decisions: ReconciliationDecision[];
  exceptions: ExceptionRecord[];
  metrics: EvaluationMetrics;
  startedAt: string;
  completedAt: string;
}

export interface LLMAssistResponse {
  match: boolean;
  confidence: number;
  reason: string;
  risk_flags: ExceptionType[];
  evidence: string[];
}
