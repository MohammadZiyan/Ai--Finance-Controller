import { generateSyntheticDataset } from "@/lib/finance/generator";
import { persistRun } from "@/lib/finance/repository";
import { runReconciliation } from "@/lib/finance/reconciliation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { transactionCount?: number; seed?: number; batchName?: string };
    const transactionCount = Math.max(50, Math.min(400, body.transactionCount ?? 150));
    const seed = body.seed ?? 20260903;

    const dataset = generateSyntheticDataset(transactionCount, seed);
    const output = await runReconciliation(dataset);

    const runId = await persistRun({
      batchName: body.batchName ?? `Demo Batch ${new Date().toISOString().slice(0, 10)}`,
      sourceType: "synthetic",
      dataset,
      output,
    });

    return Response.json({ ok: true, runId, metrics: output.metrics });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
