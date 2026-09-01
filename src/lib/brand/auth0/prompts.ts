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
   two. */

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
  },
} as const;

/** Auth0 keys custom text by prompt and language. Only the `login` prompt is
    written: it is the screen that was wrong. `signup` and `reset-password`
    carry the same `${companyName}` default and will want the same treatment,
    but each has its own screens and key names, and writing them from memory
    rather than from Auth0's published table is how a screen ends up with a
    key that silently does nothing. */
export const PROMPT_TEXT: Record<string, Record<string, unknown>> = {
  login: LOGIN_PROMPT_TEXT,
};

/** Auth0 stores custom text per locale and falls back to its own defaults for
    any language not written. English only — the app has no other. */
export const PROMPT_LANGUAGE = "en";
