import { confirmKbUpload } from "@/app/actions/kb";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";

/* The phone saying a manual's bytes landed: the web's own confirmKbUpload, as
   the token's person. Until this runs the row is invisible in the Library. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "tiff_manage");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  const r = await actAsPhoneUser(ctx, () => confirmKbUpload(id));
  if (!r.ok) return Response.json({ error: r.error }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ landed: true });
}
