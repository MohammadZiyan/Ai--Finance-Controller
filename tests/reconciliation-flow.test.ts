import test from "node:test";
import assert from "node:assert/strict";
import { generateSyntheticDataset } from "@/lib/finance/generator";
import { runReconciliation } from "@/lib/finance/reconciliation";

test("end-to-end reconciliation computes metrics", async () => {
  const dataset = generateSyntheticDataset(120, 42);
  const output = await runReconciliation(dataset);

  assert.equal(output.metrics.totalTransactions, 120);
  assert.ok(output.metrics.sourceRecordsProcessed >= 120);
  assert.ok(output.decisions.length >= 120);
  assert.ok(output.metrics.precision >= 0);
  assert.ok(output.metrics.recall >= 0);
  assert.ok(output.metrics.f1Score >= 0);
  assert.ok(output.metrics.throughputPerSecond > 0);
});
