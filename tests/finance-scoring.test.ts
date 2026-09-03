import test from "node:test";
import assert from "node:assert/strict";
import { amountSimilarity, dateSimilarity, tokenJaccardSimilarity } from "@/lib/finance/scoring";

test("amount similarity penalizes mismatches", () => {
  assert.equal(amountSimilarity(10000, 10000), 1);
  assert.ok(amountSimilarity(10000, 9500) < 1);
});

test("date similarity respects tolerance", () => {
  const near = dateSimilarity("2026-08-01", "2026-08-02", 3);
  const far = dateSimilarity("2026-08-01", "2026-08-15", 3);

  assert.ok(near > far);
});

test("description token similarity", () => {
  const sim = tokenJaccardSimilarity("Amazon Web Services", "AWS India");
  assert.ok(sim >= 0);
  assert.ok(sim <= 1);
});
