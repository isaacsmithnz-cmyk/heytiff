import { ok, requireMobile } from "@/lib/mobile/auth";
import { beginJobPdf } from "@/lib/mobile/job-photos";

/* A PDF FROM THE PHONE, step one: a slot on this job for its bytes, behind the
   job's own `workboard` grant. Step two lands it: pdfs/[doc]. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown } | null;
  const r = await beginJobPdf(ctx, (await params).id, body ?? {});
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
