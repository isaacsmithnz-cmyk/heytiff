/* THE ONE NUMBER — how many days before anything expires the app starts
   saying so.

   It used to be six numbers in three files, every one of them 30:
   EXPIRY_WARN_DAYS for a staff ticket, a visa, and the business's own papers;
   REGO / INSURANCE / CTP / SERVICE_WARN_DAYS for the fleet. Six copies of one
   decision is six places for it to drift, and none of them was a setting —
   the only way a person could change when they heard about an expiry was to
   press Remind me on each card, one card at a time, which is what issue #640
   is about.

   NOW IT IS A COLUMN ON THE ORG (`organizations.expiry_warn_days`), read once
   per request by the loaders and PASSED to every rule that needs it. The
   rules stay pure — they take the number, they do not fetch it — and none of
   them carries a default, on purpose: a default is a site that silently keeps
   saying 30 while the setting says 14, and the type-checker is the only thing
   that reliably finds every caller.

   What is NOT here: the service km clock. `SERVICE_WARN_KM` stays a constant
   in the fleet — it is a different kind of limit, and Isaac kept it fixed.

   The email switch rides beside it: whether the morning list carries what is
   inside this window. Same row, same read, same screen. */

/** What a fresh workspace gets — the number the six constants all were. */
export const DEFAULT_EXPIRY_WARN_DAYS = 30;

export const EXPIRY_WARN_MIN = 1;
export const EXPIRY_WARN_MAX = 365;

export type ExpiryWindow = {
  /** Days before an expiry at which it starts to warn. */
  warnDays: number;
  /** Whether the morning email carries what is inside the window. */
  email: boolean;
};

export const DEFAULT_EXPIRY_WINDOW: ExpiryWindow = { warnDays: DEFAULT_EXPIRY_WARN_DAYS, email: true };

export const EXPIRY_WARN_ERROR = `Warn between ${EXPIRY_WARN_MIN} and ${EXPIRY_WARN_MAX} days before something expires.`;

/** A whole number of days inside the range the column's CHECK allows. */
export function isExpiryWarnDays(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= EXPIRY_WARN_MIN && v <= EXPIRY_WARN_MAX;
}

/** The settings box, typed by a person. Digits only — a sign or a point is
    refused rather than salvaged, for the same reason a head count is. */
export function readExpiryWarnDays(raw: string): number | "invalid" {
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return "invalid";
  const n = parseInt(s, 10);
  return isExpiryWarnDays(n) ? n : "invalid";
}

/** A row's value, believed only inside the range; anything else is the
    default. The column is NOT NULL with a CHECK, so this only ever matters for
    a read that failed or a workspace that has not taken the migration. */
export function expiryWarnDaysFrom(v: unknown): number {
  return isExpiryWarnDays(v) ? v : DEFAULT_EXPIRY_WARN_DAYS;
}
