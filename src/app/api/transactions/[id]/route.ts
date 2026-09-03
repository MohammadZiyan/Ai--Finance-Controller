import { getTransactionById } from "@/lib/finance/repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId") ? Number(searchParams.get("runId")) : undefined;

    const data = await getTransactionById(id, runId);
    if (!data) {
      return Response.json({ ok: false, error: "Transaction not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
