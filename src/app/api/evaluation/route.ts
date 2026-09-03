import { db } from "@/db";
import { reconciliationRuns } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("runId") ? Number(searchParams.get("runId")) : undefined;

    const [row] = runId
      ? await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, runId)).limit(1)
      : await db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.id)).limit(1);

    if (!row) {
      return Response.json({ ok: true, data: null });
    }

    return Response.json({ ok: true, data: row.metrics });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
