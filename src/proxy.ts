import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

// Login gate only (optimistic, per Next 16 proxy guidance). Fine-grained HQ
// staff authorization (the HQ_EMAILS allowlist → 404) lives in the /hq layout,
// pages and every /hq server action — never here.
const protectedRoutes = ["/dashboard", "/hq", "/welcome", "/start"];

/* Routes that need a WORKSPACE, not just a login.

   Signing in no longer founds a company (lib/auth0.ts), so "signed in with no
   org" is now a normal state rather than a failure — and every screen below
   reads org-scoped data, so landing there without one is a page of nothing.
   /start is where those people go.

   THIS IS STILL NOT A DATA READ. orgId is already in the session the login
   gate above just fetched, so the check costs nothing and the rule the file
   header sets — no DB in the proxy — holds.

   /hq is deliberately absent: it is HeyTiff's own portal, gated by an email
   allowlist, and belonging to a customer workspace is not what qualifies you
   for it. /start is absent for the obvious reason. */
const orgRoutes = ["/dashboard", "/welcome"];

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
    if (!session.orgId && orgRoutes.some((route) => path.startsWith(route))) {
      return NextResponse.redirect(new URL("/start", request.url));
    }
  }

  return authResponse;
}

export const config = {
  /* `brand` joins the exclusions because Auth0 and every mail client fetch
     those files — the logo, the font — while nobody is signed in, from their
     own servers. Running the session middleware on a PNG request achieved
     nothing except doing it on every one of them. */
  matcher: [
    "/((?!_next/static|_next/image|brand/|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
