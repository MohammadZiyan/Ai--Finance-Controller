import { db } from "@/db";
import {
  auditTrail,
  bankTransactions,
  exceptions,
  ledgerEntries,
  paymentRecords,
  reconciliationResults,
  reconciliationRuns,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { normalizeMerchantName, normalizeReference } from "@/lib/finance/normalization";
import type { DatasetBundle, ReconciliationRunOutput } from "@/lib/finance/types";

function toNumericString(value: number): string {
  return value.toFixed(2);
}

export async function persistRun(params: {
  batchName: string;
  sourceType: string;
  dataset: DatasetBundle;
  output: ReconciliationRunOutput;
}): Promise<number> {
  const { batchName, sourceType, dataset, output } = params;

  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      batchName,
      sourceType,
      startedAt: new Date(output.startedAt),
      completedAt: new Date(output.completedAt),
      recordsProcessed: output.metrics.sourceRecordsProcessed,
      ruleProcessingMs: output.metrics.ruleProcessingMs,
      aiProcessingMs: output.metrics.aiProcessingMs,
      totalProcessingMs: output.metrics.totalProcessingMs,
      metrics: output.metrics as unknown as Record<string, unknown>,
    })
    .returning({ id: reconciliationRuns.id });

  if (!run) throw new Error("Failed to create reconciliation run");

  const runId = run.id;

  const bankInserted =
    dataset.bank.length === 0
      ? []
      : await db
          .insert(bankTransactions)
          .values(
            dataset.bank.map((b) => ({
              runId,
              bankTransactionId: b.bank_transaction_id,
              transactionDate: b.transaction_date,
              valueDate: b.value_date,
              description: b.description,
              reference: b.reference,
              amount: toNumericString(b.amount),
              currency: b.currency,
              transactionType: b.transaction_type,
              accountNumberMasked: b.account_number_masked,
              normalizedMerchant: normalizeMerchantName(b.description),
              normalizedReference: normalizeReference(b.reference),
              syntheticTxnId: b.synthetic_txn_id,
            })),
          )
          .returning({ id: bankTransactions.id, externalId: bankTransactions.bankTransactionId });

  const ledgerInserted =
    dataset.ledger.length === 0
      ? []
      : await db
          .insert(ledgerEntries)
          .values(
            dataset.ledger.map((l) => ({
              runId,
              ledgerEntryId: l.ledger_entry_id,
              transactionDate: l.transaction_date,
              description: l.description,
              invoiceNumber: l.invoice_number,
              amount: toNumericString(l.amount),
              currency: l.currency,
              accountingCategory: l.accounting_category,
              vendor: l.vendor,
              normalizedMerchant: normalizeMerchantName(l.vendor || l.description),
              normalizedReference: normalizeReference(l.invoice_number),
              syntheticTxnId: l.synthetic_txn_id,
            })),
          )
          .returning({ id: ledgerEntries.id, externalId: ledgerEntries.ledgerEntryId });

  const paymentInserted =
    dataset.payments.length === 0
      ? []
      : await db
          .insert(paymentRecords)
          .values(
            dataset.payments.map((p) => ({
              runId,
              paymentId: p.payment_id,
              paymentDate: p.payment_date,
              merchant: p.merchant,
              reference: p.reference,
              amount: toNumericString(p.amount),
              currency: p.currency,
              status: p.status,
              settlementDate: p.settlement_date,
              feeAmount: toNumericString(p.fee_amount ?? 0),
              normalizedMerchant: normalizeMerchantName(p.merchant),
              normalizedReference: normalizeReference(p.reference),
              syntheticTxnId: p.synthetic_txn_id,
            })),
          )
          .returning({ id: paymentRecords.id, externalId: paymentRecords.paymentId });

  const bankIdByExternal = new Map(bankInserted.map((row) => [row.externalId, row.id]));
  const ledgerIdByExternal = new Map(ledgerInserted.map((row) => [row.externalId, row.id]));
  const paymentIdByExternal = new Map(paymentInserted.map((row) => [row.externalId, row.id]));

  if (output.decisions.length > 0) {
    await db.insert(reconciliationResults).values(
      output.decisions.map((d) => ({
        runId,
        transactionId: d.transactionId,
        bankRecordId: d.bankRecordId ? bankIdByExternal.get(d.bankRecordId) ?? null : null,
        ledgerRecordId: d.ledgerRecordId ? ledgerIdByExternal.get(d.ledgerRecordId) ?? null : null,
        paymentRecordIds: d.paymentRecordIds
          .map((id) => paymentIdByExternal.get(id))
          .filter((id): id is number => typeof id === "number"),
        status: d.status,
        confidence: d.confidence.toFixed(4),
        decisionMethod: d.decisionMethod,
        reason: d.reason,
        evidence: d.evidence as unknown as Record<string, unknown>,
        recommendedAction: d.recommendedAction,
      })),
    );

    await db.insert(auditTrail).values(
      output.decisions.map((d) => ({
        runId,
        transactionId: d.transactionId,
        stage: d.decisionMethod,
        details: {
          confidence: d.confidence,
          reason: d.reason,
          riskFlags: d.riskFlags,
          evidence: d.evidence,
        } as Record<string, unknown>,
      })),
    );
  }

  if (output.exceptions.length > 0) {
    await db.insert(exceptions).values(
      output.exceptions.map((ex) => ({
        runId,
        exceptionId: ex.exception_id,
        transactionId: ex.transaction_id,
        exceptionType: ex.exception_type,
        severity: ex.severity,
        status: ex.status,
        confidence: ex.confidence.toFixed(4),
        amountDifference: ex.amount_difference !== undefined ? ex.amount_difference.toFixed(2) : null,
        dateDifferenceDays: ex.date_difference ?? null,
        reason: ex.reason,
        recommendedAction: ex.recommended_action,
        sourceRecords: ex.source_records as unknown as Record<string, unknown>,
      })),
    );
  }

  return runId;
}

export async function getLatestRunId(): Promise<number | null> {
  const [row] = await db.select({ id: reconciliationRuns.id }).from(reconciliationRuns).orderBy(desc(reconciliationRuns.id)).limit(1);
  return row?.id ?? null;
}

export async function getSummary(runId?: number) {
  const effectiveRunId = runId ?? (await getLatestRunId());
  if (!effectiveRunId) return null;

  const [run] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, effectiveRunId)).limit(1);
  if (!run) return null;

  const statusCounts = await db
    .select({ status: reconciliationResults.status, count: sql<number>`count(*)` })
    .from(reconciliationResults)
    .where(eq(reconciliationResults.runId, effectiveRunId))
    .groupBy(reconciliationResults.status);

  const exceptionCounts = await db
    .select({ type: exceptions.exceptionType, count: sql<number>`count(*)` })
    .from(exceptions)
    .where(eq(exceptions.runId, effectiveRunId))
    .groupBy(exceptions.exceptionType);

  return {
    run,
    statusCounts,
    exceptionCounts,
  };
}

export async function getTransactions(runId?: number, status?: string) {
  const effectiveRunId = runId ?? (await getLatestRunId());
  if (!effectiveRunId) return [];

  const rows = await db
    .select({
      id: reconciliationResults.id,
      transactionId: reconciliationResults.transactionId,
      status: reconciliationResults.status,
      confidence: reconciliationResults.confidence,
      reason: reconciliationResults.reason,
      recommendedAction: reconciliationResults.recommendedAction,
      bankRecordId: reconciliationResults.bankRecordId,
      ledgerRecordId: reconciliationResults.ledgerRecordId,
      paymentRecordIds: reconciliationResults.paymentRecordIds,
      evidence: reconciliationResults.evidence,
    })
    .from(reconciliationResults)
    .where(
      and(
        eq(reconciliationResults.runId, effectiveRunId),
        status ? eq(reconciliationResults.status, status) : undefined,
      ),
    )
    .orderBy(desc(reconciliationResults.confidence));

  const bankIds = rows.map((r) => r.bankRecordId).filter((x): x is number => typeof x === "number");
  const ledgerIds = rows.map((r) => r.ledgerRecordId).filter((x): x is number => typeof x === "number");
  const paymentIds = rows.flatMap((r) => (Array.isArray(r.paymentRecordIds) ? r.paymentRecordIds : [])).filter((x): x is number => typeof x === "number");

  const banks = bankIds.length
    ? await db
        .select({ id: bankTransactions.id, amount: bankTransactions.amount, description: bankTransactions.description })
        .from(bankTransactions)
        .where(inArray(bankTransactions.id, bankIds))
    : [];

  const ledgers = ledgerIds.length
    ? await db
        .select({ id: ledgerEntries.id, amount: ledgerEntries.amount, description: ledgerEntries.description })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.id, ledgerIds))
    : [];

  const payments = paymentIds.length
    ? await db
        .select({ id: paymentRecords.id, amount: paymentRecords.amount, merchant: paymentRecords.merchant })
        .from(paymentRecords)
        .where(inArray(paymentRecords.id, paymentIds))
    : [];

  const bankMap = new Map(banks.map((b) => [b.id, b]));
  const ledgerMap = new Map(ledgers.map((l) => [l.id, l]));
  const paymentMap = new Map(payments.map((p) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    bank: r.bankRecordId ? bankMap.get(r.bankRecordId) ?? null : null,
    ledger: r.ledgerRecordId ? ledgerMap.get(r.ledgerRecordId) ?? null : null,
    payments: Array.isArray(r.paymentRecordIds)
      ? r.paymentRecordIds.map((id) => paymentMap.get(id)).filter(Boolean)
      : [],
  }));
}

export async function getTransactionById(transactionId: string, runId?: number) {
  const effectiveRunId = runId ?? (await getLatestRunId());
  if (!effectiveRunId) return null;

  const [result] = await db
    .select()
    .from(reconciliationResults)
    .where(and(eq(reconciliationResults.runId, effectiveRunId), eq(reconciliationResults.transactionId, transactionId)))
    .limit(1);

  if (!result) return null;

  const bank = result.bankRecordId
    ? await db.select().from(bankTransactions).where(eq(bankTransactions.id, result.bankRecordId)).limit(1)
    : [];

  const ledger = result.ledgerRecordId
    ? await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, result.ledgerRecordId)).limit(1)
    : [];

  const paymentRows = Array.isArray(result.paymentRecordIds)
    ? result.paymentRecordIds.length
      ? await db.select().from(paymentRecords).where(inArray(paymentRecords.id, result.paymentRecordIds))
      : []
    : [];

  const txExceptions = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.runId, effectiveRunId), eq(exceptions.transactionId, transactionId)));

  const txAudit = await db
    .select()
    .from(auditTrail)
    .where(and(eq(auditTrail.runId, effectiveRunId), eq(auditTrail.transactionId, transactionId)))
    .orderBy(desc(auditTrail.id));

  return {
    result,
    bank: bank[0] ?? null,
    ledger: ledger[0] ?? null,
    payments: paymentRows,
    exceptions: txExceptions,
    audit: txAudit,
  };
}

export async function getExceptions(runId?: number, filters?: { type?: string; severity?: string; status?: string }) {
  const effectiveRunId = runId ?? (await getLatestRunId());
  if (!effectiveRunId) return [];

  return db
    .select()
    .from(exceptions)
    .where(
      and(
        eq(exceptions.runId, effectiveRunId),
        filters?.type ? eq(exceptions.exceptionType, filters.type) : undefined,
        filters?.severity ? eq(exceptions.severity, filters.severity) : undefined,
        filters?.status ? eq(exceptions.status, filters.status) : undefined,
      ),
    )
    .orderBy(desc(exceptions.id));
}

export async function resolveException(params: {
  id: number;
  action: "APPROVE_MATCH" | "REJECT_MATCH" | "MARK_RESOLVED" | "KEEP_EXCEPTION";
  note?: string;
}) {
  const { id, action, note } = params;

  const status = action === "MARK_RESOLVED" || action === "APPROVE_MATCH" ? "RESOLVED" : "OPEN";

  const [updated] = await db
    .update(exceptions)
    .set({
      status,
      humanDecision: note ? `${action}: ${note}` : action,
      reviewedAt: new Date(),
    })
    .where(eq(exceptions.id, id))
    .returning();

  return updated ?? null;
}
