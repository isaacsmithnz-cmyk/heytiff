import { ok, requireMobile } from "@/lib/mobile/auth";
import { landJobPdf } from "@/lib/mobile/job-photos";

/* A PDF FROM THE PHONE, step two: its bytes are in, and it shows among the job's documents. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; doc: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const { id, doc } = await params;
  const r = await landJobPdf(ctx, id, doc.trim().slice(0, 80));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
