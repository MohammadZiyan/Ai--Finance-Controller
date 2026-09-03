import { getLLMProvider } from "@/lib/finance/llm-provider";
import { normalizeMerchantName, normalizeReference } from "@/lib/finance/normalization";
import { evaluateRun } from "@/lib/finance/evaluation";
import {
  amountSimilarity,
  combineScores,
  dateDiffDays,
  dateSimilarity,
  DEFAULT_WEIGHTS,
  referenceSimilarity,
  tokenJaccardSimilarity,
} from "@/lib/finance/scoring";
import type {
  BankTransaction,
  DatasetBundle,
  ExceptionRecord,
  ExceptionType,
  GroundTruthRecord,
  LedgerEntry,
  MatchEvidence,
  PaymentRecord,
  ReconciliationConfig,
  ReconciliationDecision,
  ReconciliationRunOutput,
} from "@/lib/finance/types";

const DEFAULT_CONFIG: ReconciliationConfig = {
  thresholds: {
    high: 0.9,
    medium: 0.7,
  },
  weights: DEFAULT_WEIGHTS,
  dateToleranceDays: 3,
};

interface NormalizedBank extends BankTransaction {
  normalizedMerchant: string;
  normalizedReference: string;
}

interface NormalizedLedger extends LedgerEntry {
  normalizedMerchant: string;
  normalizedReference: string;
}

interface NormalizedPayment extends PaymentRecord {
  normalizedMerchant: string;
  normalizedReference: string;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function buildEvidence(
  bank: NormalizedBank,
  ledger: NormalizedLedger | undefined,
  payment: NormalizedPayment | undefined,
  score: number,
  config: ReconciliationConfig,
): MatchEvidence {
  const descScore = ledger
    ? tokenJaccardSimilarity(bank.normalizedMerchant, ledger.normalizedMerchant)
    : payment
      ? tokenJaccardSimilarity(bank.normalizedMerchant, payment.normalizedMerchant)
      : 0;

  const amountTarget = ledger?.amount ?? payment?.amount ?? bank.amount;
  const dateTarget = ledger?.transaction_date ?? payment?.payment_date ?? bank.transaction_date;

  const amountScore = amountSimilarity(bank.amount, amountTarget);
  const dateScore = dateSimilarity(bank.transaction_date, dateTarget, config.dateToleranceDays);
  const refScore = referenceSimilarity(bank.normalizedReference, ledger?.normalizedReference ?? payment?.normalizedReference ?? "");
  const consistencyScore = bank.currency === (ledger?.currency ?? payment?.currency ?? bank.currency) ? 1 : 0;

  return {
    descriptionSimilarity: round4(descScore),
    amountSimilarity: round4(amountScore),
    dateSimilarity: round4(dateScore),
    referenceSimilarity: round4(refScore),
    consistencyScore: round4(consistencyScore),
    overallScore: round4(score),
    amountDifference: round4(Math.abs(bank.amount - amountTarget)),
    dateDifferenceDays: dateDiffDays(bank.transaction_date, dateTarget),
  };
}

function createException(
  txId: string,
  type: ExceptionType,
  confidence: number,
  reason: string,
  source: ExceptionRecord["source_records"],
  amountDifference?: number,
  dateDifference?: number,
): ExceptionRecord {
  return {
    exception_id: `EX-${txId.replace(/[^0-9]/g, "").padStart(4, "0")}-${type.slice(0, 3)}`,
    transaction_id: txId,
    exception_type: type,
    source_records: source,
    amount_difference: amountDifference,
    date_difference: dateDifference,
    confidence: round4(confidence),
    reason,
    severity: confidence < 0.65 ? "HIGH" : confidence < 0.85 ? "MEDIUM" : "LOW",
    recommended_action:
      type === "AMOUNT_MISMATCH"
        ? "Validate invoice value and check whether variance represents fee or accounting adjustment."
        : type === "MISSING_LEDGER_RECORD"
          ? "Create or locate missing ledger posting."
          : type === "MISSING_BANK_RECORD"
            ? "Verify bank feed completeness and posting delays."
            : type === "MISSING_PAYMENT_RECORD"
              ? "Confirm payment file delivery and settlement posting."
              : type === "DUPLICATE"
                ? "Review duplicate postings and reverse if erroneous."
                : type === "PARTIAL_PAYMENT"
                  ? "Review split settlement and ensure invoice closeout."
                  : type === "UNEXPECTED_FEE"
                    ? "Validate whether difference equals documented processing fee."
                    : type === "CURRENCY_MISMATCH"
                      ? "Verify FX conversion and reporting currency policy."
                      : "Human review required to resolve ambiguity safely.",
    status: "OPEN",
  };
}

function normalizeData(dataset: DatasetBundle): {
  bank: NormalizedBank[];
  ledger: NormalizedLedger[];
  payments: NormalizedPayment[];
} {
  return {
    bank: dataset.bank.map((b) => ({
      ...b,
      normalizedMerchant: normalizeMerchantName(b.description),
      normalizedReference: normalizeReference(b.reference),
    })),
    ledger: dataset.ledger.map((l) => ({
      ...l,
      normalizedMerchant: normalizeMerchantName(l.vendor || l.description),
      normalizedReference: normalizeReference(l.invoice_number || ""),
    })),
    payments: dataset.payments.map((p) => ({
      ...p,
      normalizedMerchant: normalizeMerchantName(p.merchant),
      normalizedReference: normalizeReference(p.reference),
    })),
  };
}

function scoreBankToLedger(bank: NormalizedBank, ledger: NormalizedLedger, config: ReconciliationConfig): number {
  const score = combineScores(
    {
      description: tokenJaccardSimilarity(bank.normalizedMerchant, ledger.normalizedMerchant),
      amount: amountSimilarity(bank.amount, ledger.amount),
      date: dateSimilarity(bank.transaction_date, ledger.transaction_date, config.dateToleranceDays),
      reference: referenceSimilarity(bank.normalizedReference, ledger.normalizedReference),
      consistency: bank.currency === ledger.currency ? 1 : 0,
    },
    config.weights,
  );

  return round4(score);
}

function scoreBankToPayment(bank: NormalizedBank, payment: NormalizedPayment, config: ReconciliationConfig): number {
  const score = combineScores(
    {
      description: tokenJaccardSimilarity(bank.normalizedMerchant, payment.normalizedMerchant),
      amount: amountSimilarity(bank.amount, payment.amount),
      date: dateSimilarity(bank.value_date, payment.settlement_date, config.dateToleranceDays + 2),
      reference: referenceSimilarity(bank.normalizedReference, payment.normalizedReference),
      consistency: bank.currency === payment.currency ? 1 : 0,
    },
    config.weights,
  );
  return round4(score);
}

export async function runReconciliation(
  dataset: DatasetBundle,
  config: Partial<ReconciliationConfig> = {},
): Promise<ReconciliationRunOutput> {
  const mergedConfig: ReconciliationConfig = {
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(config.thresholds ?? {}) },
    weights: { ...DEFAULT_CONFIG.weights, ...(config.weights ?? {}) },
    dateToleranceDays: config.dateToleranceDays ?? DEFAULT_CONFIG.dateToleranceDays,
  };

  const startedAtDate = new Date();
  const ruleStart = performance.now();

  const normalized = normalizeData(dataset);
  const llmProvider = getLLMProvider();

  const usedLedger = new Set<string>();
  const usedPayments = new Set<string>();
  const decisions: ReconciliationDecision[] = [];
  const exceptions: ExceptionRecord[] = [];

  const duplicateKeys = new Map<string, string[]>();
  for (const b of normalized.bank) {
    const key = `${b.normalizedReference}|${b.amount}|${b.transaction_date}|${b.normalizedMerchant}`;
    const existing = duplicateKeys.get(key) ?? [];
    existing.push(b.bank_transaction_id);
    duplicateKeys.set(key, existing);
  }

  let aiProcessingMs = 0;

  for (const bank of normalized.bank) {
    const txId = bank.synthetic_txn_id ?? `TXN-BANK-${bank.bank_transaction_id}`;

    const dupKey = `${bank.normalizedReference}|${bank.amount}|${bank.transaction_date}|${bank.normalizedMerchant}`;
    const duplicates = duplicateKeys.get(dupKey) ?? [];
    if (duplicates.length > 1) {
      const ex = createException(
        txId,
        "DUPLICATE",
        0.62,
        "Potential duplicate bank records share same amount/reference/date/merchant.",
        { bank_transaction_id: bank.bank_transaction_id },
      );
      exceptions.push(ex);
    }

    const ledgerCandidates = normalized.ledger
      .filter((l) => !usedLedger.has(l.ledger_entry_id))
      .map((l) => ({ ledger: l, score: scoreBankToLedger(bank, l, mergedConfig) }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score);

    const paymentCandidates = normalized.payments
      .filter((p) => !usedPayments.has(p.payment_id) && p.status !== "FAILED")
      .map((p) => ({ payment: p, score: scoreBankToPayment(bank, p, mergedConfig) }))
      .filter((item) => item.score >= 0.45)
      .sort((a, b) => b.score - a.score);

    const topLedger = ledgerCandidates[0];
    const secondLedger = ledgerCandidates[1];
    const topPayment = paymentCandidates[0];

    if (!topLedger) {
      const decision: ReconciliationDecision = {
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        paymentRecordIds: topPayment ? [topPayment.payment.payment_id] : [],
        status: "UNRESOLVED",
        confidence: 0.35,
        decisionMethod: "UNRESOLVED",
        reason: "No sufficiently similar ledger entry found for this bank transaction.",
        riskFlags: ["MISSING_LEDGER_RECORD"],
        recommendedAction: "Locate or create corresponding ledger entry.",
        evidence: buildEvidence(bank, undefined, topPayment?.payment, 0.35, mergedConfig),
      };
      decisions.push(decision);
      exceptions.push(
        createException(
          txId,
          "MISSING_LEDGER_RECORD",
          decision.confidence,
          decision.reason,
          {
            bank_transaction_id: bank.bank_transaction_id,
            payment_ids: decision.paymentRecordIds,
          },
        ),
      );
      continue;
    }

    if (!topPayment) {
      const score = topLedger.score;
      const status = score >= mergedConfig.thresholds.high ? "REVIEW" : "UNRESOLVED";
      const conf = status === "REVIEW" ? 0.78 : 0.58;
      const decision: ReconciliationDecision = {
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [],
        status,
        confidence: conf,
        decisionMethod: "RULE",
        reason: "Bank and ledger likely correspond, but payment settlement record is missing.",
        riskFlags: ["MISSING_PAYMENT_RECORD"],
        recommendedAction: "Confirm payment file completeness and settlement timing.",
        evidence: buildEvidence(bank, topLedger.ledger, undefined, score, mergedConfig),
      };
      decisions.push(decision);
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      exceptions.push(
        createException(
          txId,
          "MISSING_PAYMENT_RECORD",
          conf,
          decision.reason,
          {
            bank_transaction_id: bank.bank_transaction_id,
            ledger_entry_id: topLedger.ledger.ledger_entry_id,
          },
          Math.abs(bank.amount - topLedger.ledger.amount),
          dateDiffDays(bank.transaction_date, topLedger.ledger.transaction_date),
        ),
      );
      continue;
    }

    const paymentSetSameRef = normalized.payments.filter(
      (p) => !usedPayments.has(p.payment_id) && p.normalizedReference && p.normalizedReference === bank.normalizedReference,
    );
    const splitTotal = paymentSetSameRef.reduce((sum, p) => sum + p.amount, 0);

    const exactMatch =
      topLedger.score >= 0.94 &&
      topPayment.score >= 0.94 &&
      Math.abs(bank.amount - topLedger.ledger.amount) < 0.01 &&
      Math.abs(bank.amount - topPayment.payment.amount) < 0.01 &&
      bank.currency === topLedger.ledger.currency &&
      bank.currency === topPayment.payment.currency;

    if (exactMatch) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status: "MATCHED",
        confidence: 0.97,
        decisionMethod: "EXACT",
        reason: "Deterministic match on reference, amount, merchant normalization, and date consistency.",
        riskFlags: [],
        recommendedAction: "Auto-resolved.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, 0.97, mergedConfig),
      });
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      usedPayments.add(topPayment.payment.payment_id);
      continue;
    }

    const amountDiffLedger = Math.abs(bank.amount - topLedger.ledger.amount);
    const amountDiffPayment = Math.abs(bank.amount - topPayment.payment.amount);

    if (bank.currency !== topLedger.ledger.currency || bank.currency !== topPayment.payment.currency) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status: "UNRESOLVED",
        confidence: 0.3,
        decisionMethod: "UNRESOLVED",
        reason: "Currency mismatch across source records prevents safe reconciliation.",
        riskFlags: ["CURRENCY_MISMATCH"],
        recommendedAction: "Review FX conversion and source currency policy.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, 0.3, mergedConfig),
      });
      exceptions.push(
        createException(
          txId,
          "CURRENCY_MISMATCH",
          0.3,
          "Currency differs across bank, ledger, and payment records.",
          {
            bank_transaction_id: bank.bank_transaction_id,
            ledger_entry_id: topLedger.ledger.ledger_entry_id,
            payment_ids: [topPayment.payment.payment_id],
          },
        ),
      );
      continue;
    }

    if (Math.abs(splitTotal - topLedger.ledger.amount) < 0.01 && paymentSetSameRef.length >= 2) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: paymentSetSameRef.map((p) => p.payment_id),
        status: "AI_MATCHED",
        confidence: 0.91,
        decisionMethod: "AI_ASSIST",
        reason: "Likely split settlement: multiple payment records combine to the ledger/bank amount.",
        riskFlags: ["PARTIAL_PAYMENT"],
        recommendedAction: "Auto-resolved with split-payment trace recorded.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, 0.91, mergedConfig),
      });
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      paymentSetSameRef.forEach((p) => usedPayments.add(p.payment_id));
      exceptions.push(
        createException(
          txId,
          "PARTIAL_PAYMENT",
          0.91,
          "Payment settled in multiple splits that sum to expected amount.",
          {
            bank_transaction_id: bank.bank_transaction_id,
            ledger_entry_id: topLedger.ledger.ledger_entry_id,
            payment_ids: paymentSetSameRef.map((p) => p.payment_id),
          },
        ),
      );
      continue;
    }

    if (topPayment.payment.fee_amount && Math.abs(bank.amount - (topPayment.payment.amount + topPayment.payment.fee_amount)) < 0.01) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status: "REVIEW",
        confidence: 0.76,
        decisionMethod: "RULE",
        reason: "Potential processing fee detected between bank debit and invoice amount.",
        riskFlags: ["UNEXPECTED_FEE"],
        recommendedAction: "Confirm fee policy and booking treatment.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, 0.76, mergedConfig),
      });
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      usedPayments.add(topPayment.payment.payment_id);
      exceptions.push(
        createException(
          txId,
          "UNEXPECTED_FEE",
          0.76,
          "Fee-like delta identified; requires finance review.",
          {
            bank_transaction_id: bank.bank_transaction_id,
            ledger_entry_id: topLedger.ledger.ledger_entry_id,
            payment_ids: [topPayment.payment.payment_id],
          },
          Math.abs(bank.amount - topLedger.ledger.amount),
        ),
      );
      continue;
    }

    if (amountDiffLedger >= 1 && amountDiffPayment < 0.5) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status: "UNRESOLVED",
        confidence: 0.42,
        decisionMethod: "UNRESOLVED",
        reason: "Bank and payment agree, but ledger amount differs materially.",
        riskFlags: ["AMOUNT_MISMATCH"],
        recommendedAction: "Investigate booking error, fee treatment, or adjustment entry.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, 0.42, mergedConfig),
      });
      usedPayments.add(topPayment.payment.payment_id);
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      exceptions.push(
        createException(
          txId,
          "AMOUNT_MISMATCH",
          0.42,
          "Ledger amount does not agree with bank and settlement amount.",
          {
            bank_transaction_id: bank.bank_transaction_id,
            ledger_entry_id: topLedger.ledger.ledger_entry_id,
            payment_ids: [topPayment.payment.payment_id],
          },
          amountDiffLedger,
        ),
      );
      continue;
    }

    const combinedScore = round4((topLedger.score + topPayment.score) / 2);
    const margin = secondLedger ? topLedger.score - secondLedger.score : 1;

    if (combinedScore >= mergedConfig.thresholds.high && margin >= 0.1) {
      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status: "MATCHED",
        confidence: combinedScore,
        decisionMethod: "RULE",
        reason: "High-confidence fuzzy match with clear top candidate margin.",
        riskFlags: [],
        recommendedAction: "Auto-resolved.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, combinedScore, mergedConfig),
      });
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      usedPayments.add(topPayment.payment.payment_id);
      continue;
    }

    if (combinedScore >= mergedConfig.thresholds.medium) {
      const aiStart = performance.now();
      const aiResult = await llmProvider.evaluateAmbiguousMatch({
        bankDescription: bank.description,
        ledgerDescription: topLedger.ledger.description,
        paymentDescription: topPayment.payment.merchant,
        amountSignals:
          amountDiffLedger < 0.01 && amountDiffPayment < 0.01
            ? "exact"
            : amountDiffLedger / Math.max(bank.amount, 1) < 0.01
              ? "within 1%"
              : "mismatch",
        dateSignals: `bank-ledger:${dateDiffDays(bank.transaction_date, topLedger.ledger.transaction_date)}d bank-payment:${dateDiffDays(bank.transaction_date, topPayment.payment.payment_date)}d`,
        referenceSignals:
          bank.normalizedReference &&
          (bank.normalizedReference === topLedger.ledger.normalizedReference ||
            bank.normalizedReference === topPayment.payment.normalizedReference)
            ? "exact"
            : margin < 0.05
              ? "ambiguous"
              : "close",
      });
      aiProcessingMs += performance.now() - aiStart;

      const aiConfidence = round4(Math.min(0.99, (combinedScore + aiResult.confidence) / 2));
      const status = aiResult.match && aiConfidence >= mergedConfig.thresholds.high ? "AI_MATCHED" : "REVIEW";

      decisions.push({
        transactionId: txId,
        bankRecordId: bank.bank_transaction_id,
        ledgerRecordId: topLedger.ledger.ledger_entry_id,
        paymentRecordIds: [topPayment.payment.payment_id],
        status,
        confidence: aiConfidence,
        decisionMethod: "AI_ASSIST",
        reason: aiResult.reason,
        riskFlags: aiResult.risk_flags,
        recommendedAction: status === "AI_MATCHED" ? "Auto-resolved with AI evidence." : "Human review required.",
        evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, aiConfidence, mergedConfig),
      });
      usedLedger.add(topLedger.ledger.ledger_entry_id);
      usedPayments.add(topPayment.payment.payment_id);

      if (status === "REVIEW" || aiResult.risk_flags.length > 0 || margin < 0.05) {
        exceptions.push(
          createException(
            txId,
            margin < 0.05 ? "AMBIGUOUS_MATCH" : (aiResult.risk_flags[0] ?? "UNRESOLVED"),
            aiConfidence,
            aiResult.reason,
            {
              bank_transaction_id: bank.bank_transaction_id,
              ledger_entry_id: topLedger.ledger.ledger_entry_id,
              payment_ids: [topPayment.payment.payment_id],
            },
            Math.abs(bank.amount - topLedger.ledger.amount),
            dateDiffDays(bank.transaction_date, topLedger.ledger.transaction_date),
          ),
        );
      }
      continue;
    }

    decisions.push({
      transactionId: txId,
      bankRecordId: bank.bank_transaction_id,
      ledgerRecordId: topLedger.ledger.ledger_entry_id,
      paymentRecordIds: [topPayment.payment.payment_id],
      status: "UNRESOLVED",
      confidence: combinedScore,
      decisionMethod: "UNRESOLVED",
      reason: "Low confidence after deterministic and fuzzy stages.",
      riskFlags: ["UNRESOLVED"],
      recommendedAction: "Human review required.",
      evidence: buildEvidence(bank, topLedger.ledger, topPayment.payment, combinedScore, mergedConfig),
    });
    exceptions.push(
      createException(
        txId,
        "UNRESOLVED",
        combinedScore,
        "No safe reconciliation decision could be made automatically.",
        {
          bank_transaction_id: bank.bank_transaction_id,
          ledger_entry_id: topLedger.ledger.ledger_entry_id,
          payment_ids: [topPayment.payment.payment_id],
        },
      ),
    );
  }

  for (const ledger of normalized.ledger) {
    if (usedLedger.has(ledger.ledger_entry_id)) continue;
    const txId = ledger.synthetic_txn_id ?? `TXN-LEDGER-${ledger.ledger_entry_id}`;
    decisions.push({
      transactionId: txId,
      ledgerRecordId: ledger.ledger_entry_id,
      paymentRecordIds: [],
      status: "UNRESOLVED",
      confidence: 0.34,
      decisionMethod: "UNRESOLVED",
      reason: "Ledger record has no matching bank transaction.",
      riskFlags: ["MISSING_BANK_RECORD"],
      recommendedAction: "Investigate bank feed or posting timing.",
      evidence: {
        descriptionSimilarity: 0,
        amountSimilarity: 0,
        dateSimilarity: 0,
        referenceSimilarity: 0,
        consistencyScore: 0,
        overallScore: 0.34,
        amountDifference: 0,
        dateDifferenceDays: 0,
      },
    });
    exceptions.push(
      createException(
        txId,
        "MISSING_BANK_RECORD",
        0.34,
        "No bank-side record found for ledger entry.",
        { ledger_entry_id: ledger.ledger_entry_id },
      ),
    );
  }

  const decisionMap = new Map(decisions.map((d) => [d.transactionId, d]));
  for (const gt of dataset.groundTruth) {
    if (!decisionMap.has(gt.transaction_id)) {
      decisions.push({
        transactionId: gt.transaction_id,
        paymentRecordIds: [],
        status: "UNRESOLVED",
        confidence: 0.2,
        decisionMethod: "UNRESOLVED",
        reason: "No records available to reconcile this transaction.",
        riskFlags: ["UNRESOLVED"],
        recommendedAction: "Check data ingestion integrity.",
        evidence: {
          descriptionSimilarity: 0,
          amountSimilarity: 0,
          dateSimilarity: 0,
          referenceSimilarity: 0,
          consistencyScore: 0,
          overallScore: 0.2,
          amountDifference: 0,
          dateDifferenceDays: 0,
        },
      });
    }
  }

  const ruleProcessingMs = Math.round(performance.now() - ruleStart - aiProcessingMs);
  const totalProcessingMs = Math.round(performance.now() - ruleStart);

  const completedAtDate = new Date();

  const metrics = evaluateRun({
    decisions,
    exceptions,
    groundTruth: dataset.groundTruth,
    sourceRecordsProcessed: dataset.bank.length + dataset.ledger.length + dataset.payments.length,
    ruleProcessingMs,
    aiProcessingMs: Math.round(aiProcessingMs),
    totalProcessingMs,
  });

  const expectedStatusByTxn = new Map(dataset.groundTruth.map((g) => [g.transaction_id, g.expected_status]));
  decisions.forEach((decision) => {
    const expected = expectedStatusByTxn.get(decision.transactionId);
    if (expected && decision.status !== expected && expected !== "AI_MATCHED") {
      // Intentionally left in output reasoning; persistence layer can compute correctness.
    }
  });

  return {
    decisions,
    exceptions,
    metrics,
    startedAt: startedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
  };
}

export function createFallbackGroundTruthFromData(dataset: {
  bank: BankTransaction[];
  ledger: LedgerEntry[];
  payments: PaymentRecord[];
}): GroundTruthRecord[] {
  const transactionIds = new Set<string>();
  dataset.bank.forEach((b) => transactionIds.add(b.synthetic_txn_id ?? `TXN-BANK-${b.bank_transaction_id}`));
  dataset.ledger.forEach((l) => transactionIds.add(l.synthetic_txn_id ?? `TXN-LEDGER-${l.ledger_entry_id}`));

  return [...transactionIds].map((id) => ({
    transaction_id: id,
    expected_status: "REVIEW",
    expected_exception_type: null,
    scenario: "UPLOADED",
  }));
}
