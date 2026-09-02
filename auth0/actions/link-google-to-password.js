/* Auth0 post-login Action — "Continue with Google" reaches the account you
   already have, instead of founding a second one.

   THE PROBLEM IT SOLVES. Auth0 treats a Google login and a password login as
   two different users even on the same address. Somebody who signed up with a
   password and later reaches for Google — because they forgot it, or because
   the button is right there — arrives as a brand-new user with no membership,
   no staff card and no history. Before PR #603 the app then FOUNDED them a
   company; now it sends them to /start, which is honest but is still not
   their account. Isaac and Bruce each ended up with a phantom org this way.

   WHAT IT DOES. On a Google login whose email is verified, if exactly one
   database user already holds that address, it links the Google identity into
   that user and asks the person to press Google once more. From then on the
   Google identity IS that user: same sub, same membership, same staff card,
   nothing to choose.

   ── WHY IT ASKS FOR A SECOND CLICK ────────────────────────────────────────

   Linking mid-login does not change who this login is FOR. Auth0's own note:
   it "does not automatically change to the correct primary user after Account
   Linking". The fix for that is `api.authentication.setPrimaryUser()`, which
   is only available inside `onContinuePostLogin` — i.e. after a redirect out
   to a page we host and back, with a session token to validate. That is a
   whole flow to build and maintain, and Auth0 publishes a support article
   about the primary-user update getting lost between those redirects.

   The alternative is this: link, then stop, and let them start again. The
   second attempt resolves to the primary with no special handling at all,
   because by then the Google identity genuinely belongs to it. The cost is
   one extra click, once, for each person who ever uses Google. The redirect
   flow costs an endpoint and a class of bug, forever.

   ── THE SECURITY ARGUMENT, WRITTEN DOWN ───────────────────────────────────

   Auth0 advises against automatic linking on a verified email, because a
   verified email is not proof the person can still authenticate to the other
   account. That is correct in general and is why the guards below are narrow.

   It is accepted here on one specific ground: the only identities linked are
   ones GOOGLE has verified. Whoever holds that inbox can already take the
   password account by asking for a reset — the letter lands in the same
   place. So the link grants no access that the same attacker did not already
   have, while refusing to link costs a support call every time a tradie on a
   roof forgets a password.

   That reasoning does NOT extend to an unverified email, to a second database
   account, or to a provider that does not verify addresses — and each of
   those is refused below rather than left to judgement.

   ── INSTALLING IT ─────────────────────────────────────────────────────────

   Auth0 → Actions → Library → Build Custom → post-login, then paste this in.
   It needs, under the Action's own settings:

     Secrets      AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET
                  — an M2M application with `read:users` and `update:users`
     Dependencies auth0  (latest)

   Then drag it into the Login flow and Apply. docs/auth0-account-linking.md
   has the whole thing with the reasoning. */

const GOOGLE = "google-oauth2";
const DATABASE_STRATEGY = "auth0";

/** Should this login be linked, and to whom?

    Pure, and exported, because every interesting decision here is a
    judgement about identity that deserves a test rather than a read-through.
    `matches` is what the Management API returned for this address. */
function linkDecision(event, matches) {
  const incoming = event.user;
  const strategy = event.connection && event.connection.strategy;

  /* Only ever FROM Google. A database login is already the account we want to
     link to; a second social provider has not been thought about and would be
     linked on the strength of somebody else's verification policy. */
  if (strategy !== GOOGLE) return { link: false, why: "not a Google login" };

  /* THE LOAD-BEARING GUARD. Everything above rests on Google having proved
     the address. Without this the Action would link on a claim the user could
     have typed, which is the attack Auth0 warns about. */
  if (incoming.email_verified !== true) {
    return { link: false, why: "Google has not verified this address" };
  }
  if (!incoming.email) return { link: false, why: "no email on the login" };

  const candidates = (matches || []).filter(
    (u) =>
      u.user_id !== incoming.user_id &&
      (u.identities || []).some((i) => i.provider === DATABASE_STRATEGY),
  );

  if (candidates.length === 0) {
    /* Nothing to join — a genuinely new person. They go to /start and found a
       company on purpose, which is what that screen is for. */
    return { link: false, why: "no existing password account" };
  }
  /* TWO IS NOT A TIE-BREAK. Picking one would be guessing which of a person's
     accounts is theirs, and getting it wrong hands somebody else's workspace
     to whoever holds the inbox. An admin should merge them by hand. */
  if (candidates.length > 1) {
    return { link: false, why: "more than one account holds this address" };
  }

  return { link: true, primaryUserId: candidates[0].user_id };
}

exports.linkDecision = linkDecision;

exports.onExecutePostLogin = async (event, api) => {
  /* `require`, not `import`, because the Auth0 Actions runtime is CommonJS
     and rejects ESM — the dependency is resolved by Auth0 from the Action's
     own Dependencies list, not by this repo's node_modules. The lint rule is
     right about app code and does not apply to a file that never runs here. */
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ManagementClient } = require("auth0");

  let decision;
  try {
    const management = new ManagementClient({
      domain: event.secrets.AUTH0_DOMAIN,
      clientId: event.secrets.AUTH0_CLIENT_ID,
      clientSecret: event.secrets.AUTH0_CLIENT_SECRET,
    });

    /* Cheap pre-check before spending a Management call on every single
       login — the vast majority are database logins that can never link. */
    if ((event.connection && event.connection.strategy) !== GOOGLE) return;

    const { data } = await management.usersByEmail.getByEmail({
      email: event.user.email,
    });
    decision = linkDecision(event, data);

    if (!decision.link) return;

    const identity = event.user.identities[0];
    await management.users.link(
      { id: decision.primaryUserId },
      { provider: identity.provider, user_id: identity.user_id },
    );
  } catch (err) {
    /* NEVER BLOCK A LOGIN BECAUSE LINKING FAILED. A Management outage, a
       revoked grant or a rate limit must not turn into "you cannot sign in".
       Falling through leaves them exactly where they were before this Action
       existed: signed in as the Google user, sent to /start. Logged so it is
       findable in the Auth0 log stream rather than silent. */
    console.log("account-link failed, continuing login:", err && err.message);
    return;
  }

  /* Linked. This login still belongs to the identity that started it, so it
     is stopped rather than allowed through as the wrong user — see the note
     at the top about setPrimaryUser and onContinuePostLogin. The next press
     of the Google button lands in the real account.

     `deny` is the only way to say this, and it renders as an error, which is
     a shame for what is actually a success. The copy carries the whole
     meaning because it is the only thing the person will see. */
  api.access.deny(
    "Your Google sign-in is now connected to your HeyTiff account. Press Continue with Google once more to finish.",
  );
};
