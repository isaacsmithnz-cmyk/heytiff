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
