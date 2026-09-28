/**
 * @jest-environment node
 */

/* Sign-in only works from the canonical host: the transaction cookie is set
   on whichever host STARTED the sign-in, and the callback always lands on
   APP_BASE_URL. So every other host that answers — www, the vercel.app alias,
   a per-deployment URL — must be sent to the canonical one before the SDK
   touches the request. A person who started on www.hey-tiff.com and got "The
   state parameter is invalid." is what this guards. */

import { NextRequest, NextResponse } from "next/server";

const middlewareSpy = jest.fn(async () => NextResponse.next());
jest.mock("@/lib/auth0", () => ({
  auth0: {
    middleware: (...a: unknown[]) => middlewareSpy(...(a as [])),
    getSession: async () => null,
  },
}));

import { proxy } from "@/proxy";

const env = process.env;
beforeEach(() => {
  process.env = { ...env, VERCEL_ENV: "production", APP_BASE_URL: "https://go.hey-tiff.com" };
  middlewareSpy.mockClear();
});
afterAll(() => {
  process.env = env;
});

const req = (url: string, host?: string) =>
  new NextRequest(url, { headers: host ? { host } : undefined });

test("another production host is moved to the canonical one, path and query intact", async () => {
  const res = await proxy(req("https://www.hey-tiff.com/auth/login?screen_hint=signup", "www.hey-tiff.com"));
  expect(res.status).toBe(308);
  expect(res.headers.get("location")).toBe("https://go.hey-tiff.com/auth/login?screen_hint=signup");
  expect(middlewareSpy).not.toHaveBeenCalled();
});

test("the vercel.app alias is moved too", async () => {
  const res = await proxy(req("https://heytiff.vercel.app/dashboard", "heytiff.vercel.app"));
  expect(res.status).toBe(308);
  expect(res.headers.get("location")).toBe("https://go.hey-tiff.com/dashboard");
});

test("the canonical host is served, not redirected", async () => {
  const res = await proxy(req("https://go.hey-tiff.com/auth/login", "go.hey-tiff.com"));
  expect(res.status).toBe(200);
  expect(middlewareSpy).toHaveBeenCalledTimes(1);
});

test("a preview deployment is never sent to production", async () => {
  process.env.VERCEL_ENV = "preview";
  const res = await proxy(req("https://heytiff-git-x.vercel.app/", "heytiff-git-x.vercel.app"));
  expect(res.status).toBe(200);
});

test("without VERCEL_ENV (local) nothing moves", async () => {
  delete process.env.VERCEL_ENV;
  const res = await proxy(req("http://localhost:3000/auth/login", "localhost:3000"));
  expect(res.status).toBe(200);
});

/* Vercel's scheduler calls a cron on the deployment's own address and does
   not follow a redirect, so a 308 here is a cron that never runs. */
test("a scheduled call on the deployment's own address reaches its route: no move, no session work", async () => {
  const host = "heytiff-bddd85eyg-isaacsmithnz-3848s-projects.vercel.app";
  for (const path of ["/api/cron/sm8-sync", "/api/cron/reminders", "/api/cron/xero-drift"]) {
    const res = await proxy(req(`https://${host}${path}`, host));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  }
  expect(middlewareSpy).not.toHaveBeenCalled();
});

test("only the cron routes are let through: another API route on that address still moves", async () => {
  const res = await proxy(req("https://heytiff.vercel.app/api/cronjobs", "heytiff.vercel.app"));
  expect(res.status).toBe(308);
});

/* A new invitee sets a password on Auth0's screen, whose Sign in button opens
   a bare /auth/login. The accept route left their address in a cookie; the
   proxy fills it in on that one sign-in and nowhere else. */
describe("the invitee's address after the password screen", () => {
  const withHint = (url: string) =>
    new NextRequest(url, {
      headers: { host: "go.hey-tiff.com", cookie: "ht_invitee=ben%40diamondairsolutions.com" },
    });

  test("a bare sign-in is filled in with the invited address", async () => {
    const res = await proxy(withHint("https://go.hey-tiff.com/auth/login"));
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.pathname).toBe("/auth/login");
    expect(to.searchParams.get("login_hint")).toBe("ben@diamondairsolutions.com");
    expect(middlewareSpy).not.toHaveBeenCalled();
  });

  test("whatever else the sign-in carried survives", async () => {
    const res = await proxy(withHint("https://go.hey-tiff.com/auth/login?returnTo=%2Fdashboard"));
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.searchParams.get("returnTo")).toBe("/dashboard");
    expect(to.searchParams.get("login_hint")).toBe("ben@diamondairsolutions.com");
  });

  test("a sign-in that already names somebody is left alone", async () => {
    const res = await proxy(withHint("https://go.hey-tiff.com/auth/login?login_hint=someone%40else.com"));
    expect(res.headers.get("location")).toBeNull();
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
  });

  test("the front door's Create account is left alone", async () => {
    const res = await proxy(withHint("https://go.hey-tiff.com/auth/login?screen_hint=signup"));
    expect(res.headers.get("location")).toBeNull();
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
  });

  test("without the cookie nothing changes", async () => {
    const res = await proxy(req("https://go.hey-tiff.com/auth/login", "go.hey-tiff.com"));
    expect(res.headers.get("location")).toBeNull();
    expect(middlewareSpy).toHaveBeenCalledTimes(1);
  });

  test("the completed sign-in clears it", async () => {
    const res = await proxy(withHint("https://go.hey-tiff.com/auth/callback?code=x&state=y"));
    const gone = res.cookies.get("ht_invitee");
    expect(gone?.value).toBe("");
    expect(gone?.maxAge).toBe(0);
  });
});
