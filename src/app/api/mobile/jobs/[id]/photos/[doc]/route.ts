import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { landJobPhoto } from "@/lib/mobile/job-photos";

/* A PHOTO FROM THE PHONE, step two: its bytes are in. It shows on the job,
   and goes to ServiceM8 as one of the job's photos. The token check comes
   first and the press is minted from it alone (lib/mobile/job-photos). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; doc: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const press = await sm8PressFromMobile(ctx);
  const { id, doc } = await params;
  const r = await landJobPhoto(ctx, press, id, doc.trim().slice(0, 80));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
