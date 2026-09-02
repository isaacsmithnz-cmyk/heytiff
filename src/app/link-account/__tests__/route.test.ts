/**
 * @jest-environment node
 */

/* The bounce, and the one way it could be dangerous.

   This route takes a value off the query string and puts it in a URL it then
   redirects to. That is the shape of every open redirect ever written, so the
   tests that matter are the ones proving the host can never come from the
   request — only the opaque state can, and only as a query VALUE. */

import { GET } from "../route";
import { NextRequest } from "next/server";

const DOMAIN = "dev-tenant.us.auth0.com";

beforeEach(() => {
  process.env.AUTH0_DOMAIN = DOMAIN;
});

const call = (qs: string) =>
  GET(new NextRequest(`https://go.hey-tiff.com/link-account${qs}`));

describe("the happy bounce", () => {
  it("hands the state straight to /continue on the login domain", async () => {
    const res = await call("?state=abc123");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `https://${DOMAIN}/continue?state=abc123`,
    );
  });

  it("uses 303, so going back does not re-issue it", async () => {
    expect((await call("?state=abc123")).status).toBe(303);
  });
});

describe("the host can never come from the request", () => {
  /* Each of these is an attempt to make the redirect land somewhere else.
     None may produce a Location outside AUTH0_DOMAIN. */
  it.each([
    ["an absolute url", "?state=https://evil.test"],
    ["a protocol-relative url", "?state=//evil.test"],
    ["an @-host trick", "?state=abc@evil.test"],
    ["a path traversal", "?state=../../evil"],
    ["a crlf injection", "?state=abc%0d%0aLocation:%20https://evil.test"],
    ["a second state", "?state=abc&state=https://evil.test"],
  ])("refuses %s", async (_name, qs) => {
    const res = await call(qs);
    const location = res.headers.get("location");
    if (location) {
      // If it redirects at all, it is to our own Auth0 domain and nowhere else.
      expect(new URL(location).host).toBe(DOMAIN);
      expect(new URL(location).pathname).toBe("/continue");
    } else {
      expect(res.status).toBe(400);
    }
  });
});

describe("what it refuses outright", () => {
  it("400s with no state — that login is not resumable", async () => {
    // Auth0 documents that losing the state ends the transaction in
    // `invalid_request`, so saying so beats a redirect that fails a hop later.
    const res = await call("");
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/signing in/i);
  });

  it("400s on an over-long state rather than amplifying it", async () => {
    expect((await call(`?state=${"a".repeat(513)}`)).status).toBe(400);
  });

  it("400s when AUTH0_DOMAIN is unset, instead of building a broken url", async () => {
    delete process.env.AUTH0_DOMAIN;
    expect((await call("?state=abc123")).status).toBe(400);
  });

  it("says something a person could act on", async () => {
    // This URL will be opened on its own by somebody, eventually. The reply
    // is the only thing they get.
    expect(await (await call("")).text()).toContain("can't be opened on its own");
  });
});
