/**
 * @jest-environment node
 */

/* The phone's token is believed only when Auth0 signed it with the tenant's
   key, for the phone API, recently, about somebody. Every other shape is
   refused: the tokens below are minted with a real RSA key, then broken one
   way at a time. */

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { checkMobileToken, MOBILE_AUDIENCE, tenantKeys } from "../token";

const DOMAIN = "tenant.example.auth0.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = 1_800_000_000;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key: KeyObject = privateKey
): string {
  const h = b64({ alg: "RS256", typ: "JWT", kid: "k1", ...header });
  const p = b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub: "auth0|lyle", exp: NOW + 3600, iat: NOW, ...claims });
  const s = sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url");
  return `${h}.${p}.${s}`;
}
const keyFor = async (kid: string) => (kid === "k1" ? publicKey : null);
const check = (token: string, now = NOW) => checkMobileToken(token, { domain: DOMAIN, keyFor, now });

test("a token Auth0 signed for the phone API is believed, and says who", async () => {
  expect(await check(mint())).toEqual({ ok: true, sub: "auth0|lyle" });
});

test("an audience list that includes the phone API is believed too", async () => {
  expect(await check(mint({ aud: [MOBILE_AUDIENCE, `https://${DOMAIN}/userinfo`] }))).toEqual({ ok: true, sub: "auth0|lyle" });
});

describe("refused", () => {
  const cases: [string, string, string][] = [
    ["signed by anyone else's key", mint({}, {}, other.privateKey), "signature"],
    ["changed after signing", (() => {
      const [h, , s] = mint().split(".");
      return `${h}.${b64({ iss: `https://${DOMAIN}/`, aud: MOBILE_AUDIENCE, sub: "auth0|someone-else", exp: NOW + 3600 })}.${s}`;
    })(), "signature"],
    ["claiming no algorithm", mint({}, { alg: "none" }), "algorithm"],
    ["claiming HS256 (signed with the public key as a secret)", mint({}, { alg: "HS256" }), "algorithm"],
    ["naming no key", mint({}, { kid: undefined }), "no key id"],
    ["naming a key the tenant doesn't publish", mint({}, { kid: "k9" }), "unknown key"],
    ["issued by another tenant", mint({ iss: "https://evil.example.auth0.com/" }), "issuer"],
    ["minted for another API (the website's own audience, say)", mint({ aud: "https://example.com/api" }), "audience"],
    ["minted with no audience", mint({ aud: undefined }), "audience"],
    ["expired more than a minute ago", mint({ exp: NOW - 61 }), "expired"],
    ["with no expiry", mint({ exp: undefined }), "expired"],
    ["not valid for another hour", mint({ nbf: NOW + 3600 }), "not yet valid"],
    ["about nobody", mint({ sub: "" }), "no subject"],
    ["not a token at all", "hello", "malformed"],
    ["three parts of nothing", "..", "malformed"],
    ["a header that isn't JSON", `${Buffer.from("nope").toString("base64url")}.e30.c2ln`, "malformed"],
  ];
  test.each(cases)("a token %s", async (_label, token, reason) => {
    expect(await check(token)).toEqual({ ok: false, reason });
  });
});

test("a minute either way of clock difference is allowed", async () => {
  expect((await check(mint({ exp: NOW - 59 }))).ok).toBe(true);
  expect((await check(mint({ nbf: NOW + 59 }))).ok).toBe(true);
});

describe("the tenant's keys", () => {
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  let fetched: string[];
  beforeEach(() => {
    fetched = [];
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      fetched.push(String(url));
      return new Response(JSON.stringify({ keys: [jwk, { kty: "EC", kid: "ec1" }] }), { status: 200 });
    }) as typeof fetch;
  });

  test("are read from the tenant's JWKS address, and kept", async () => {
    const keys = tenantKeys("kept.example.auth0.com");
    expect(await keys("k1")).not.toBeNull();
    expect(await keys("k1")).not.toBeNull();
    expect(fetched).toEqual(["https://kept.example.auth0.com/.well-known/jwks.json"]);
  });

  test("a key that isn't RSA is never used", async () => {
    expect(await tenantKeys("ec.example.auth0.com")("ec1")).toBeNull();
  });

  test("an unknown key doesn't send us back for the list more than once a minute", async () => {
    const keys = tenantKeys("forged.example.auth0.com");
    expect(await keys("k1")).not.toBeNull();
    expect(await keys("forged-1")).toBeNull();
    expect(await keys("forged-2")).toBeNull();
    expect(fetched).toHaveLength(1);
  });

  test("a tenant that can't be reached believes nothing", async () => {
    global.fetch = jest.fn(async () => new Response("down", { status: 503 })) as typeof fetch;
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(await tenantKeys("down.example.auth0.com")("k1")).toBeNull();
    spy.mockRestore();
  });

  test("and a token checked against them is believed", async () => {
    expect(await checkMobileToken(mint(), { domain: DOMAIN, keyFor: tenantKeys("full.example.auth0.com"), now: NOW })).toEqual({
      ok: true,
      sub: "auth0|lyle",
    });
  });
});
