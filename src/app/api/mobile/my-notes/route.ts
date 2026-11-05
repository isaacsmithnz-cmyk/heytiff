import { addMyNote } from "@/app/actions/my-notes";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";
import { listMyNotes } from "@/lib/notes/my-notes-query";

/* YOUR OWN NOTES, from the phone's Notes (More › Notes): the web's own
   (actions/my-notes' addMyNote, and the Notes page's read), run as the person
   the token check verified. Private: nothing is filed, and nothing goes to a
   job or to ServiceM8. Notes is the one place a note just for you is made
   (Isaac, 6 November 2026: "have a my notes section, then add new note. It
   will stay contained to you there"). */

/** Your notes, newest first; a person with no staff card has none. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId);
  const notes = staffId ? await listMyNotes(ctx.orgId, staffId, 100) : [];
  return ok({ notes: notes.map((n) => ({ id: n.id, body: n.body, at: n.createdAt })) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const b = (await request.json().catch(() => null)) as { body?: unknown; source?: unknown } | null;
  const body = typeof b?.body === "string" ? b.body : "";
  const r = await actAsPhoneUser(ctx, () => addMyNote({ body, source: b?.source === "voice" ? "voice" : "text" }));
  if (!r.ok) return Response.json({ error: r.error }, { status: 400, headers: { "cache-control": "no-store" } });
  return ok({ id: r.id ?? null });
}
