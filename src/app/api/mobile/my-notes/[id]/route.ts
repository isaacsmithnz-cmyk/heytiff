import { deleteMyNote } from "@/app/actions/my-notes";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";

/* Save to my notes' Undo from the phone: the web's own deleteMyNote, as the
   token's person — only ever their own note. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  const r = await actAsPhoneUser(ctx, () => deleteMyNote(id));
  if (!r.ok) return Response.json({ error: r.error }, { status: 409, headers: { "cache-control": "no-store" } });
  return ok({ deleted: true });
}
