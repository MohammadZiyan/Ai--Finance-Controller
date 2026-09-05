import { initDb } from "./init";
import { generateSyntheticDataset } from "@/lib/finance/generator";
import { runReconciliation } from "@/lib/finance/reconciliation";
import { persistRun } from "@/lib/finance/repository";
import { db } from "./index";
import { exceptions, reconciliationRuns, reconciliationResults } from "./schema";
import { eq, sql } from "drizzle-orm";

export async function seedDb(transactionCount = 150, randomSeed = 20260904): Promise<number> {
  // Ensure database schema is ready
  await initDb();

  console.log("==================================================");
  console.log(`[DB SEED] Generating synthetic financial dataset (${transactionCount} transactions)...`);
  console.log("==================================================");

  const dataset = generateSyntheticDataset(transactionCount, randomSeed);
  console.log(`[DB SEED] Generated source records:`);
  console.log(`  - Bank statement records:     ${dataset.bank.length}`);
  console.log(`  - Internal ledger entries:    ${dataset.ledger.length}`);
  console.log(`  - Payment settlement records: ${dataset.payments.length}`);

  console.log("\n[DB SEED] Running deterministic, fuzzy & AI reconciliation engine...");
  const startTime = Date.now();
  const output = await runReconciliation(dataset);
  const elapsedMs = Date.now() - startTime;

  console.log(`[DB SEED] Reconciliation completed in ${elapsedMs}ms.`);
  console.log(`[DB SEED] Persisting run results, transactions, exceptions, and audit logs...`);

  const runId = await persistRun({
    batchName: `Synthetic Demo Batch #${new Date().toISOString().slice(0, 10)}`,
    sourceType: "synthetic",
    dataset,
    output,
  });

  // Query summary from DB
  const [run] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, runId));
  const resultsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(reconciliationResults)
    .where(eq(reconciliationResults.runId, runId));
  const exceptionsCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(exceptions)
    .where(eq(exceptions.runId, runId));

  console.log("==================================================");
  console.log(`[DB SEED] SUCCESS! Persisted Reconciliation Run ID: ${runId}`);
  console.log("==================================================");
  console.log(`  - Batch Name:           ${run?.batchName}`);
  console.log(`  - Records Processed:    ${run?.recordsProcessed}`);
  console.log(`  - Reconciled Decisions: ${resultsCount[0]?.count ?? 0}`);
  console.log(`  - Exceptions Detected:  ${exceptionsCount[0]?.count ?? 0}`);
  console.log(`  - Precision:            ${(output.metrics.precision ?? 0).toFixed(1)}%`);
  console.log(`  - Recall:               ${(output.metrics.recall ?? 0).toFixed(1)}%`);
  console.log(`  - F1 Score:             ${(output.metrics.f1Score ?? 0).toFixed(1)}%`);
  console.log(`  - Throughput:           ${output.metrics.throughputPerSecond.toFixed(1)} records/sec`);
  console.log("==================================================");

  return runId;
}

// CLI execution
if (require.main === module || process.argv[1]?.endsWith("seed.ts")) {
  const countArg = process.argv.find((a) => a.startsWith("--count="));
  const count = countArg ? parseInt(countArg.split("=")[1], 10) : 150;

  seedDb(count)
    .then(() => {
      console.log("[DB SEED] Seeding completed successfully.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[DB SEED] Seeding failed:", err);
      process.exit(1);
    });
}
