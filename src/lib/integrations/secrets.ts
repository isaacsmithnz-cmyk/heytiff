/* Sealing OAuth tokens at rest.

   WHY, given the table is already deny-all to the public keys: a refresh token
   is a 60-day key to somebody's accounting system, and the service-role key is
   held by more things than this table is (every server module imports
   supabaseAdmin). Sealing splits the secret in two — a leaked database, or a
   leaked service key, is not by itself a leaked Xero grant. You need
   INTEGRATIONS_TOKEN_KEY too, and that lives only in the deployment's
   environment.

   AES-256-GCM: authenticated, so `open` distinguishes "wrong key" from
   "tampered ciphertext" from "fine" — all three come back as null, and a null
   is treated as "this connection is broken, reconnect", never as an empty
   token that then gets sent to Xero.

   Format: `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix is
   what makes a future key rotation or cipher change a readable migration
   rather than a table of undecryptable blobs. */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** 96 bits — the GCM standard nonce size, and the fastest path in the cipher. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

const b64 = (b: Buffer) => b.toString("base64url");

/** Parse the configured key: 32 bytes as base64, base64url or hex. Returns
    null for anything else — including a key of the wrong LENGTH, because a
    short key that "works" is the failure you don't notice.

    Hex is tried FIRST, so a 64-character all-hex string is always read as 32
    hex bytes. That is the only ambiguity between the encodings, and resolving
    it in a fixed direction is what matters: the same env value must always
    produce the same key, or tokens sealed today don't open tomorrow. */
export function parseTokenKey(raw: string | undefined | null): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(s)) candidates.push(Buffer.from(s, "hex"));
  candidates.push(Buffer.from(s, "base64url"));
  candidates.push(Buffer.from(s, "base64"));

  for (const c of candidates) if (c.length === KEY_BYTES) return c;
  return null;
}

/** The deployment's key, or null when the app is running without one. Callers
    must treat null as "connecting is unavailable" — never as "store it
    plaintext". */
export function tokenKey(): Buffer | null {
  return parseTokenKey(process.env.INTEGRATIONS_TOKEN_KEY);
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

/** Null on ANY failure — wrong version, malformed, wrong key, tampered. The
    caller's job is to turn that into "reconnect", not to inspect why. */
export function open(sealed: string | null | undefined, key: Buffer): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4) return null;

  const [version, ivB64, tagB64, ctB64] = parts;
  // Constant-time on the version too — costs nothing, and keeps the whole
  // parse free of early-exit comparisons against attacker-supplied bytes.
  const v = Buffer.from(version);
  const want = Buffer.from(VERSION);
  if (v.length !== want.length || !timingSafeEqual(v, want)) return null;

  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(), // throws when the tag doesn't verify
    ]);
    return out.toString("utf8");
  } catch {
    return null;
  }
}

/** A key a deployment can paste into its environment. Not called by the app —
    it exists so the setup instructions can point at one line of real code
    rather than a shell incantation that varies by platform. */
export function generateTokenKey(): string {
  return randomBytes(KEY_BYTES).toString("base64url");
}
