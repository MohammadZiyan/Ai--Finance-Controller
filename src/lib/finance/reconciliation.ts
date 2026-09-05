import { getLLMProvider } from "@/lib/finance/llm-provider";
import { extractUTR, isRazorpayTransaction, normalizeMerchantName, normalizeReference } from "@/lib/finance/normalization";
import { evaluateRun } from "@/lib/finance/evaluation";
import {
  amountSimilarity,
  combineScores,
  dateDiffDays,
  dateSimilarity,
  DEFAULT_WEIGHTS,
  feeSimilarity,
  gstAccuracy,
  RAZORPAY_WEIGHTS,
  referenceSimilarity,
  settlementDateSimilarity,
  tokenJaccardSimilarity,
  utrSimilarity,
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
                      : type === "REFUND_MISMATCH"
                        ? "Cross-verify refund amount against Razorpay dashboard and confirm refund processing timeline."
                        : type === "CHARGEBACK"
                          ? "Check dispute status in Razorpay dashboard. Submit evidence within SLA if dispute is contestable."
                          : type === "LATE_AUTHORIZATION"
                            ? "Verify payment capture timestamp. Late authorization may shift settlement by 1 business day."
                            : type === "GST_DISCREPANCY"
                              ? "Validate GST computation: should be exactly 18% of MDR. Contact Razorpay support if variance persists."
                              : type === "UTR_MISMATCH"
                                ? "Match UTR from bank statement against Razorpay settlement API response. Contact bank if mismatch persists."
                                : type === "SETTLEMENT_SHORTFALL"
                                  ? "Aggregate all pay_ IDs in the settlement batch and verify net total against bank credit."
                                  : type === "MDR_VARIANCE"
                                    ? "Compare effective TDR rate against contracted rate. Check for payment method surcharge differences."
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

    /* ── Razorpay-Specific Decision Branches ── */
    const isRzpTx = isRazorpayTransaction(bank.description) || isRazorpayTransaction(bank.reference);

    if (isRzpTx) {
      const bankUTR = extractUTR(bank.description);

      // Find Razorpay payment candidates with matching UTR or settlement ID
      const rzpPayments = normalized.payments.filter(
        (p) => !usedPayments.has(p.payment_id) && isRazorpayTransaction(p.merchant),
      );

      // ── Branch 1: UTR-Based Direct Match ──
      if (bankUTR) {
        const utrMatched = rzpPayments.find((p) => p.utr && utrSimilarity(bankUTR, p.utr) >= 0.9);
        if (utrMatched) {
          const matchedLedger = normalized.ledger.find(
            (l) => !usedLedger.has(l.ledger_entry_id) &&
              (l.invoice_number === utrMatched.order_id || l.normalizedMerchant === "razorpay"),
          );

          // Check fee alignment
          const feeScore = feeSimilarity(utrMatched.amount, bank.amount, utrMatched.fee_breakdown);
          const dateScore = settlementDateSimilarity(utrMatched.payment_date, bank.transaction_date);

          decisions.push({
            transactionId: txId,
            bankRecordId: bank.bank_transaction_id,
            ledgerRecordId: matchedLedger?.ledger_entry_id,
            paymentRecordIds: [utrMatched.payment_id],
            status: "MATCHED",
            confidence: 0.96,
            decisionMethod: "EXACT",
            reason: `UTR direct match: bank UTR ${bankUTR} matches Razorpay settlement UTR. Fee-adjusted amount reconciled.`,
            riskFlags: [],
            recommendedAction: "Auto-resolved via UTR match.",
            evidence: {
              descriptionSimilarity: 1.0,
              amountSimilarity: round4(amountSimilarity(bank.amount, utrMatched.amount - (utrMatched.fee_amount ?? 0))),
              dateSimilarity: round4(dateScore),
              referenceSimilarity: 1.0,
              consistencyScore: 1.0,
              overallScore: 0.96,
              amountDifference: round4(Math.abs(bank.amount - utrMatched.amount)),
              dateDifferenceDays: dateDiffDays(bank.transaction_date, utrMatched.settlement_date),
              utrMatch: true,
              feeReconciled: feeScore >= 0.85,
              paymentMethod: utrMatched.payment_method,
              settlementType: utrMatched.settlement_type,
            },
          });
          usedPayments.add(utrMatched.payment_id);
          if (matchedLedger) usedLedger.add(matchedLedger.ledger_entry_id);

          // Check for GST discrepancy on matched payment
          if (utrMatched.fee_breakdown) {
            const gstScore = gstAccuracy(utrMatched.fee_breakdown);
            if (gstScore < 0.9) {
              exceptions.push(
                createException(txId, "GST_DISCREPANCY", 0.70,
                  `GST on MDR is ₹${utrMatched.fee_breakdown.gst} but expected ₹${round4(utrMatched.fee_breakdown.mdr * 0.18)}. Variance detected.`,
                  { bank_transaction_id: bank.bank_transaction_id, payment_ids: [utrMatched.payment_id] },
                  Math.abs(utrMatched.fee_breakdown.gst - utrMatched.fee_breakdown.mdr * 0.18),
                ),
              );
            }
          }
          continue;
        }
      }

      // ── Branch 2: Fee-Adjusted Amount Match ──
      const feeAdjustedMatch = rzpPayments.find((p) => {
        if (!p.fee_amount) return false;
        const netAmount = p.amount - p.fee_amount;
        return Math.abs(bank.amount - netAmount) < 1.0;
      });

      if (feeAdjustedMatch) {
        const matchedLedger = normalized.ledger.find(
          (l) => !usedLedger.has(l.ledger_entry_id) &&
            (l.invoice_number === feeAdjustedMatch.order_id ||
             Math.abs(l.amount - feeAdjustedMatch.amount) < 0.01),
        );

        const feeScore = feeSimilarity(feeAdjustedMatch.amount, bank.amount, feeAdjustedMatch.fee_breakdown);

        // Check MDR variance
        const hasMdrVariance = feeAdjustedMatch.fee_breakdown &&
          feeScore < 0.95 && feeScore >= 0.6;

        decisions.push({
          transactionId: txId,
          bankRecordId: bank.bank_transaction_id,
          ledgerRecordId: matchedLedger?.ledger_entry_id,
          paymentRecordIds: [feeAdjustedMatch.payment_id],
          status: hasMdrVariance ? "REVIEW" : "MATCHED",
          confidence: hasMdrVariance ? 0.78 : 0.93,
          decisionMethod: "RULE",
          reason: hasMdrVariance
            ? `Net settlement matches after fee deduction but MDR rate differs from standard. Effective rate: ${feeAdjustedMatch.fee_breakdown?.feeRate ? (feeAdjustedMatch.fee_breakdown.feeRate * 100).toFixed(1) + "%" : "unknown"}.`
            : `Fee-adjusted match: bank amount ₹${bank.amount} equals payment ₹${feeAdjustedMatch.amount} minus fee ₹${feeAdjustedMatch.fee_amount}.`,
          riskFlags: hasMdrVariance ? ["MDR_VARIANCE"] : [],
          recommendedAction: hasMdrVariance
            ? "Compare effective TDR rate against contracted rate."
            : "Auto-resolved via fee-adjusted reconciliation.",
          evidence: {
            descriptionSimilarity: round4(tokenJaccardSimilarity(bank.normalizedMerchant, "razorpay")),
            amountSimilarity: round4(feeScore),
            dateSimilarity: round4(settlementDateSimilarity(feeAdjustedMatch.payment_date, bank.transaction_date)),
            referenceSimilarity: round4(referenceSimilarity(bank.normalizedReference, normalizeReference(feeAdjustedMatch.order_id))),
            consistencyScore: 1.0,
            overallScore: hasMdrVariance ? 0.78 : 0.93,
            amountDifference: round4(Math.abs(bank.amount - (feeAdjustedMatch.amount - (feeAdjustedMatch.fee_amount ?? 0)))),
            dateDifferenceDays: dateDiffDays(bank.transaction_date, feeAdjustedMatch.settlement_date),
            feeReconciled: !hasMdrVariance,
            paymentMethod: feeAdjustedMatch.payment_method,
            settlementType: feeAdjustedMatch.settlement_type,
          },
        });
        usedPayments.add(feeAdjustedMatch.payment_id);
        if (matchedLedger) usedLedger.add(matchedLedger.ledger_entry_id);

        if (hasMdrVariance) {
          exceptions.push(
            createException(txId, "MDR_VARIANCE", 0.78,
              `MDR rate variance detected. Expected standard TDR but effective rate is ${feeAdjustedMatch.fee_breakdown?.feeRate ? (feeAdjustedMatch.fee_breakdown.feeRate * 100).toFixed(1) + "%" : "unknown"}.`,
              { bank_transaction_id: bank.bank_transaction_id, payment_ids: [feeAdjustedMatch.payment_id] },
              Math.abs(bank.amount - (feeAdjustedMatch.amount - (feeAdjustedMatch.fee_amount ?? 0))),
            ),
          );
        }
        continue;
      }

      // ── Branch 3: Refund Netting Detection ──
      const refundMatch = rzpPayments.find((p) =>
        p.refund_amount && p.refund_amount > 0 &&
        Math.abs(bank.amount - (p.amount - (p.fee_amount ?? 0) - p.refund_amount)) < 1.0,
      );

      if (refundMatch) {
        const expectedNet = refundMatch.amount - (refundMatch.fee_amount ?? 0) - (refundMatch.refund_amount ?? 0);
        decisions.push({
          transactionId: txId,
          bankRecordId: bank.bank_transaction_id,
          paymentRecordIds: [refundMatch.payment_id],
          status: "REVIEW",
          confidence: 0.82,
          decisionMethod: "RULE",
          reason: `Refund netting detected: bank credit ₹${bank.amount} = payment ₹${refundMatch.amount} - fee ₹${refundMatch.fee_amount ?? 0} - refund ₹${refundMatch.refund_amount}.`,
          riskFlags: ["REFUND_MISMATCH"],
          recommendedAction: "Cross-verify refund amount against Razorpay dashboard.",
          evidence: {
            descriptionSimilarity: 1.0,
            amountSimilarity: round4(amountSimilarity(bank.amount, expectedNet)),
            dateSimilarity: round4(settlementDateSimilarity(refundMatch.payment_date, bank.transaction_date)),
            referenceSimilarity: 0.5,
            consistencyScore: 1.0,
            overallScore: 0.82,
            amountDifference: round4(Math.abs(bank.amount - expectedNet)),
            dateDifferenceDays: dateDiffDays(bank.transaction_date, refundMatch.settlement_date),
            feeReconciled: true,
            paymentMethod: refundMatch.payment_method,
          },
        });
        usedPayments.add(refundMatch.payment_id);
        exceptions.push(
          createException(txId, "REFUND_MISMATCH", 0.82,
            `Settlement netted with refund of ₹${refundMatch.refund_amount}.`,
            { bank_transaction_id: bank.bank_transaction_id, payment_ids: [refundMatch.payment_id] },
            refundMatch.refund_amount,
          ),
        );
        continue;
      }

      // ── Branch 4: Chargeback Identification ──
      const chargebackMatch = rzpPayments.find(
        (p) => p.dispute_status === "OPEN" || p.dispute_status === "UNDER_REVIEW",
      );

      if (chargebackMatch && bank.amount === 0) {
        decisions.push({
          transactionId: txId,
          bankRecordId: bank.bank_transaction_id,
          paymentRecordIds: [chargebackMatch.payment_id],
          status: "UNRESOLVED",
          confidence: 0.45,
          decisionMethod: "RULE",
          reason: `Chargeback detected: payment ${chargebackMatch.payment_id} is disputed (status: ${chargebackMatch.dispute_status}). Settlement deducted.`,
          riskFlags: ["CHARGEBACK"],
          recommendedAction: "Check dispute status in Razorpay dashboard. Submit evidence within SLA.",
          evidence: {
            descriptionSimilarity: 1.0,
            amountSimilarity: 0,
            dateSimilarity: round4(settlementDateSimilarity(chargebackMatch.payment_date, bank.transaction_date)),
            referenceSimilarity: 0.5,
            consistencyScore: 1.0,
            overallScore: 0.45,
            amountDifference: chargebackMatch.amount,
            dateDifferenceDays: dateDiffDays(bank.transaction_date, chargebackMatch.settlement_date),
            paymentMethod: chargebackMatch.payment_method,
            settlementType: "ADJUSTMENT",
          },
        });
        usedPayments.add(chargebackMatch.payment_id);
        exceptions.push(
          createException(txId, "CHARGEBACK", 0.45,
            `Payment disputed. Amount ₹${chargebackMatch.amount} deducted from settlement.`,
            { bank_transaction_id: bank.bank_transaction_id, payment_ids: [chargebackMatch.payment_id] },
            chargebackMatch.amount,
          ),
        );
        continue;
      }

      // ── Branch 5: Settlement Batching (Multi-payment per UTR) ──
      if (bankUTR) {
        const batchPayments = rzpPayments.filter(
          (p) => p.utr === bankUTR && !usedPayments.has(p.payment_id),
        );

        if (batchPayments.length >= 2) {
          const batchNetTotal = batchPayments.reduce(
            (sum, p) => sum + p.amount - (p.fee_amount ?? 0),
            0,
          );

          if (Math.abs(bank.amount - batchNetTotal) < 2.0) {
            decisions.push({
              transactionId: txId,
              bankRecordId: bank.bank_transaction_id,
              paymentRecordIds: batchPayments.map((p) => p.payment_id),
              status: "AI_MATCHED",
              confidence: 0.91,
              decisionMethod: "AI_ASSIST",
              reason: `Settlement batching: ${batchPayments.length} payments share UTR ${bankUTR}. Aggregate net ₹${round4(batchNetTotal)} ≈ bank ₹${bank.amount}.`,
              riskFlags: ["PARTIAL_PAYMENT"],
              recommendedAction: "Auto-resolved with settlement batch trace recorded.",
              evidence: {
                descriptionSimilarity: 1.0,
                amountSimilarity: round4(amountSimilarity(bank.amount, batchNetTotal)),
                dateSimilarity: 1.0,
                referenceSimilarity: 1.0,
                consistencyScore: 1.0,
                overallScore: 0.91,
                amountDifference: round4(Math.abs(bank.amount - batchNetTotal)),
                dateDifferenceDays: 0,
                utrMatch: true,
                feeReconciled: true,
                settlementType: "PAYMENT",
              },
            });

            batchPayments.forEach((p) => usedPayments.add(p.payment_id));
            // Also mark corresponding ledger entries as used
            for (const bp of batchPayments) {
              const matchedLedger = normalized.ledger.find(
                (l) => !usedLedger.has(l.ledger_entry_id) && l.invoice_number === bp.order_id,
              );
              if (matchedLedger) usedLedger.add(matchedLedger.ledger_entry_id);
            }

            exceptions.push(
              createException(txId, "PARTIAL_PAYMENT", 0.91,
                `${batchPayments.length} payments batched into single settlement UTR.`,
                { bank_transaction_id: bank.bank_transaction_id, payment_ids: batchPayments.map((p) => p.payment_id) },
              ),
            );
            continue;
          }
        }
      }

      // ── Branch 6: UTR Mismatch Detection ──
      if (bankUTR) {
        const utrMismatch = rzpPayments.find((p) => {
          if (!p.utr) return false;
          const score = utrSimilarity(bankUTR, p.utr);
          return score > 0 && score < 0.9; // Partial but not exact match
        });

        if (utrMismatch) {
          decisions.push({
            transactionId: txId,
            bankRecordId: bank.bank_transaction_id,
            paymentRecordIds: [utrMismatch.payment_id],
            status: "REVIEW",
            confidence: 0.65,
            decisionMethod: "RULE",
            reason: `UTR partial match: bank UTR ${bankUTR} partially matches Razorpay UTR ${utrMismatch.utr}. Manual verification required.`,
            riskFlags: ["UTR_MISMATCH"],
            recommendedAction: "Match UTR from bank statement against Razorpay settlement API response.",
            evidence: {
              descriptionSimilarity: 1.0,
              amountSimilarity: round4(amountSimilarity(bank.amount, utrMismatch.amount - (utrMismatch.fee_amount ?? 0))),
              dateSimilarity: round4(settlementDateSimilarity(utrMismatch.payment_date, bank.transaction_date)),
              referenceSimilarity: round4(utrSimilarity(bankUTR, utrMismatch.utr ?? "")),
              consistencyScore: 1.0,
              overallScore: 0.65,
              amountDifference: round4(Math.abs(bank.amount - (utrMismatch.amount - (utrMismatch.fee_amount ?? 0)))),
              dateDifferenceDays: dateDiffDays(bank.transaction_date, utrMismatch.settlement_date),
              utrMatch: false,
              paymentMethod: utrMismatch.payment_method,
            },
          });
          usedPayments.add(utrMismatch.payment_id);
          exceptions.push(
            createException(txId, "UTR_MISMATCH", 0.65,
              `Bank UTR ${bankUTR} does not exactly match Razorpay UTR ${utrMismatch.utr}.`,
              { bank_transaction_id: bank.bank_transaction_id, payment_ids: [utrMismatch.payment_id] },
            ),
          );
          continue;
        }
      }
    }
    /* ── End Razorpay-Specific Branches ── */

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
