import { ok, requireMobile } from "@/lib/mobile/auth";
import { readPhoneFavourites, setPhoneFavourite } from "@/lib/mobile/photo-favourites";

/* A JOB'S FAVOURITE PHOTOS, for the phone's gallery: which are starred, and
   a star set or taken off, behind the job's own `workboard` grant (the web's
   stars, lib/mobile/photo-favourites). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  return ok({ starred: await readPhoneFavourites(ctx, id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  const body = (await request.json().catch(() => null)) as { remoteId?: unknown; starred?: unknown } | null;
  if (typeof body?.remoteId !== "string" || typeof body.starred !== "boolean")
    return Response.json({ error: "Which photo?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await setPhoneFavourite(ctx, id, body.remoteId, body.starred);
  if (!r.ok) return Response.json({ error: r.error, starred: r.starred }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ starred: r.starred });
}
