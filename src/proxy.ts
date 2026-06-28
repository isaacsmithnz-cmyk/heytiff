import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

const protectedRoutes = ["/dashboard"];

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
  }

  return authResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
