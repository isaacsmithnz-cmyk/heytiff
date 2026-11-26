import { ok } from "@/lib/mobile/auth";
import { requireMobileIdentity } from "@/lib/mobile/identity";
import { askForNewInvite, joinInvite, readStart, resendConfirm, startBusiness } from "@/lib/mobile/start";

/* THE PHONE'S FIRST DOOR (lib/mobile/start): what's waiting for this sign-in,
   and the presses that answer it. The one phone route that takes someone with
   no workspace, so it asks requireMobileIdentity, never requireMobile. */
export async function GET(request: Request) {
  const who = await requireMobileIdentity(request);
  if (who instanceof Response) return who;
  return ok({ email: who.shownEmail, state: await readStart(who) });
}

export async function POST(request: Request) {
  const who = await requireMobileIdentity(request);
  if (who instanceof Response) return who;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const done =
    body.do === "join"
      ? await joinInvite(who, body.id)
      : body.do === "business"
        ? await startBusiness(who)
        : body.do === "ask"
          ? await askForNewInvite(who, body.id)
          : body.do === "confirm"
            ? await resendConfirm(who)
            : null;
  if (!done) return Response.json({ error: "What should happen?" }, { status: 400, headers: { "cache-control": "no-store" } });
  if (!done.ok) return Response.json({ error: done.error }, { status: done.status, headers: { "cache-control": "no-store" } });
  return ok({ ok: true });
}
