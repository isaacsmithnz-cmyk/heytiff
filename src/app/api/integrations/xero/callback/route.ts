import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { xeroConfig, exchangeCallback } from "@/lib/integrations/xero";
import { saveXeroConnection } from "@/lib/integrations/store";
import {
  decodeState,
  stateMatches,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
} from "@/lib/integrations/oauth-state";

/* Step two: Xero sends the browser back here with a code. Swap it for tokens,
   find out which organisation the grant covers, store it sealed, done.

   THE ORDER OF THE CHECKS IS THE SECURITY. Session, then owner, then state —
   and the state check compares BOTH halves of the cookie: the random value
   (Xero's CSRF protection, so somebody else's code can't be walked in) and the
   org the flow began in (ours, so an org switch mid-consent can't land a
   company's books on the wrong workspace). Only then is a code exchanged.

   The cookie is cleared on every path out of here, including the failures. A
   state that survived a failed attempt is a state that could be replayed. */

const SCREEN = "/dashboard/admin/integrations/xero";

function leave(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`${SCREEN}${query}`, request.url));
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    path: STATE_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
  if (!hasMinRole(await getDbRole(), "owner")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const params = request.nextUrl.searchParams;
  const cookie = decodeState(request.cookies.get(STATE_COOKIE)?.value);

  /* Xero's own refusal comes back as ?error=. `access_denied` is somebody
     pressing Cancel — an ordinary outcome, not a fault, and it is worded that
     way. Anything else is generic: an upstream error string is not ours to
     repeat. */
  const upstreamError = params.get("error");
  if (upstreamError) {
    return leave(request, upstreamError === "access_denied" ? "?error=denied" : "?error=exchange");
  }

  if (!stateMatches(cookie, params.get("state"), orgId)) {
    return leave(request, "?error=state");
  }
  if (!params.get("code")) return leave(request, "?error=exchange");

  const cfg = xeroConfig();
  if (!cfg) return leave(request, "?error=unconfigured");

  /* The SDK parses the callback URL itself. `request.url` on Vercel is the
     internal URL, which can differ in host from the registered redirect URI —
     so the query is re-hung off the configured redirect URI instead, keeping
     the exchange's `redirect_uri` and the URL it parses in agreement. */
  const callbackUrl = `${cfg.redirectUri}?${params.toString()}`;
  const result = await exchangeCallback(cfg, callbackUrl, cookie!.state);
  if (!result.ok) return leave(request, "?error=exchange");

  const saved = await saveXeroConnection({
    orgId,
    userId: session.user.sub as string,
    tokens: result.tokens,
    tenants: result.tenants,
  });
  if (!saved.ok) return leave(request, "?error=save");

  return leave(request, "?connected=1");
}
