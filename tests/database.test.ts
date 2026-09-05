import test from "node:test";
import assert from "node:assert/strict";
import { db, ensureDbReady, closeDb } from "@/db";
import {
  auditTrail,
  bankTransactions,
  exceptions,
  ledgerEntries,
  paymentRecords,
  reconciliationResults,
  reconciliationRuns,
} from "@/db/schema";
import { eq } from "drizzle-orm";

test.after(async () => {
  await closeDb();
});

test("database schema tables exist and can be queried", async () => {
  await ensureDbReady();

  // Test selecting from each table
  const runs = await db.select().from(reconciliationRuns).limit(1);
  assert.ok(Array.isArray(runs));

  const bank = await db.select().from(bankTransactions).limit(1);
  assert.ok(Array.isArray(bank));

  const ledger = await db.select().from(ledgerEntries).limit(1);
  assert.ok(Array.isArray(ledger));

  const payments = await db.select().from(paymentRecords).limit(1);
  assert.ok(Array.isArray(payments));

  const results = await db.select().from(reconciliationResults).limit(1);
  assert.ok(Array.isArray(results));

  const ex = await db.select().from(exceptions).limit(1);
  assert.ok(Array.isArray(ex));

  const audit = await db.select().from(auditTrail).limit(1);
  assert.ok(Array.isArray(audit));
});

test("database handles transactional inserts and cascade deletes", async () => {
  await ensureDbReady();

  // 1. Create a test run
  const [testRun] = await db
    .insert(reconciliationRuns)
    .values({
      batchName: "Test Run for DB Verification",
      sourceType: "synthetic",
      startedAt: new Date(),
      completedAt: new Date(),
      recordsProcessed: 1,
      ruleProcessingMs: 10,
      aiProcessingMs: 0,
      totalProcessingMs: 10,
      metrics: { test: true },
    })
    .returning();

  assert.ok(testRun?.id);
  const runId = testRun.id;

  // 2. Insert a bank transaction linked to the run
  const [bankTxn] = await db
    .insert(bankTransactions)
    .values({
      runId,
      bankTransactionId: "BNK-TEST-001",
      transactionDate: "2026-09-04",
      valueDate: "2026-09-04",
      description: "Test Bank Transfer",
      amount: "150.00",
      currency: "USD",
      transactionType: "DEBIT",
      accountNumberMasked: "****1234",
      normalizedMerchant: "TEST MERCHANT",
    })
    .returning();

  assert.ok(bankTxn?.id);

  // 3. Insert an exception linked to the run
  const [testException] = await db
    .insert(exceptions)
    .values({
      runId,
      exceptionId: "EX-TEST-001",
      transactionId: "TXN-TEST-001",
      exceptionType: "AMOUNT_MISMATCH",
      severity: "MEDIUM",
      status: "OPEN",
      confidence: "0.8500",
      reason: "Amount difference detected",
      recommendedAction: "Review manually",
    })
    .returning();

  assert.ok(testException?.id);

  // 4. Verify records are queryable
  const foundExceptions = await db
    .select()
    .from(exceptions)
    .where(eq(exceptions.runId, runId));
  assert.equal(foundExceptions.length, 1);
  assert.equal(foundExceptions[0].exceptionId, "EX-TEST-001");

  // 5. Delete run and verify cascade delete worked
  await db.delete(reconciliationRuns).where(eq(reconciliationRuns.id, runId));

  const remainingBank = await db
    .select()
    .from(bankTransactions)
    .where(eq(bankTransactions.runId, runId));
  assert.equal(remainingBank.length, 0);

  const remainingExceptions = await db
    .select()
    .from(exceptions)
    .where(eq(exceptions.runId, runId));
  assert.equal(remainingExceptions.length, 0);
});
