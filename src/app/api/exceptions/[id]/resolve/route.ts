import { resolveException } from "@/lib/finance/repository";

export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const exceptionId = Number(id);

    if (Number.isNaN(exceptionId)) {
      return Response.json({ ok: false, error: "Invalid exception id" }, { status: 400 });
    }

    const body = (await req.json()) as {
      action?: "APPROVE_MATCH" | "REJECT_MATCH" | "MARK_RESOLVED" | "KEEP_EXCEPTION";
      note?: string;
    };

    if (!body.action) {
      return Response.json({ ok: false, error: "Action is required" }, { status: 400 });
    }

    const updated = await resolveException({ id: exceptionId, action: body.action, note: body.note });
    if (!updated) {
      return Response.json({ ok: false, error: "Exception not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: updated });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
