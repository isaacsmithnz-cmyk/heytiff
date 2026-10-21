/* THE TICKET THAT LETS THE HEADLESS BROWSER PRINT ONE QUOTE — the letter's,
   and the certificate's (lib/certs/pdf-ticket.ts), with its own key so a
   letter or certificate ticket can never print a quote. Good
   for two minutes. Server-only (node:crypto). */

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 2 * 60_000;

export type QuoteTicket = { orgId: string; jobUuid: string; by: string };

function key(): Buffer {
  const secret = process.env.AUTH0_SECRET;
  if (!secret) throw new Error("AUTH0_SECRET is not set");
  return createHmac("sha256", secret).update("heytiff/quote-pdf/v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signQuoteTicket(t: QuoteTicket, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ orgId: t.orgId, jobUuid: t.jobUuid, by: t.by, exp: now + TTL_MS }));
  const sig = b64(createHmac("sha256", key()).update(body).digest());
  return `${body}.${sig}`;
}

/** The ticket's contents, or null when it is forged, altered or stale. */
export function readQuoteTicket(token: string | undefined, now: number = Date.now()): QuoteTicket | null {
  if (!token || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: { orgId?: unknown; jobUuid?: unknown; by?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
  if (typeof parsed.orgId !== "string" || typeof parsed.jobUuid !== "string" || typeof parsed.by !== "string") return null;
  return { orgId: parsed.orgId, jobUuid: parsed.jobUuid, by: parsed.by };
}
