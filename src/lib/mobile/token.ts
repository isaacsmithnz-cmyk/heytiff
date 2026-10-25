import { createPublicKey, verify, type JsonWebKey, type KeyObject } from "node:crypto";

/* THE PHONE'S SIGN-IN, CHECKED (native app, phase 1).

   The website signs people in with a cookie the Auth0 SDK keeps; a phone
   can't hold that, so the app signs in through Auth0 itself (PKCE, the
   "HeyTiff phone" native application) and sends the access token it gets on
   every call. This is where that token is believed or not.

   Auth0 signs the token with RS256 under a key it publishes at the tenant's
   JWKS address; Node's own crypto checks the signature, so there is no JWT
   package to keep. Everything else in the token is checked by hand, and
   every check FAILS CLOSED: a token that is any other algorithm (above all
   "none" and the HS256 trick of signing with the public key), names no key,
   names a key the tenant does not publish, was issued by anyone else, was
   minted for any other audience, has expired, or has no subject is refused.

   NO SESSION, NO DATABASE. Who the subject may act for is ./auth's question;
   this only answers "did Auth0 say this, for us, recently?". */

/** The phone API's identifier on the tenant: the `aud` Auth0 mints the
    phone's tokens for. An identifier, not an address anything is served at,
    and not a secret. */
export const MOBILE_AUDIENCE = process.env.MOBILE_API_AUDIENCE || "https://go.hey-tiff.com/api/mobile";

/** How far apart Auth0's clock and ours may be, in seconds. */
const LEEWAY_S = 60;

export type TokenCheck = { ok: true; sub: string } | { ok: false; reason: string };

/** A key the tenant publishes, by its `kid`; null for a kid it does not. */
export type KeyLookup = (kid: string) => Promise<KeyObject | null>;

const b64urlJson = (part: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Believe the token or don't. `now` is in seconds, and only tests hand it in. */
export async function checkMobileToken(
  token: string,
  opts: { domain: string; audience?: string; keyFor: KeyLookup; now?: number }
): Promise<TokenCheck> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];

  const header = b64urlJson(h);
  if (!header) return { ok: false, reason: "malformed" };
  if (header.alg !== "RS256") return { ok: false, reason: "algorithm" };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "no key id" };

  const key = await opts.keyFor(header.kid);
  if (!key) return { ok: false, reason: "unknown key" };
  const signed = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!signed) return { ok: false, reason: "signature" };

  const claims = b64urlJson(p);
  if (!claims) return { ok: false, reason: "malformed" };
  if (claims.iss !== `https://${opts.domain}/`) return { ok: false, reason: "issuer" };
  const audience = opts.audience ?? MOBILE_AUDIENCE;
  const aud = claims.aud;
  if (!(aud === audience || (Array.isArray(aud) && aud.includes(audience)))) return { ok: false, reason: "audience" };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < now) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_S > now) return { ok: false, reason: "not yet valid" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, reason: "no subject" };
  return { ok: true, sub: claims.sub };
}

/* THE TENANT'S KEYS, kept for ten minutes. A kid we haven't seen sends us
   back for the list (Auth0 rotating its key shows up exactly like that), but
   at most once a minute, so a stream of forged kids can't make us hammer the
   tenant. */
const KEEP_MS = 10 * 60_000;
const REFETCH_GAP_MS = 60_000;
let held: { domain: string; at: number; keys: Map<string, KeyObject> } | null = null;

async function fetchKeys(domain: string): Promise<Map<string, KeyObject>> {
  const res = await fetch(`https://${domain}/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string; use?: string })[] };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== "RSA" || (jwk.use && jwk.use !== "sig")) continue;
    keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
  }
  return keys;
}

/** The tenant's published key for `kid`, from the kept list or a fresh one. */
export function tenantKeys(domain: string): KeyLookup {
  return async (kid) => {
    const now = Date.now();
    const fresh = held && held.domain === domain && now - held.at < KEEP_MS;
    if (fresh && held!.keys.has(kid)) return held!.keys.get(kid)!;
    if (held && held.domain === domain && now - held.at < REFETCH_GAP_MS) return held.keys.get(kid) ?? null;
    try {
      held = { domain, at: now, keys: await fetchKeys(domain) };
    } catch (err) {
      console.error(`[mobile] couldn't read the tenant's keys: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    return held.keys.get(kid) ?? null;
  };
}
