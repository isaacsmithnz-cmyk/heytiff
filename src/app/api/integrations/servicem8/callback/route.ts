import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { exchangeSm8Code, fetchSm8Vendor, sm8Config } from "@/lib/integrations/sm8";
import { saveSm8Connection } from "@/lib/integrations/sm8-store";
import { decodeState, stateCookieFor, stateMatches } from "@/lib/integrations/oauth-state";

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

   ONE DELIBERATE DIFFERENCE from Xero: the vendor (account identity) read is
   best-effort. Xero revokes an unstorable grant; ServiceM8 has no revocation
   endpoint, so failing the whole connect because the NAME couldn't be read
   would strand a live grant nothing here can clean up. A nameless row still
   reads jobs, and the screen's proof-of-life read fills the identity in. */

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

  // Best-effort, see the header. `unauthorized` here would mean a token that
  // died between minting and first use — treated the same as unreachable.
  const vendorResult = await fetchSm8Vendor(result.tokens.accessToken);
  const vendor = vendorResult.ok ? vendorResult.vendor : null;

  const saved = await saveSm8Connection({
    orgId,
    userId: session.user.sub as string,
    tokens: result.tokens,
    vendor,
  });
  if (!saved.ok) {
    /* The exchange succeeded but the row didn't land. With no revocation
       endpoint there is nothing to call — the authorisation stays live on
       ServiceM8's side until the owner removes the add-on there, which the
       screen's error copy points at. */
    return leave(request, "?error=save");
  }

  return leave(request, "?connected=1");
}
