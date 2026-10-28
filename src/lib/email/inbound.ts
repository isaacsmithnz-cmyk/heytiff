import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/* EMAIL TO TIFF, the address and the door (Isaac, 28 October 2026: "I want to
   be able to forward an email for a builder into tiff to create a job, read
   scope etc"; the mock he said "Build it in" to).

   ONE ADDRESS A BUSINESS, long and random: tiff-k7m2q9xw@in.hey-tiff.com. The
   norms he approved on 20 October: a generated address no one can guess
   (Xero, ServiceM8, Trello do the same), mail taken only from the business's
   own people, and a new address kills the old. Never a name: "one wrong
   letter" and a builder's tender lands in someone else's workspace.

   THE DOOR is Resend's receiving (resend.com/docs/dashboard/receiving): an MX
   record on the subdomain sends every address at it to Resend, which posts
   `email.received` to our webhook, signed the Svix way. The webhook carries
   only who and what; the body and the files are fetched after
   (inbound-server.ts). Pure here: the address, which business an email is
   for, and whether the post really came from Resend. */

/** The subdomain mail to Tiff is received at; MX to Resend. */
export const EMAIL_IN_DOMAIN = process.env.TIFF_EMAIL_IN_DOMAIN?.trim() || "in.hey-tiff.com";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 10;

/** A new address's token: ten letters and digits nobody could guess or misread
    (no 0/o, 1/l/i). About 49 bits, so a guessed address finds no one. */
export function newEmailToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** The address a business forwards to. */
export const emailInAddress = (token: string, domain = EMAIL_IN_DOMAIN) => `tiff-${token}@${domain}`;

/** The token an email was sent to, from its recipients: the first address at
    our domain shaped like ours. Case doesn't matter; display names and angle
    brackets are allowed ("Tiff <tiff-k7m2q9xw@in.hey-tiff.com>"). */
export function tokenFromRecipients(recipients: readonly (string | null | undefined)[], domain = EMAIL_IN_DOMAIN): string | null {
  const at = domain.toLowerCase();
  for (const r of recipients) {
    const m = /<?\s*tiff-([a-z0-9]{6,32})@([a-z0-9.-]+)\s*>?\s*$/i.exec((r ?? "").trim());
    if (m && m[2]!.toLowerCase() === at) return m[1]!.toLowerCase();
  }
  return null;
}

/** "Matt Glass <matt@truecut.com.au>" → its address, lower case; a bare
    address as it is. */
export function addressOf(from: string | null | undefined): string | null {
  const s = (from ?? "").trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) ?? /([^\s<>"]+@[^\s<>"]+)/.exec(s);
  return m ? m[1]!.toLowerCase() : null;
}

/** "Matt Glass <matt@truecut.com.au>" → "Matt Glass"; null with no name. */
export function nameOf(from: string | null | undefined): string | null {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(from ?? "");
  return m ? m[1]!.trim() || null : null;
}

/** How far a signed post's time may be from ours, either way. */
const TOLERANCE_S = 5 * 60;

/** Whether a webhook post was signed by Resend with our secret
    (docs.svix.com/receiving/verifying-payloads/how-manual): HMAC-SHA256,
    keyed by the base64 after "whsec_", over "id.timestamp.body", compared in
    constant time against each "v1,<base64>" the header carries; and sent
    within five minutes of now, so an old post can't be replayed. */
export function signedByResend(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowS = Math.floor(Date.now() / 1000)
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .some((s) => {
      const given = Buffer.from(s.slice(3), "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/** Whether the receiving server found a sender forged, so "From: isaac@…"
    is someone else using his name: their domain's DMARC failed, or nothing
    passed and a check their domain does publish failed (SPF names other
    servers, a DKIM signature is broken). A domain that publishes nothing to
    check is not forged, and nor is mail the receiver couldn't judge (null):
    many small businesses have no SPF, DKIM or DMARC at all (Diamond Air's
    first forward was refused for it, 28 October 2026), and for them the
    long random address and the team's own addresses are the guard. */
export function senderForged(auth: { spf?: string | null; dkim?: string | null; dmarc?: string | null } | null | undefined): boolean {
  if (!auth) return false;
  if (auth.dmarc === "fail") return true;
  if (auth.dkim === "pass" || auth.spf === "pass") return false;
  return auth.spf === "fail" || auth.dkim === "fail";
}

/** What an email said, as plain words: its text part, else its HTML with the
    tags taken out and its breaks kept. Long tender emails are kept whole up
    to 60,000 characters; the rest is cut and says so. */
export function textOfEmail(text: string | null | undefined, html: string | null | undefined): string {
  let out = (text ?? "").trim();
  if (!out && html) {
    out = html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const MAX = 60_000;
  return out.length > MAX ? `${out.slice(0, MAX)}\n\n[The rest of this email was too long to keep.]` : out;
}

/** Which of an email's attachments are kept: the files a job's Documents
    take (PDFs and pictures, up to 50 MB each), never a signature's inline
    logo, at most twelve. The rest are named, not kept. */
export function keptAttachments<T extends { content_type?: string | null; content_disposition?: string | null; size?: number | null; filename?: string | null }>(
  all: readonly T[],
  allowed: Readonly<Record<string, string>>,
  maxBytes: number
): { kept: (T & { ext: string })[]; skipped: string[] } {
  const kept: (T & { ext: string })[] = [];
  const skipped: string[] = [];
  for (const a of all) {
    const type = (a.content_type ?? "").toLowerCase();
    const ext = allowed[type];
    const inlinePicture = (a.content_disposition ?? "").toLowerCase() === "inline" && type.startsWith("image/");
    if (inlinePicture) continue;
    if (!ext || (a.size ?? 0) > maxBytes || kept.length >= 12) {
      skipped.push(a.filename || "a file");
      continue;
    }
    kept.push({ ...a, ext });
  }
  return { kept, skipped };
}
