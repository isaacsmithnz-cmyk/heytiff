import { after, NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { exchangeSm8Code, fetchSm8Vendor, sm8Config, type Sm8VendorResult } from "@/lib/integrations/sm8";
import { readSm8Accounts, saveSm8Connection } from "@/lib/integrations/sm8-store";
import { countConnectionsElsewhere } from "@/lib/integrations/store";
import { runSm8SyncWhenFree, switchSm8AccountUnderLease } from "@/lib/integrations/sm8-sync";
import { decodeState, stateCookieFor, stateMatches } from "@/lib/integrations/oauth-state";
import { sm8WebhooksState } from "@/lib/integrations/sm8-hooks-switch";
import { ENSURE_MIN_LEFT_MS, functionDeadline } from "@/lib/integrations/sm8-hook-plan";

/* Step two: ServiceM8 sends the browser back here with a code. Swap it for
   tokens, read which account the grant covers, store it sealed, done. The
   Xero callback's clone, and the same rule holds:

   THE ORDER OF THE CHECKS IS THE SECURITY. Session, then owner, then state —
   and the state check compares BOTH halves of the cookie: the random value
   (CSRF, so somebody else's code can't be walked in) and the org the flow
   began in (ours, so an org switch mid-consent can't land a company's jobs on
   the wrong workspace). Only then is a code exchanged.

   The cookie is cleared on every path out of here, including the failures. A
   state that survived a failed attempt is a state that could be replayed.

   THE VENDOR READ DECIDES WHICH ACCOUNT THIS IS, and so what may happen:
   - An account another HeyTiff workspace already holds is refused, and
     nothing is saved: ServiceM8's rate limit is per account, and two
     workspaces writing to one account would double every note. The unique
     index on tenant_id is the backstop for two connects at once.
   - A different account from the one this workspace had REPLACES it: the
     new grant is saved with sending off, and the old account's copy is
     cleared (switchSm8Account, under the sync lease) before the first sync
     of the new one starts. "Had" is the connection's account, or, for a
     nameless connection or none at all, the account the copy came from —
     sm8_vendor outlives a disconnect, so Disconnect then Connect of another
     account is a change of account too.
   - The same account is an ordinary reconnect: new tokens, nothing cleared.
   - Which account this workspace had must be READ, not assumed: a failed
     read saves nothing, because saving over a row it couldn't see could
     erase the account a working connection holds.
   For a FIRST connect the read is still best-effort. Xero revokes an
   unstorable grant; ServiceM8 has no revocation endpoint, so failing a first
   connect because the NAME couldn't be read would strand a live grant nothing
   here can clean up — a nameless row still reads jobs, and the next sync
   names it. But replacing a working connection needs the name: without it a
   changed account can't be told from the same one, so that reconnect is
   refused and the working grant is kept. */

/* Switching accounts clears the old copy — tens of thousands of mirror rows
   and the cached photos — before the redirect; and behind it, the first
   sync slice and then, with live updates on, the subscribing (a list, six
   POSTs that each wait on ServiceM8's challenge to us, a list, DELETEs). So
   the platform's whole 300 s, where 60 used to lower it. */
export const maxDuration = 300;

/* LIVE UPDATES OWE A ROTATION ON EVERY CONNECT (two-way phase 4). With
   SM8_WEBHOOKS on, a saved connect marks it (rotate_wanted_at), one write
   before the redirect — so it is owed even if nothing behind the response
   runs — and behind the response, after the first sync slice as ever, the
   reconcile mints a new secret and subscribes at it, when at least a
   minute of the function is left. Otherwise the next page load or the
   nightly run finds the mark and does it. The old address stays good for
   72 h, so ServiceM8's retries to it are never answered 410. Off, none of
   this happens and the subscribing machinery isn't even loaded. */
async function oweRotation(orgId: string, account: string | null): Promise<void> {
  const { markSm8RotationOwed } = await import("@/lib/integrations/sm8-hooks");
  await markSm8RotationOwed(orgId, account);
}

/** Behind the response: the connect's sync slice, as always; then, with
    live updates on, the reconcile with a rotation, in what is left. */
async function afterConnect(orgId: string, calledAt: number): Promise<void> {
  await runSm8SyncWhenFree(orgId, "connect").catch(() => {});
  const left = functionDeadline(calledAt, maxDuration) - Date.now();
  if (left < ENSURE_MIN_LEFT_MS) {
    console.warn(`[sm8] live updates for org ${orgId}: no time left to subscribe after the connect; the next page load or night does it`);
    return;
  }
  const { ensureSm8Webhooks } = await import("@/lib/integrations/sm8-hooks");
  await ensureSm8Webhooks(orgId, { rotate: true, budgetMs: left });
}

const SCREEN = "/dashboard/admin/integrations/servicem8";
const COOKIE = stateCookieFor("servicem8");

function leave(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`${SCREEN}${query}`, request.url));
  response.cookies.set({
    name: COOKIE.name,
    value: "",
    path: COOKIE.path,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const calledAt = Date.now();
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  if (!hasMinRole(await getDbRole(), "owner")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const params = request.nextUrl.searchParams;
  const cookie = decodeState(request.cookies.get(COOKIE.name)?.value);

  /* ServiceM8's own refusal comes back as ?error=. `access_denied` is somebody
     pressing Cancel — an ordinary outcome, worded that way. Anything else is
     generic: an upstream error string is not ours to repeat. */
  const upstreamError = params.get("error");
  if (upstreamError) {
    return leave(request, upstreamError === "access_denied" ? "?error=denied" : "?error=exchange");
  }

  if (!stateMatches(cookie, params.get("state"), orgId)) {
    return leave(request, "?error=state");
  }
  const code = params.get("code");
  if (!code) return leave(request, "?error=exchange");

  const cfg = sm8Config();
  if (!cfg) return leave(request, "?error=unconfigured");

  const result = await exchangeSm8Code(cfg, code);
  if (!result.ok) return leave(request, "?error=exchange");

  /* Asked twice: one blip shouldn't decide whether a reconnect can go ahead.
     A 402 isn't asked again — it is the account's state, not a blip. The
     read goes uncounted (meter null): which account's counter it belongs to
     is what it is asking. */
  const connectRead = { accessToken: result.tokens.accessToken, meter: null, lane: "read" } as const;
  let vendorResult: Sm8VendorResult = await fetchSm8Vendor(connectRead);
  if (!vendorResult.ok && !vendorResult.paymentRequired) {
    vendorResult = await fetchSm8Vendor(connectRead);
  }
  const accounts = await readSm8Accounts(orgId);
  if (!accounts.ok) return leave(request, "?error=save");
  const { connected, mirrored } = accounts;
  const userId = session.user.sub as string;

  if (!vendorResult.ok) {
    if (vendorResult.paymentRequired) return leave(request, "?error=billing");
    /* A working connection is kept rather than replaced blind: saving now
       would overwrite the account it holds with nothing, and with it the one
       fact that tells a changed account from the same one. */
    if (connected?.tenantId) return leave(request, "?error=account");
    const saved = await saveSm8Connection({ orgId, userId, tokens: result.tokens, vendor: null });
    if (!saved.ok) return leave(request, saved.elsewhere ? "?error=elsewhere" : "?error=save");
    if (sm8WebhooksState() === "on") {
      await oweRotation(orgId, null);
      after(() => afterConnect(orgId, calledAt));
    } else {
      after(() => runSm8SyncWhenFree(orgId, "connect").catch(() => {}));
    }
    return leave(request, "?connected=1");
  }

  const vendor = vendorResult.vendor;

  // One ServiceM8 account, one workspace.
  if ((await countConnectionsElsewhere(orgId, "servicem8", vendor.uuid)) > 0) {
    return leave(request, "?error=elsewhere");
  }

  /* The account this workspace held: the connection's, or, for a nameless
     connection, the mirror's. Only two known and different accounts are a
     switch — nothing is ever cleared on a missing value. */
  const was = connected?.tenantId
    ? { uuid: connected.tenantId, name: connected.tenantName }
    : mirrored
      ? { uuid: mirrored.uuid, name: mirrored.name }
      : null;
  const switching = was !== null && was.uuid !== vendor.uuid;
  const now = Date.now();

  const saved = await saveSm8Connection({ orgId, userId, tokens: result.tokens, vendor, switching, now });
  if (!saved.ok) {
    /* The exchange succeeded but the row didn't land. With no revocation
       endpoint there is nothing to call — the authorisation stays live on
       ServiceM8's side until the owner removes the add-on there, which the
       screen's error copy points at. */
    return leave(request, saved.elsewhere ? "?error=elsewhere" : "?error=save");
  }

  const hooksOn = sm8WebhooksState() === "on";
  if (hooksOn) await oweRotation(orgId, vendor.uuid);

  /* The old account's copy goes BEFORE the first sync of the new one is
     scheduled, so that sync starts from nothing — and under the sync lease,
     so a run still walking the old account can't land a page after its table
     was cleared. A run holding the lease is skipped, not waited on: it stops
     at its next check, and the first sync below waits for it and finishes
     the switch. So does any clear that doesn't finish: the copy's own row
     still names the old account until it has gone. */
  let switched = false;
  if (switching && was) {
    const sw = await switchSm8AccountUnderLease(orgId, { to: vendor, from: was, now });
    switched = sw.ok;
    if (!sw.ok) console.error(`[sm8] the account switch for org ${orgId} didn't finish (${sw.reason}); the next sync repeats it`);
    else if (!sw.cleared) console.error(`[sm8] the old account's copy for org ${orgId} isn't fully cleared; the next sync finishes it`);
  }

  /* First backfill slice, scheduled AFTER the redirect lands — a floating
     promise would be frozen the moment this response returns on Vercel;
     after() rides the invocation's waitUntil instead. Bounded by the
     engine's page budget; the screen's per-object progress shows the rest
     arriving across subsequent kicks. */
  if (hooksOn) after(() => afterConnect(orgId, calledAt));
  else after(() => runSm8SyncWhenFree(orgId, "connect").catch(() => {}));

  return leave(request, switched ? "?connected=1&switched=1" : "?connected=1");
}
