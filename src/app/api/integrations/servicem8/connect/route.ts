import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { tokenKey } from "@/lib/integrations/secrets";
import { buildSm8ConsentUrl, sm8Config } from "@/lib/integrations/sm8";
import { sm8ScopesWanted } from "@/lib/integrations/providers";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { encodeState, stateCookieFor, STATE_TTL_SECONDS } from "@/lib/integrations/oauth-state";

/* Step one of ServiceM8's OAuth 2.0 authorisation-code flow: mint a state,
   remember it in an httpOnly cookie, and hand the browser to ServiceM8. The
   Xero connect route's clone — same gates, same order, same reasons.

   OWNER ONLY. Connecting the company's job system is owner-intrinsic: the
   grant reaches every client, address and schedule at once. A route handler
   is reachable directly, so the gate is here, not only on the page.

   A GET that mutates nothing but a cookie is why this is a plain <a> on the
   screen and not a <Link>: prefetch on hover would mint a state per hover and
   quietly replace the one a half-finished flow is relying on. */

const SCREEN = "/dashboard/admin/integrations/servicem8";
const COOKIE = stateCookieFor("servicem8");

const back = (request: Request, error: string) =>
  NextResponse.redirect(new URL(`${SCREEN}?error=${error}`, request.url));

export async function GET(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  if (!hasMinRole(await getDbRole(), "owner")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const cfg = sm8Config();
  if (!cfg) return back(request, "unconfigured");
  // Checked BEFORE consent, not after: sending someone through ServiceM8's
  // approval screen only to discover we can't store what it returns wastes
  // their time — and with no revoke endpoint over there, it would leave a
  // live grant nothing here can even clean up.
  if (!tokenKey()) return back(request, "nokey");

  const state = randomBytes(16).toString("hex");

  /* The owner's write switch decides the ask: while writing is on or
     paused, the consent carries the write scopes of the kinds this
     deployment allows beside the reads, so reconnecting (for any reason)
     keeps the permission the switch depends on. Off, or on a deployment
     that can't write at all, it is the read list alone.

     SETTINGS THAT CAN'T BE READ REFUSE THE CONNECT, on a deployment that
     writes. Guessing "off" there would ask for reads alone, and a reconnect
     of a live workspace would drop the write permission its sending depends
     on. A deployment that writes nothing asks for the reads whatever the
     settings say, so it has nothing to refuse for — and a database the
     write migration hasn't reached yet can't block a connect there. */
  const writes = await readSm8WriteState(orgId);
  if (writes.deployment && !writes.readable) return back(request, "settings");
  /* the kinds the deployment allows AND the owner has on: Notes Off asks for
     no notes permission, and a files-only deployment never asks for one */
  const kinds = writes.kinds.filter((k) => writes.ownerKinds.includes(k));
  const scopes = sm8ScopesWanted(writes.deployment ? writes.mode : "off", kinds);

  const response = NextResponse.redirect(buildSm8ConsentUrl(cfg, state, scopes));
  response.cookies.set({
    name: COOKIE.name,
    value: encodeState({ state, orgId }),
    httpOnly: true,
    sameSite: "lax", // ServiceM8 returns via a top-level GET; "strict" would drop it
    secure: process.env.NODE_ENV === "production",
    path: COOKIE.path,
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
