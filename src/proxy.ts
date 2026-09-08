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

/* THE APP HAS ONE ADDRESS, AND SIGN-IN ONLY WORKS FROM IT.

   The Auth0 SDK builds the callback from APP_BASE_URL — `go.hey-tiff.com` —
   whichever host served the page. The transaction cookie that proves the
   callback is ours is set on the host that STARTED the sign-in. So a sign-in
   begun on `www.hey-tiff.com` or `heytiff.vercel.app` (both still answer, one
   is an old bookmark, one is the future marketing site) sets its cookie
   there, comes back to `go.`, finds nothing, and the SDK answers "The state
   parameter is invalid." — a 500 with a sentence on it. Isaac read that as
   the website being down (2026-09-08).

   Send every other host to the canonical one first, path and query intact,
   before the SDK sees the request. Production only: preview deployments share
   the same APP_BASE_URL and would otherwise redirect themselves to prod. 308
   so the method survives, and so browsers cache the move. */
function canonicalHostRedirect(request: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  let canonical: URL;
  try {
    canonical = new URL(base);
  } catch {
    return null;
  }
  const host = request.headers.get("host");
  if (!host || host === canonical.host) return null;
  const to = new URL(request.nextUrl.pathname + request.nextUrl.search, canonical);
  return NextResponse.redirect(to, 308);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const moved = canonicalHostRedirect(request);
  if (moved) return moved;

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
