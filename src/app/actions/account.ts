"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  isAuth0ManagementConfigured,
  sendVerificationEmail,
  setUserEmail,
  type MgmtError,
} from "@/lib/integrations/auth0-management";
import { normaliseEmail, validateNewEmail } from "@/lib/account/email-change";

/* YOUR SIGN-IN ADDRESS — the one account fact this app can change.

   THE WHOLE SECURITY MODEL IS ONE LINE: the user id comes from the session
   and from nowhere else. It is never a parameter, never read off the form,
   never resolved from a staff id — because `update:users` can move ANY
   address in the tenant, and a function here that accepted an id would be an
   account-takeover endpoint wearing a profile screen. There is deliberately
   no admin version of this: an owner who could change a colleague's sign-in
   address could take their account, and "the owner can do anything" is not
   true of identity.

   WHY IT IS NOT A STAFF-CARD SAVE. `staff_profiles.contact_email` is a
   contact detail — where the business writes to you — and the profile screen
   already edits it as an ordinary field. This is the address you SIGN IN
   with. They are different facts with different consequences and they are
   deliberately not the same control: changing the first is a typo you fix
   later, changing the second can lock you out.

   NOTHING HERE HANDLES A PASSWORD. The change is authorised by holding a live
   session, and the new address is marked unverified until its owner proves
   they can read it. */

export type EmailChangeOutcome =
  | { ok: true; email: string; verificationSent: boolean }
  | { ok: false; error: string };

/** What each Management failure means to the person looking at the screen.

    `NO_GRANT` is the one that will actually happen, and it is a sentence
    about configuration rather than an apology: the tenant has never
    authorised this application for the Management API, and no amount of
    retrying changes that. */
const SAYS: Record<MgmtError, string> = {
  NOT_CONFIGURED: "This workspace isn’t connected to an identity provider yet.",
  NO_GRANT:
    "HeyTiff isn’t allowed to change sign-in addresses yet — the Auth0 application needs the Management API grant with update:users.",
  EMAIL_IN_USE: "Someone already signs in with that address.",
  REJECTED: "That address was refused by the identity provider.",
  UNAVAILABLE: "Couldn’t reach the identity provider. Nothing was changed.",
};

export async function changeMySignInEmail(next: string): Promise<EmailChangeOutcome> {
  /* Narrowed in one step so the session itself stays non-null for
     `updateSession` below — checking `userId` alone leaves TypeScript
     believing the session could still be missing when the cookie is
     rewritten, and the cast that silenced that would be the one place a
     signed-out caller slipped through. */
  const session = await auth0.getSession();
  if (!session?.user?.sub) return { ok: false, error: "You need to be signed in." };
  const userId = session.user.sub;
  const current = session.user.email ?? null;

  if (!isAuth0ManagementConfigured()) return { ok: false, error: SAYS.NOT_CONFIGURED };

  const verdict = validateNewEmail(next, current);
  if (!verdict.ok) return { ok: false, error: verdict.error };
  const email = verdict.email;

  const moved = await setUserEmail(userId, email);
  if (!moved.ok) return { ok: false, error: SAYS[moved.error] };

  /* OUR COPY, BROUGHT LEVEL. `profiles` is a mirror of the identity provider
     — it is re-upserted from the session on every login — so this write is
     only about the next few minutes: without it the screen would keep showing
     the old address until the person signs out and back in, and look like the
     change had failed. Best effort for the same reason it is not the truth. */
  try {
    await supabaseAdmin.from("profiles").update({ email }).eq("user_id", userId);
  } catch {
    /* The address HAS moved. Failing here would report a lie. */
  }

  /* THE SESSION COOKIE IS NOT REISSUED BY AN EMAIL CHANGE, and until this
     was here that made the whole screen look broken: Auth0 had the new
     address, `profiles` had it, and every page still rendered the old one —
     because `session.user.email` is a claim minted at LOGIN and nothing had
     minted a new one. Isaac hit exactly that, changed his address, verified
     it, and came back to the old one on both Sign-in and Summary.

     `updateSession` rewrites the cookie in place, which the SDK documents as
     supported in Server Actions. Only `email` is touched — the rest of the
     claims are still the ones the login issued, and inventing fresher values
     for them would be guessing. `email_verified` is deliberately NOT written:
     Auth0 holds the truth about that and it changes again the moment the
     person clicks the link in the mail.

     Best effort, like the two writes above it. The address HAS moved; a
     stale cookie is a display problem, and failing here would report that
     nothing happened when everything did. */
  try {
    await auth0.updateSession({
      ...session,
      user: { ...session.user, email },
    });
  } catch {
    /* Falls back to what it did before: correct after the next sign-in. */
  }

  /* Never fatal: the sign-in address has already changed, and reporting
     failure because the courier was busy would tell the person nothing
     happened when in fact everything did. It comes back as an extra line. */
  const sent = await sendVerificationEmail(userId);

  revalidatePath("/dashboard/profile");
  return { ok: true, email, verificationSent: sent.ok };
}

/* Re-exported so the screen can render the current address without a second
   session read, and so the two never disagree about normalisation. */
export async function mySignInEmail(): Promise<string | null> {
  const session = await auth0.getSession();
  const email = session?.user?.email as string | undefined;
  return email ? normaliseEmail(email) : null;
}
