/**
 * @jest-environment node
 */

/* The phone standing in for a sign-in (lib/phone-session): while a phone
   route acts for a person its token check verified, the app router's
   `auth0.getSession()` answers with that person, and only then; nothing but
   lib/mobile/auth may enter it, and only with a context it verified. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const browser = { user: { sub: "auth0|browser" }, orgId: "org-browser" };
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    async getSession(req?: unknown) {
      return req ? { user: { sub: "auth0|from-request" }, orgId: "org-request" } : browser;
    }
  },
}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => ({}) } }));

import { auth0 } from "../auth0";
import { enterPhoneSession, phoneSession } from "../phone-session";

test("outside a phone route there is no phone session, and getSession is the SDK's", async () => {
  expect(phoneSession()).toBeNull();
  expect(await auth0.getSession()).toEqual(browser);
});

test("inside one, getSession is the phone's person, and the SDK's again once it ends", async () => {
  const seen = await enterPhoneSession({ orgId: "org-1", userId: "auth0|isaac" }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return auth0.getSession();
  });
  expect(seen).toEqual({ user: { sub: "auth0|isaac" }, orgId: "org-1" });
  expect(await auth0.getSession()).toEqual(browser);
});

test("a call with a request in hand is always the SDK's", async () => {
  const seen = await enterPhoneSession({ orgId: "org-1", userId: "auth0|isaac" }, () => (auth0.getSession as (r: unknown) => Promise<unknown>)({}));
  expect(seen).toEqual({ user: { sub: "auth0|from-request" }, orgId: "org-request" });
});

test("two phone requests at once each see their own person", async () => {
  const one = enterPhoneSession({ orgId: "org-1", userId: "auth0|a" }, async () => (await new Promise((r) => setTimeout(r, 10)), auth0.getSession()));
  const two = enterPhoneSession({ orgId: "org-2", userId: "auth0|b" }, async () => auth0.getSession());
  expect(await one).toEqual({ user: { sub: "auth0|a" }, orgId: "org-1" });
  expect(await two).toEqual({ user: { sub: "auth0|b" }, orgId: "org-2" });
});

test("nothing but lib/mobile/auth enters it", () => {
  const SRC = join(__dirname, "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(SRC);
  const enterers = files.filter((f) => /\benterPhoneSession\b/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
  expect(enterers.sort()).toEqual([join("lib", "mobile", "auth.ts"), join("lib", "phone-session.ts")]);
});
