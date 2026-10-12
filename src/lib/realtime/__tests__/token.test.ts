import { createHmac } from "node:crypto";
import { mintRealtimeToken, ORG_CLAIM, REALTIME_TOKEN_SECONDS } from "../token";

/* THE TICKET SUPABASE TRUSTS. Signed with the project's secret, the
   authenticated role, an hour long, and its workspace in a claim of its own
   — never `org_id`, which five tables' policies already read. */

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

it("is an HS256 token, signed with the secret, for an hour", () => {
  const now = Date.UTC(2026, 9, 11, 0, 0, 0);
  const { token, expiresAt } = mintRealtimeToken({ userId: "auth0|me", orgId: "org-1" }, "s3cret", now);
  const [h, p, sig] = token.split(".");
  expect(decode(h!)).toEqual({ alg: "HS256", typ: "JWT" });
  expect(sig).toBe(createHmac("sha256", "s3cret").update(`${h}.${p}`).digest("base64url"));
  const claims = decode(p!);
  expect(claims).toMatchObject({ sub: "auth0|me", role: "authenticated", aud: "authenticated", [ORG_CLAIM]: "org-1" });
  expect(claims.exp - claims.iat).toBe(REALTIME_TOKEN_SECONDS);
  expect(expiresAt).toBe(now + REALTIME_TOKEN_SECONDS * 1000);
});

it("never carries org_id, which would open the tenant policies' tables", () => {
  const { token } = mintRealtimeToken({ userId: "u", orgId: "org-1" }, "k", 0);
  expect(decode(token.split(".")[1]!)).not.toHaveProperty("org_id");
});

it("a different secret makes a different signature", () => {
  const a = mintRealtimeToken({ userId: "u", orgId: "o" }, "one", 0).token.split(".")[2];
  const b = mintRealtimeToken({ userId: "u", orgId: "o" }, "two", 0).token.split(".")[2];
  expect(a).not.toBe(b);
});
