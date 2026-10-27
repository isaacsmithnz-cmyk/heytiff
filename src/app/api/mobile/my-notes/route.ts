import { addMyNote } from "@/app/actions/my-notes";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";

/* MY NOTES ONLY, from the phone's job box (Isaac, 28 October 2026: "My notes
   only saves a private note"): the web's own Save to my notes (actions/
   my-notes' addMyNote), run as the person the token check verified. Private:
   nothing is filed, and nothing goes to the job or to ServiceM8. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const b = (await request.json().catch(() => null)) as { body?: unknown; source?: unknown } | null;
  const body = typeof b?.body === "string" ? b.body : "";
  const r = await actAsPhoneUser(ctx, () => addMyNote({ body, source: b?.source === "voice" ? "voice" : "text" }));
  if (!r.ok) return Response.json({ error: r.error }, { status: 400, headers: { "cache-control": "no-store" } });
  return ok({ id: r.id ?? null });
}
