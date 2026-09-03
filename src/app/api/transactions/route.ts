import { getTransactions } from "@/lib/finance/repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId") ? Number(searchParams.get("runId")) : undefined;
    const status = searchParams.get("status") ?? undefined;

    const data = await getTransactions(runId, status);
    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
