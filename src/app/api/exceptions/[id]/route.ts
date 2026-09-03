import { db } from "@/db";
import { exceptions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const exceptionId = Number(id);

    if (Number.isNaN(exceptionId)) {
      return Response.json({ ok: false, error: "Invalid exception id" }, { status: 400 });
    }

    const [row] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId)).limit(1);
    if (!row) {
      return Response.json({ ok: false, error: "Exception not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: row });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
