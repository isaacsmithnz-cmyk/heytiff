import { ok, requireMobile } from "@/lib/mobile/auth";

/* WHAT WENT WRONG ON A PHONE, in the server's own log (Isaac, 29 October
   2026: a voice note "not working" left no trace anywhere, because it failed
   on the phone before anything was sent). The phone says where and what, in
   a sentence; it is written to the log with who, and kept nowhere else.
   Nothing about the person beyond their sign-in, and never what they said. */
const MAX = 300;
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[\r\n]+/g, " ").slice(0, MAX) : "");

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as { where?: unknown; message?: unknown; app?: unknown };
  const where = clean(body.where);
  if (!where) return Response.json({ error: "Say where." }, { status: 400, headers: { "cache-control": "no-store" } });
  console.warn(`[phone] ${ctx.userId} ${clean(body.app)} ${where}: ${clean(body.message)}`);
  return ok({ ok: true });
}
