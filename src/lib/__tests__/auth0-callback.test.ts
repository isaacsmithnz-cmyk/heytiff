/**
 * @jest-environment node
 */

/* A callback that arrives without its transaction cookie is a sign-in that
   has to be started again, not a server error. The SDK's default shows "The
   state parameter is invalid." on a bare 500 page; the hook sends the person
   to the front door instead. Every other failure keeps the default, because
   a redirect would only hide a fault that will recur. */

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => ({}) } }));

// eslint-disable-next-line no-var
var capturedOptions: Record<string, unknown>;
jest.mock("@auth0/nextjs-auth0/server", () => ({
  Auth0Client: class {
    constructor(opts: Record<string, unknown>) {
      capturedOptions = opts;
    }
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onCallback } from "@/lib/auth0";

/* The SDK's error classes cannot be imported here (ESM-only, untransformed in
   jest), so these mirror their shape — and the first test below reads the
   SDK's own source to prove the codes are the ones it really throws. */
const sdkError = (code: string, message: string) =>
  Object.assign(new Error(message), { code }) as Error & { code: string };
const invalidState = () => sdkError("invalid_state", "The state parameter is invalid.");
const missingState = () => sdkError("missing_state", "The state parameter is missing.");

const env = process.env;
beforeEach(() => {
  process.env = { ...env, APP_BASE_URL: "https://go.hey-tiff.com" };
});
afterAll(() => {
  process.env = env;
});

test("the codes matched are the SDK's own", () => {
  const src = readFileSync(
    join(process.cwd(), "node_modules/@auth0/nextjs-auth0/dist/errors/oauth-errors.js"),
    "utf8"
  );
  expect(src).toContain('this.code = "invalid_state"');
  expect(src).toContain('this.code = "missing_state"');
});

test("the hook is wired into the client", () => {
  expect(capturedOptions.onCallback).toBe(onCallback);
});

test("no transaction cookie → the front door, on the canonical host, not a 500", async () => {
  // the SDK passes an EMPTY context on this path — no appBaseUrl to lean on
  const res = await onCallback(invalidState(), {});
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe("https://go.hey-tiff.com/");
});

test("no state at all → the same door", async () => {
  const res = await onCallback(missingState(), {});
  expect(res.headers.get("location")).toBe("https://go.hey-tiff.com/");
});

test("any other failure keeps the SDK's default: the message, status 500", async () => {
  const res = await onCallback(sdkError("authorization_code_grant_request_error", "exchange failed"), {});
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("exchange failed");
});

test("success goes where the transaction said", async () => {
  const res = await onCallback(null, { returnTo: "/dashboard", appBaseUrl: "https://go.hey-tiff.com" });
  expect(res.headers.get("location")).toBe("https://go.hey-tiff.com/dashboard");
});
