/* THE TICKET THAT LETS THE HEADLESS BROWSER PRINT ONE LETTER — the
   certificate's arrangement (lib/certs/pdf-ticket.ts), with its own key so a
   certificate ticket can never print a letter or the other way round. Good
   for two minutes. Server-only (node:crypto). */

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 2 * 60_000;

export type LetterTicket = { orgId: string; letterId: string };

function key(): Buffer {
  const secret = process.env.AUTH0_SECRET;
  if (!secret) throw new Error("AUTH0_SECRET is not set");
  return createHmac("sha256", secret).update("heytiff/letter-pdf/v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signLetterTicket(t: LetterTicket, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ orgId: t.orgId, letterId: t.letterId, exp: now + TTL_MS }));
  const sig = b64(createHmac("sha256", key()).update(body).digest());
  return `${body}.${sig}`;
}

/** The ticket's contents, or null when it is forged, altered or stale. */
export function readLetterTicket(token: string | undefined, now: number = Date.now()): LetterTicket | null {
  if (!token || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: { orgId?: unknown; letterId?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
  if (typeof parsed.orgId !== "string" || typeof parsed.letterId !== "string") return null;
  return { orgId: parsed.orgId, letterId: parsed.letterId };
}
