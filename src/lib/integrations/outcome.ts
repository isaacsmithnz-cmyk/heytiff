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
  /** Another HeyTiff workspace already holds this ServiceM8 account. */
  elsewhere:
    "That ServiceM8 account is already connected to another HeyTiff workspace, so nothing changed here. Disconnect it there first, or connect a different account.",
  /** A reconnect whose account couldn't be read: the working grant is kept. */
  account: "ServiceM8 didn't say which account that was, so nothing changed here. Try again.",
  /** 402: the account isn't in good standing (an ended trial, an unpaid invoice). */
  billing:
    "That ServiceM8 account isn't accepting requests until its plan or invoice is sorted, so nothing changed here.",
} as const;

const SM8_GENERIC = "Something went wrong connecting ServiceM8. Try again.";

export function sm8ConnectMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(SM8_CONNECT_ERRORS, code)
    ? SM8_CONNECT_ERRORS[code as keyof typeof SM8_CONNECT_ERRORS]
    : SM8_GENERIC;
}

/* ── what a reconnect or a disconnect did ── */

/** Names as a list is read: "A", "A and B", "A, B and 3 more". `extra`
    counts things in the list that have no name to show. */
export function nameList(names: readonly string[], extra: number = 0): string {
  const total = names.length + extra;
  if (names.length === 0) return "";
  const shown = names.slice(0, total > 2 ? 2 : total);
  const rest = total - shown.length;
  if (rest === 0) return shown.length === 1 ? shown[0] : `${shown[0]} and ${shown[1]}`;
  return shown.length === 1 ? `${shown[0]} and ${rest} more` : `${shown[0]}, ${shown[1]} and ${rest} more`;
}

/** The notice after a reconnect to a DIFFERENT ServiceM8 account: which
    account replaced which, what went with the old one, and how many files
    that were waiting to go to it won't. `from` null is an account whose name
    was never read. */
export function sm8SwitchedNotice(input: { to: string; from: string | null; cancelled: number }): string {
  const old = input.from ?? "that account";
  const parts = [
    `Connected to ${input.to}.`,
    `It replaced ${input.from ?? "another ServiceM8 account"}.`,
    `HeyTiff cleared its copy of ${old} and switched sending to ServiceM8 off.`,
  ];
  if (input.cancelled === 1) parts.push(`1 file waiting to go to ${old} was cancelled.`);
  else if (input.cancelled > 1) parts.push(`${input.cancelled} files waiting to go to ${old} were cancelled.`);
  return parts.join(" ");
}

/** The note after a disconnect: what it cancelled, by name, and what was
    already on its way and may still arrive. `unnamed` counts cancelled files
    whose name couldn't be read. */
export function sm8DisconnectNote(input: { cancelled: readonly string[]; unnamed: number; inFlight: number }): string {
  const parts = ["Disconnected here."];
  const n = input.cancelled.length + input.unnamed;
  if (n > 0) {
    const names = nameList(input.cancelled, input.unnamed);
    const what = n === 1 ? "1 file waiting to go to ServiceM8 was cancelled" : `${n} files waiting to go to ServiceM8 were cancelled`;
    parts.push(names ? `${what}: ${names}.` : `${what}.`);
  }
  if (input.inFlight === 1) parts.push("1 file was already on its way to ServiceM8, and may still arrive.");
  else if (input.inFlight > 1) {
    parts.push(`${input.inFlight} files were already on their way to ServiceM8, and may still arrive.`);
  }
  parts.push("To fully revoke access, also remove HeyTiff from your ServiceM8 account's add-ons.");
  return parts.join(" ");
}

/** The disconnect confirm's line for what is still waiting to go. */
export function sm8WaitingConsequence(waiting: number): string | null {
  if (waiting <= 0) return null;
  return waiting === 1
    ? "1 file still waiting to go to ServiceM8 is cancelled."
    : `${waiting} files still waiting to go to ServiceM8 are cancelled.`;
}
