/* The sentence under the logo, and the two ways it goes wrong.

   It went wrong the first way in production: Auth0's default description is
   `Log in to ${companyName} to continue to ${clientName}.` and the live page
   read "Log in to dev-zuqpsxjwzz45pr0u to continue to Heytiff."

   It went wrong the second way in the first draft of the fix, which said
   "Sign in to HeyTiff." — correct, and still the screen naming the product
   twice, once in the lockup and once in the line directly beneath it.

   Both are asserted, because the second is the one that reads fine in a diff
   and only fails when somebody looks at the screen. */

import { LOGIN_PROMPT_TEXT, PROMPT_TEXT, PROMPT_LANGUAGE } from "../prompts";

const login = LOGIN_PROMPT_TEXT.login;

describe("no Auth0 variable survives", () => {
  it.each(Object.entries(login))("%s substitutes nothing", (_key, value) => {
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
    // keep in step with a vendor's copy for the sake of two.
    expect(Object.keys(login).sort()).toEqual(["description", "logoAltText"]);
  });

  it("targets prompts Auth0 publishes", () => {
    // A prompt name Auth0 does not know is a 404 the script reports as a
    // missing scope, which would send the next person to the wrong place.
    expect(Object.keys(PROMPT_TEXT)).toEqual(["login"]);
    expect(PROMPT_LANGUAGE).toBe("en");
  });
});
