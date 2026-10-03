/* THE TICKET THAT LETS THE HEADLESS BROWSER PRINT ONE CERTIFICATE.

   The design PDF's arrangement (lib/studio/pdf-request.ts), for the same
   reason: the browser that prints has no session. It is sent to
   /print/certificate with a ticket naming the workspace and the version,
   signed with a key derived from AUTH0_SECRET, and good for two minutes. The
   page trusts nothing else. Its own key, so a design ticket can never print a
   certificate or the other way round. Server-only (node:crypto). */

import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 2 * 60_000;

export type CertTicket = { orgId: string; versionId: string };

function key(): Buffer {
  const secret = process.env.AUTH0_SECRET;
  if (!secret) throw new Error("AUTH0_SECRET is not set");
  return createHmac("sha256", secret).update("heytiff/cert-pdf/v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signCertTicket(t: CertTicket, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ orgId: t.orgId, versionId: t.versionId, exp: now + TTL_MS }));
  const sig = b64(createHmac("sha256", key()).update(body).digest());
  return `${body}.${sig}`;
}

/** The ticket's contents, or null when it is forged, altered or stale. */
export function readCertTicket(token: string | undefined, now: number = Date.now()): CertTicket | null {
  if (!token || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: { orgId?: unknown; versionId?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
  if (typeof parsed.orgId !== "string" || typeof parsed.versionId !== "string") return null;
  return { orgId: parsed.orgId, versionId: parsed.versionId };
}
