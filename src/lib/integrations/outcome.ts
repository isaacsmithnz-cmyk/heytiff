/* How a finished OAuth round trip is told to the person who started it.

   The routes redirect back to the Xero screen with `?connected=1` or
   `?error=<code>`; this turns a code into a sentence. Codes, not messages, ride
   in the URL — a message in a query string is a message anyone can put there,
   and a page that renders arbitrary query text is a phishing surface.

   Anything unrecognised falls back to the generic line rather than rendering
   the code, for the same reason. */

/* The customer never supplies Xero credentials — one HeyTiff-owned Xero app
   serves every workspace, so `unconfigured` and `nokey` are OUR deployment
   being incomplete, not anything the reader can fix. They're worded to say so,
   rather than naming environment variables at a business owner. */
export const CONNECT_ERRORS = {
  /** No XERO_CLIENT_ID / SECRET / APP_BASE_URL on this deployment. */
  unconfigured: "Xero connections aren't switched on yet — that's on our side, not yours.",
  /** INTEGRATIONS_TOKEN_KEY missing — we will not store tokens unsealed. */
  nokey: "Xero connections aren't switched on yet — that's on our side, not yours.",
  /** The person pressed Cancel on Xero's consent screen. */
  denied: "You cancelled the Xero connection, so nothing changed.",
  /** State cookie missing, stale, or from a different organisation. */
  state: "That connection attempt expired or didn't match this workspace. Start it again.",
  /** Xero refused the code exchange, or returned no organisation. */
  exchange: "Xero didn't complete the connection. Try again.",
  /** The grant was fine; writing it here wasn't. */
  save: "Xero authorised the connection, but it couldn't be saved. Try again.",
} as const;

export type ConnectErrorCode = keyof typeof CONNECT_ERRORS;

const GENERIC = "Something went wrong connecting Xero. Try again.";

export function connectMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(CONNECT_ERRORS, code)
    ? CONNECT_ERRORS[code as ConnectErrorCode]
    : GENERIC;
}

/* ServiceM8's copy of the same table — worded per provider rather than
   templated, because two of the sentences aren't parallel: ServiceM8 has no
   revocation endpoint, so its `save` failure can't promise a cleanup the way
   Xero's does, and its consent screen is ServiceM8's own. Same codes, same
   never-echo rule. */
export const SM8_CONNECT_ERRORS = {
  /** No SM8_CLIENT_ID / SECRET / APP_BASE_URL on this deployment. */
  unconfigured: "ServiceM8 connections aren't switched on yet — that's on our side, not yours.",
  /** INTEGRATIONS_TOKEN_KEY missing — we will not store tokens unsealed. */
  nokey: "ServiceM8 connections aren't switched on yet — that's on our side, not yours.",
  /** The person pressed Cancel on ServiceM8's consent screen. */
  denied: "You cancelled the ServiceM8 connection, so nothing changed.",
  /** State cookie missing, stale, or from a different organisation. */
  state: "That connection attempt expired or didn't match this workspace. Start it again.",
  /** ServiceM8 refused the code exchange. */
  exchange: "ServiceM8 didn't complete the connection. Try again.",
  /** The grant was fine; writing it here wasn't. */
  save: "ServiceM8 authorised the connection, but it couldn't be saved here. Try again.",
} as const;

const SM8_GENERIC = "Something went wrong connecting ServiceM8. Try again.";

export function sm8ConnectMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(SM8_CONNECT_ERRORS, code)
    ? SM8_CONNECT_ERRORS[code as keyof typeof SM8_CONNECT_ERRORS]
    : SM8_GENERIC;
}
