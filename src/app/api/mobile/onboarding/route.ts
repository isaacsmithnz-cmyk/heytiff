import { ok, requireMobile } from "@/lib/mobile/auth";
import { readSetup, STEPS } from "@/lib/mobile/onboarding";

/* THE PHONE'S FIRST RUN (lib/mobile/onboarding): what it still owes this
   person, with their drafts, and one POST per step by `do`. Your own card and
   your own first run need only a membership; the business's steps are each
   the web's owner-only save, refused by it for anyone else. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await readSetup(ctx));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const step = typeof body.do === "string" && Object.hasOwn(STEPS, body.do) ? STEPS[body.do as keyof typeof STEPS] : null;
  if (!step) return Response.json({ error: "What should happen?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await step(ctx, body);
  if (!r.ok) return Response.json({ error: r.error, fields: r.fields }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value ?? { ok: true });
}
