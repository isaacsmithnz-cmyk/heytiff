import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

// Login gate only (optimistic, per Next 16 proxy guidance). Fine-grained HQ
// staff authorization (the HQ_EMAILS allowlist → 404) lives in the /hq layout,
// pages and every /hq server action — never here.
const protectedRoutes = ["/dashboard", "/hq"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Auth0 handles /auth/* routes and maintains rolling sessions on all routes
  const authResponse = await auth0.middleware(request);

  if (path.startsWith("/auth/")) {
    return authResponse;
  }

  if (protectedRoutes.some((route) => path.startsWith(route))) {
    const session = await auth0.getSession(request);
    if (!session) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    /* SIGNED IN, BUT PART OF NO COMPANY — the state that exists now that an
       uninvited first login no longer mints an org for itself (lib/auth0.ts).

       It needs a door of its own because every screen under /dashboard fails
       SOFTLY without an org: `loadDashboard` returns EMPTY, `getCapabilities`
       returns none, so the rail draws nothing and Home renders a complete,
       well-formed page with zero of everything in it. That is indistinguishable
       from a product that has lost your data, and it was already the experience
       of anyone who signed in before clicking their invite link.

       Only /dashboard is diverted. /hq is the platform-staff portal behind the
       HQ_EMAILS allowlist and those logins are not org members by design, so
       sending them to /no-org would lock the portal against its own operators. */
    if (path.startsWith("/dashboard") && !(session as { orgId?: string }).orgId) {
      return NextResponse.redirect(new URL("/no-org", request.url));
    }
  }

  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
