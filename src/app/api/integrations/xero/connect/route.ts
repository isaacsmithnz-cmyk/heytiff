import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { tokenKey } from "@/lib/integrations/secrets";
import { buildConsentUrl, xeroConfig } from "@/lib/integrations/xero";
import {
  encodeState,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  STATE_TTL_SECONDS,
} from "@/lib/integrations/oauth-state";

/* Step one of Xero's OAuth 2.0 authorisation-code flow: mint a state, remember
   it in an httpOnly cookie, and hand the browser to Xero.

   OWNER ONLY. Connecting the company's accounting system is owner-intrinsic,
   like organisation settings and billing — it is not a capability an owner can
   delegate, because the grant it creates reaches wages, bills and the P&L all
   at once. A route handler is reachable directly, so the gate is here, not
   only on the page that links to it.

   A GET that mutates nothing but a cookie is why this is a plain <a> on the
   screen and not a <Link>: prefetch on hover would mint a state per hover and
   quietly replace the one a half-finished flow is relying on. */

const SCREEN = "/dashboard/admin/integrations/xero";

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

  const cfg = xeroConfig();
  if (!cfg) return back(request, "unconfigured");
  // Checked BEFORE consent, not after: sending someone through Xero's approval
  // screen only to discover we can't store what it returns wastes their time
  // and leaves a live grant on Xero's side that nothing here can use.
  if (!tokenKey()) return back(request, "nokey");

  const state = randomBytes(16).toString("hex");
  const url = await buildConsentUrl(cfg, state);
  if (!url) return back(request, "exchange");

  const response = NextResponse.redirect(url);
  response.cookies.set({
    name: STATE_COOKIE,
    value: encodeState({ state, orgId }),
    httpOnly: true,
    sameSite: "lax", // Xero returns via a top-level GET; "strict" would drop it
    secure: process.env.NODE_ENV === "production",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_SECONDS,
  });
  return response;
}
