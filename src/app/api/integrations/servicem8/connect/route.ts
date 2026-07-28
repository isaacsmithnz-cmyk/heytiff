import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { tokenKey } from "@/lib/integrations/secrets";
import { buildSm8ConsentUrl, sm8Config } from "@/lib/integrations/sm8";
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

  const response = NextResponse.redirect(buildSm8ConsentUrl(cfg, state));
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
