import { ok, requireMobile } from "@/lib/mobile/auth";
import { beginJobPhoto } from "@/lib/mobile/job-photos";

/* A PHOTO FROM THE PHONE, step one: a slot on this job for its bytes (a
   signed URL the phone PUTs them to), behind the job's own `workboard`
   grant. Step two lands it: photos/[doc]. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown } | null;
  const r = await beginJobPhoto(ctx, (await params).id, body ?? {});
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
