import { parseBankCsv, parseLedgerCsv, parsePaymentCsv } from "@/lib/finance/csv";
import { generateSyntheticDataset } from "@/lib/finance/generator";
import { persistRun } from "@/lib/finance/repository";
import { createFallbackGroundTruthFromData, runReconciliation } from "@/lib/finance/reconciliation";
import type { DatasetBundle } from "@/lib/finance/types";

export const dynamic = "force-dynamic";

interface RunRequest {
  mode?: "demo" | "upload";
  transactionCount?: number;
  seed?: number;
  batchName?: string;
  bankCsv?: string;
  ledgerCsv?: string;
  paymentCsv?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunRequest;

    let dataset: DatasetBundle;
    let sourceType = "synthetic";

    if (body.mode === "upload") {
      if (!body.bankCsv || !body.ledgerCsv || !body.paymentCsv) {
        return Response.json(
          { ok: false, error: "Upload mode requires bankCsv, ledgerCsv, and paymentCsv." },
          { status: 400 },
        );
      }

      const bank = parseBankCsv(body.bankCsv);
      const ledger = parseLedgerCsv(body.ledgerCsv);
      const payments = parsePaymentCsv(body.paymentCsv);

      dataset = {
        bank,
        ledger,
        payments,
        groundTruth: createFallbackGroundTruthFromData({ bank, ledger, payments }),
      };
      sourceType = "upload";
    } else {
      const count = Math.max(50, Math.min(400, body.transactionCount ?? 150));
      dataset = generateSyntheticDataset(count, body.seed ?? 20260903);
    }

    const output = await runReconciliation(dataset);

    const runId = await persistRun({
      batchName: body.batchName ?? (body.mode === "upload" ? "Uploaded Batch" : "Demo Dataset Batch"),
      sourceType,
      dataset,
      output,
    });

    return Response.json({ ok: true, runId, metrics: output.metrics });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
