import { getSummary } from "@/lib/finance/repository";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runIdParam = searchParams.get("runId");
    const runId = runIdParam ? Number(runIdParam) : undefined;

    const summary = await getSummary(runId);
    if (!summary) {
      return Response.json({ ok: true, data: null });
    }

    return Response.json({ ok: true, data: summary });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
