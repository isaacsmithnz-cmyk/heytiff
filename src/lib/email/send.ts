import "server-only";

/* The app's own mailer. One provider, one function, no SDK.

   WHY A BARE FETCH. Resend's REST API for a single transactional send is one
   POST with a JSON body; the SDK wraps that in a dependency, and this repo has
   a standing reason to avoid dependencies it does not need — node_modules gets
   evicted by iCloud and a package that is present-but-zero-bytes fails in ways
   that read as a code bug. Nothing here would be shorter with the client.

   THE DOMAIN IS ALREADY PROVEN. `mail.hey-tiff.com` is verified in Resend and
   is what Auth0 has been sending its seven letters through since 2026-09-02
   (docs/auth0-branding.md). This module is the app finally sending its own —
   until now HeyTiff had no mailer at all, which is why an invitation was a
   link you copied out of the Pending tab and pasted into somebody's chat.

   UNCONFIGURED IS A RESULT, NOT AN ERROR. A local checkout, a preview deploy
   and CI all run without a key, and none of them should see an invitation
   fail. `unconfigured` comes back and the caller says what happened — which
   is why createInvite reports whether the letter went, rather than claiming
   it did. Sending is never the thing that fails an invite: the row is the
   invitation, the letter is only its delivery. */

const ENDPOINT = "https://api.resend.com/emails";

/** Verified sender on the Resend domain. Overridable for a tenant that wants
    its own, but the default is the address the brand already sends from. */
const DEFAULT_FROM = "HeyTiff <no-reply@mail.hey-tiff.com>";

export type SendResult =
  | { ok: true }
  /** No API key in this environment — local, preview, CI. Expected. */
  | { ok: false; reason: "unconfigured" }
  /** The provider refused or the network did. `detail` is for the log, never
      for the screen: it can carry a provider message about an address. */
  | { ok: false; reason: "failed"; detail: string };

/** Whether a letter posted from this process can actually leave. Read it to
    decide what to SAY, never to decide whether the underlying act happened. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** One file riding on a letter: the name it arrives under, and its bytes as
    base64 — the provider's own shape. */
export type MailAttachment = { filename: string; content: string };

/* WHO A LETTER IS FROM, when it is sent FOR somebody. The address stays the
   verified one — the domain is what the provider will sign — and only the
   name in front of it changes: "Smith & Sons via HeyTiff". The name is
   typed data, so anything that could end the phrase or open a second address
   is taken out before it is quoted. */
export function fromFor(name: string | undefined, configured: string = process.env.MAIL_FROM ?? DEFAULT_FROM): string {
  const clean = (name ?? "").replace(/["\\<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return configured;
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  return `"${clean}" <${address}>`;
}

export async function sendEmail(letter: {
  /** One address, or a few — a customer and their builder. */
  to: string | readonly string[];
  subject: string;
  html: string;
  /** Who a confused recipient should reach. An invitation from a no-reply
      address with no human behind it is indistinguishable from a phish, so
      every letter that names a person sets this to that person. */
  replyTo?: string;
  /** A quiet copy — the sender's own record of a letter that did not leave
      from their own mailbox. */
  bcc?: readonly string[];
  /** The name the letter is from, in front of the verified address. */
  fromName?: string;
  attachments?: readonly MailAttachment[];
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "unconfigured" };

  const to = typeof letter.to === "string" ? [letter.to] : [...letter.to];
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromFor(letter.fromName),
        to,
        subject: letter.subject,
        html: letter.html,
        ...(letter.replyTo ? { reply_to: letter.replyTo } : {}),
        ...(letter.bcc?.length ? { bcc: [...letter.bcc] } : {}),
        ...(letter.attachments?.length
          ? { attachments: letter.attachments.map((a) => ({ filename: a.filename, content: a.content })) }
          : {}),
      }),
    });

    if (!res.ok) {
      /* Read the body for the log — a 422 here is almost always a sender
         domain that has come unverified or an address the provider rejects,
         and neither is diagnosable from the status alone. */
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: "failed", detail: `${res.status} ${detail}`.trim() };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
