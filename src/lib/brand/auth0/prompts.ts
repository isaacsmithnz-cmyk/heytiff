/* The widget's words — `PUT /api/v2/prompts/login/custom-text/en`.

   WHY THIS EXISTS. The live sign-in page said:

     "Log in to dev-zuqpsxjwzz45pr0u to continue to Heytiff."

   That is Auth0's own default description, which is
   `Log in to ${companyName} to continue to ${clientName}.` — and both halves
   were wrong for us. `companyName` is the tenant's Friendly Name, which was
   never set, so it fell back to the raw tenant id; `clientName` is the
   application's name, which is spelled "Heytiff".

   THERE WERE TWO WAYS TO FIX IT AND THIS IS THE OTHER ONE. Setting the
   tenant's Friendly Name would have made the sentence read correctly and left
   Auth0 owning it — a value typed into a dashboard, invisible from here, and
   still phrased in Auth0's voice. Overriding the text moves the sentence into
   this repo, where it is reviewed and versioned like every other string on
   the sign-in screen. That is the whole argument for the rest of this
   directory, so it applies here too.

   IT ALSO FIXES A SECOND, INVISIBLE COPY OF THE SAME BUG. `logoAltText`
   defaults to `${companyName}`, so the logo's alternative text — the thing a
   screen reader announces, and the only HeyTiff a person gets if the image
   fails — was also reading the tenant id.

   THE PUT REPLACES EVERYTHING. Auth0's own note: this endpoint "replaces all
   existing configuration data". Keys left out fall back to Auth0's defaults,
   which is exactly what is wanted for the ones below that are already right —
   "Welcome", "Continue", "Forgot password?" are Auth0's and need no help.
   Only the keys that were WRONG are overridden. A file that restated all ten
   would be ten strings to keep in step with a vendor's copy for the sake of
   three. */

/** The app says "Sign in", everywhere — the front door's link, the profile's
    "sign-in address", the invite copy. Auth0 says "Log in". Since the
    sentence is being rewritten anyway, it is rewritten in the app's verb;
    the two screens are one flow and should not disagree about what the user
    is doing. */
export const LOGIN_PROMPT_TEXT = {
  login: {
    /* Was: "Log in to ${companyName} to continue to ${clientName}." — which
       with both fields corrected would have become "Sign in to HeyTiff to
       continue to HeyTiff", and the doubling is the real reason that sentence
       reads badly; the tenant id was only the louder half.

       THE LOCKUP SAYS WHO, SO THE SENTENCE SAYS WHAT. HeyTiff is already
       written, in the brand's own letters, 40px above this line. Naming it
       again — even once — is the screen saying the same thing twice, and the
       first version of this file did exactly that before it was read aloud.
       What the line is left carrying is the bit the logo cannot: that this
       is a step on the way somewhere, which is true of nearly everyone who
       lands here from a mail link or a redirect. */
    description: "Sign in to continue.",
    /* Was: "${companyName}" — the tenant id, announced aloud. */
    logoAltText: "HeyTiff",
    /* The browser tab, which was "Log in | Heytiff" — `${clientName}`, the
       application's name, misspelled in a field this repo does not own.

       AND HERE THE PRODUCT *IS* NAMED, WHICH IS NOT A CONTRADICTION OF THE
       LINE ABOVE. The subtitle sits directly under a lockup that has already
       said HeyTiff in the brand's own letters, so saying it again is the
       screen repeating itself. A tab title has no lockup beside it — it sits
       in a strip of a dozen other tabs, and a tab reading only "Sign in" is
       one nobody can find. Same rule, opposite answer: say it where nothing
       else is saying it. */
    pageTitle: "Sign in to HeyTiff",
  },
} as const;

/* The same three faults, on the screen nobody used to land on — until #604
   sent everyone following an invitation straight to it.

   HOW THE KEY NAMES WERE ESTABLISHED, since the comment above refused to
   write them from memory and the refusal still stands. Auth0's `PUT
   /prompts/{prompt}/custom-text/{lang}` takes `additionalProperties: true`,
   so a misspelled key is accepted, reported as a success, and does nothing.
   The names below were read from Auth0's own published table — the current
   source, `auth0/docs-v2`, cross-checked against the legacy `auth0/docs`
   per-prompt markdown and a real JSON fixture in `auth0/auth0-cli`.

   READ THE RENDERED PAGE, NOT THE DOCS PAGE. Auth0's rendered table drops
   `pageTitle` from every screen: its default is `Sign up | ${clientName}`,
   whose unescaped `|` splits a two-column row into three cells and the third
   is discarded. The key is real; the page just cannot show it.

   AND THE PUSH IS FALSIFIABLE, which is the part that matters. `/authorize?
   screen_hint=signup` serves this screen to anyone, unauthenticated. Push,
   fetch it, and read the sentence back: a key that did nothing leaves the
   old text standing, in public, where a diff of the request body cannot
   see it. */

/** Auth0's identifier-first setting decides which screen renders: `signup`
    is the classic one-page form, and this tenant serves it. `signup-id` and
    `signup-password` carry the same defaults and would want the same three
    keys the day that setting changes — deliberately not written here, because
    text pushed to a screen that does not render is text nobody can check. */
export const SIGNUP_PROMPT_TEXT = {
  signup: {
    /* Was: "Sign Up to ${companyName} to continue to ${clientName}." — the
       tenant id, and the misspelled application name, in one sentence.

       IT SAYS WHAT THIS SCREEN DOES, NOT WHERE IT LEADS. Its sibling reads
       "Sign in to continue." and the same rule produces a different answer
       here: signing in is a door, and the sentence can be about what is on
       the other side of it. Signing up is not — there is a password to
       choose, and a person arriving from an invitation has not yet grasped
       that HeyTiff is a thing they now have an account with. */
    description: "Create your account to continue.",
    /* Was: "${companyName}" — the tenant id, read aloud, exactly as on the
       login screen before #591. */
    logoAltText: "HeyTiff",
    /* Was: "Sign up | Heytiff" — `${clientName}`, misspelled. Named here for
       the reason the description is not: a tab has no lockup beside it. */
    pageTitle: "Sign up to HeyTiff",
    /* Was: "Log in". The screen it links TO now says "Sign in" in three
       places, so Auth0's verb survived only on the link pointing at it —
       the one place the two screens face each other and disagree. Its
       sibling, "Don't have an account? Sign up", is already the app's word
       and is left alone. */
    loginActionLinkText: "Sign in",
  },
} as const;

/** Auth0 keys custom text by prompt and language. `reset-password` is still
    unwritten: it is one prompt spanning five screens that a single PUT
    replaces together, and unlike this one it has never been looked at — so
    there is nothing yet to say is wrong with it.

    `satisfies`, not an annotation: `Record<string, …>` widens `keyof` to
    `string` and throws away the very key names the script sends. */
export const PROMPT_TEXT = {
  login: LOGIN_PROMPT_TEXT,
  signup: SIGNUP_PROMPT_TEXT,
} satisfies Record<string, Record<string, Record<string, string>>>;

/** Auth0 stores custom text per locale and falls back to its own defaults for
    any language not written. English only — the app has no other. */
export const PROMPT_LANGUAGE = "en";
