/* The sentence under the logo, and the two ways it goes wrong.

   It went wrong the first way in production: Auth0's default description is
   `Log in to ${companyName} to continue to ${clientName}.` and the live page
   read "Log in to dev-zuqpsxjwzz45pr0u to continue to Heytiff."

   It went wrong the second way in the first draft of the fix, which said
   "Sign in to HeyTiff." — correct, and still the screen naming the product
   twice, once in the lockup and once in the line directly beneath it.

   Both are asserted, because the second is the one that reads fine in a diff
   and only fails when somebody looks at the screen. */

import {
  LOGIN_PROMPT_TEXT,
  SIGNUP_PROMPT_TEXT,
  PROMPT_TEXT,
  PROMPT_LANGUAGE,
} from "../prompts";

const login = LOGIN_PROMPT_TEXT.login;
const signup = SIGNUP_PROMPT_TEXT.signup;

/* Every string this repo sends Auth0, flattened as `prompt.key` so a new
   prompt is covered by the rules below the moment it is added rather than
   the day somebody remembers to widen a test. */
const everyString = Object.entries(PROMPT_TEXT).flatMap(([prompt, screens]) =>
  Object.values(screens).flatMap((texts) =>
    Object.entries(texts).map(([key, value]) => [`${prompt}.${key}`, value] as const),
  ),
);

describe("no Auth0 variable survives", () => {
  it.each(everyString)("%s substitutes nothing", (_key, value) => {
    // ${companyName} is the tenant's Friendly Name, unset here, so it renders
    // as the raw tenant id. ${clientName} is the application's name, which is
    // spelled "Heytiff". Neither belongs in copy we own.
    expect(value).not.toMatch(/\$\{/);
    expect(value).not.toMatch(/companyName|clientName/);
    expect(value).not.toMatch(/dev-[a-z0-9]+/);
  });

  it("fixes the alt text too, not just the visible line", () => {
    // logoAltText defaults to ${companyName} — the same bug, announced by a
    // screen reader instead of drawn, and the only HeyTiff anyone gets if the
    // image fails.
    expect(login.logoAltText).toBe("HeyTiff");
  });
});

describe("the tab title names the product, and that is the same rule", () => {
  it("says HeyTiff, because nothing beside it does", () => {
    // The subtitle must NOT name the product and the tab title MUST. Both
    // follow from the same test — say it where nothing else is saying it.
    // The tab sits in a strip of a dozen others with no lockup beside it.
    expect(login.pageTitle).toMatch(/HeyTiff/);
  });

  it("is not left as Auth0's ${clientName}", () => {
    // The default rendered "Log in | Heytiff" — the application's name,
    // misspelled, in a field this repo does not own.
    expect(login.pageTitle).not.toMatch(/Heytiff/);
    expect(login.pageTitle).not.toMatch(/Log in/i);
  });
});

describe("the line does not repeat the lockup", () => {
  it("never names the product — the logo above it already did", () => {
    // "Sign in to HeyTiff to continue to HeyTiff" is the obvious failure.
    // "Sign in to HeyTiff." is the subtle one, and is what this catches.
    expect(login.description).not.toMatch(/HeyTiff/);
  });

  it("says what is happening, in the app's own verb", () => {
    // The app says "Sign in" everywhere; Auth0's default says "Log in". One
    // flow should not disagree with itself about what the user is doing.
    expect(login.description).toMatch(/^Sign in/);
    expect(login.description).not.toMatch(/Log in/i);
  });

  it("stays one short sentence", () => {
    expect(login.description.length).toBeLessThanOrEqual(40);
    expect(login.description.split(".").filter(Boolean)).toHaveLength(1);
  });
});

describe("what gets sent", () => {
  it("writes only the keys that were wrong", () => {
    // The PUT replaces all custom text for the prompt, and every key left out
    // falls back to Auth0's default. "Welcome", "Continue" and "Forgot
    // password?" are already right; restating them would be ten strings to
    // keep in step with a vendor's copy for the sake of three.
    expect(Object.keys(login).sort()).toEqual(["description", "logoAltText", "pageTitle"]);
  });

  it("targets prompts Auth0 publishes", () => {
    // A prompt name Auth0 does not know is a 404 the script reports as a
    // missing scope, which would send the next person to the wrong place.
    expect(Object.keys(PROMPT_TEXT)).toEqual(["login", "signup"]);
    expect(PROMPT_LANGUAGE).toBe("en");
  });

  it("nests each prompt under its own screen name", () => {
    // The URL segment and the body's top-level key are both the prompt name
    // for these two, and the shape is easy to flatten by mistake — a body of
    // { description } instead of { signup: { description } } is accepted,
    // reported as a success, and changes nothing.
    expect(Object.keys(LOGIN_PROMPT_TEXT)).toEqual(["login"]);
    expect(Object.keys(SIGNUP_PROMPT_TEXT)).toEqual(["signup"]);
  });
});

/* ── the sign-up screen (#610) ─────────────────────────────────────────────

   The same three faults as the login screen, plus a fourth that only exists
   because the login screen was fixed: the link between them stopped agreeing
   about the verb. */

describe("the sign-up screen carries the same faults, so it gets the same rules", () => {
  it("writes only the keys that were wrong", () => {
    // Auth0's own key names, from its published table — a key it does not
    // know is accepted, reported as updated, and silently does nothing.
    expect(Object.keys(signup).sort()).toEqual([
      "description",
      "loginActionLinkText",
      "logoAltText",
      "pageTitle",
    ]);
  });

  it("fixes the alt text too", () => {
    expect(signup.logoAltText).toBe("HeyTiff");
  });

  it("names the product in the tab and nowhere else", () => {
    expect(signup.pageTitle).toMatch(/HeyTiff/);
    expect(signup.pageTitle).not.toMatch(/Heytiff/);
    expect(signup.description).not.toMatch(/HeyTiff/);
  });

  it("stays one short sentence, like its sibling", () => {
    expect(signup.description.length).toBeLessThanOrEqual(40);
    expect(signup.description.split(".").filter(Boolean)).toHaveLength(1);
  });
});

describe("the two screens are one flow and use one verb", () => {
  it("never says Log in, on either of them", () => {
    // Auth0 says "Log in"; the app says "Sign in" — the front door's link,
    // the profile's "sign-in address", the invite copy. #591 rewrote the
    // login screen and left the sign-up screen's link to it still saying
    // Auth0's word, which is the one place the two face each other.
    for (const [key, value] of everyString) {
      expect([key, value]).toEqual([key, expect.not.stringMatching(/log ?in/i)]);
    }
    expect(signup.loginActionLinkText).toBe("Sign in");
  });

  it("titles the tabs as a pair", () => {
    // "Sign in to HeyTiff" and "Sign up to HeyTiff" — two tabs a person may
    // hold open at once, told apart by the one word that differs.
    expect(login.pageTitle).toBe("Sign in to HeyTiff");
    expect(signup.pageTitle).toBe("Sign up to HeyTiff");
  });
});
