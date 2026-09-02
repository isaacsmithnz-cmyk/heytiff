import { type NextRequest, NextResponse } from "next/server";

/* The turn-around point for Auth0's account-linking redirect.

   WHY A ROUND TRIP EXISTS AT ALL. When somebody signs in with Google, Auth0
   authenticates them AS the Google user and only then runs the post-login
   Action. The Action can move that Google identity into the password account
   it belongs with, but the login already in flight still belongs to the
   throwaway user — linking does not retroactively change whose session this
   is. `api.authentication.setPrimaryUser()` is Auth0's way of saying "this
   login is for that user instead", and it is only callable from
   `onContinuePostLogin`, which only runs after the Action has sent the
   browser somewhere and got it back.

   This is that somewhere. It renders nothing and asks nothing: Auth0 appends
   `?state=…`, and handing that same state to `/continue` resumes the login on
   the other side, where the Action can finish the job. The person sees a
   redirect flash.

   The alternative — shipped first, in auth0/actions — was to link and then
   refuse the login with "press Continue with Google once more". That worked
   and cost no endpoint, but it spent a click of every person's patience to
   save one file. This is the file.

   NOT AN OPEN REDIRECT. The destination is built here from AUTH0_DOMAIN and
   a fixed path; the only thing taken from the request is the opaque state,
   which goes in as a query VALUE and can never become the host. A `state`
   that is missing or malformed goes nowhere — see below.

   AUTH0_DOMAIN, NOT AUTH0_TENANT_DOMAIN. `/continue` belongs to the login
   transaction, so it lives on whichever domain the person is actually
   authenticating against — the custom one, once there is one. The tenant
   domain is for the Management API alone (lib/integrations/auth0-tenant-domain.ts). */

/** Auth0's state is an opaque handle it generated; anything outside this
    alphabet did not come from Auth0 and is not worth forwarding. Bounded
    because an unbounded query value is a free URL-length amplifier. */
const STATE = /^[A-Za-z0-9._~-]{1,512}$/;

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get("state");
  const domain = process.env.AUTH0_DOMAIN;

  /* Both failures land here rather than redirecting somewhere hopeful. A
     login that reaches this route without a state is not resumable — Auth0
     documents that losing it ends the transaction in `invalid_request` — so
     saying so is more use than a redirect that fails one hop later. */
  if (!domain || !state || !STATE.test(state)) {
    return new NextResponse(
      "This link is only used while signing in, and can't be opened on its own.",
      { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const url = new URL(`https://${domain}/continue`);
  url.searchParams.set("state", state);
  /* 303: this was a GET that produces no resource of its own, and the browser
     must not keep re-issuing it if the user goes back. */
  return NextResponse.redirect(url, 303);
}
