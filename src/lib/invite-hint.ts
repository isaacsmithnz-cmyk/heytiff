import type { NextRequest, NextResponse } from "next/server";

/* THE ADDRESS, CARRIED ACROSS AUTH0'S PASSWORD SCREEN.

   A new invitee sets a password on Auth0's screen (a ticket the accept route
   mints), and that screen's Sign in button goes to the application's Login
   URI — plain `/auth/login`, the same for every user, with nothing on it to
   say who is coming. Setting a password does not sign anyone in, so they met
   an empty sign-in form straight after choosing a password: the first time
   they typed their address at all, and the third time they typed the password.

   So the accept route leaves the invited address in a cookie on its way to the
   ticket, and the proxy adds it as `login_hint` to the one bare sign-in that
   follows — the same Auth0 parameter the accept route already sets on its own
   redirects. A hint, never a gate: Auth0 only prefills the field.

   BARE MEANS BARE. A sign-in that already names somebody, or opens the
   sign-up tab (the front door's Create account), is left alone. The cookie is
   HttpOnly, scoped to /auth, lives as long as the ticket does, and the
   callback clears it, so it prefills one sign-in and is gone. */

export const INVITEE_HINT_COOKIE = "ht_invitee";

/** The password ticket's own life (PASSWORD_TICKET_TTL_SEC): past it, the
    screen the hint was for is gone too. */
const HINT_MAX_AGE_SEC = 3600;

export function setInviteeHint(res: NextResponse, email: string): NextResponse {
  res.cookies.set(INVITEE_HINT_COOKIE, email, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth",
    maxAge: HINT_MAX_AGE_SEC,
  });
  return res;
}

/** The sign-in URL with the invitee's address added, or null to leave it be. */
export function hintedLoginUrl(request: NextRequest): URL | null {
  if (request.nextUrl.pathname !== "/auth/login") return null;
  const email = request.cookies.get(INVITEE_HINT_COOKIE)?.value;
  if (!email) return null;
  const params = request.nextUrl.searchParams;
  if (params.has("login_hint") || params.has("screen_hint")) return null;
  const to = request.nextUrl.clone();
  to.searchParams.set("login_hint", email);
  return to;
}

export function clearInviteeHint(res: NextResponse): NextResponse {
  res.cookies.set(INVITEE_HINT_COOKIE, "", { path: "/auth", maxAge: 0 });
  return res;
}
