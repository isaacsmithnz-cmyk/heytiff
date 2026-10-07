/* HOW A BUSINESS'S JOBS ARE COUNTED (Isaac, 2026-10-07: "How do we make it
   universal", "Settings options maybe?"). One row per business
   (analytics_settings), written on Admin, Analytics, and read by the page.

   Nothing here has to be set. A business that never opens the page gets
   what the live account taught (docs/job-analytics-plan.md): its categories
   are read from their names, the clients that look like bookings rather
   than customers are found and left out, and the age at which ServiceM8
   closes an unanswered quote is found in the jobs. Each setting, once
   saved, replaces the reading it stands for.

   Pure: the server reads the row (settings-query.ts) and the jobs. */

import { LAPSE_AFTER_DAYS, QUOTE_LIKELY_FROM_CENTS } from "./job-analytics";

/** What a ServiceM8 category's jobs are, for the figures. */
export type CategoryRole = "install" | "service" | "maintenance" | "warranty" | "not_job" | "other";

export const CATEGORY_ROLES: readonly CategoryRole[] = ["install", "service", "maintenance", "warranty", "other", "not_job"];

export type AnalyticsSettings = {
  /** a Quote with no answer this many days after it was raised counts as lost; null: 180 */
  lapseAfterDays: number | null;
  /** a work order this big with no quote sent is asked about; cents ex GST; null: $3,000 */
  quoteFromCents: number | null;
  /** ServiceM8 closes an unanswered Quote this many days after it became one;
      0: it doesn't; null: found in the jobs */
  autoCloseDays: number | null;
  /** by ServiceM8 category uuid; a category not here is read from its name */
  categoryRoles: Record<string, CategoryRole>;
  /** ServiceM8 client uuids whose cards are bookings, not work; null: the
      ones found in the jobs */
  notCustomers: string[] | null;
};

export const DEFAULT_SETTINGS: AnalyticsSettings = {
  lapseAfterDays: null,
  quoteFromCents: null,
  autoCloseDays: null,
  categoryRoles: {},
  notCustomers: null,
};

export const MIN_LAPSE_DAYS = 91;
export const MAX_LAPSE_DAYS = 730;
export const MAX_QUOTE_FROM_CENTS = 10_000_000;
export const MAX_AUTO_CLOSE_DAYS = 365;

const isRole = (v: unknown): v is CategoryRole => typeof v === "string" && (CATEGORY_ROLES as readonly string[]).includes(v);
const wholeIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const uuidish = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;

/** Settings from a row or from the browser, anything unreadable left unset. */
export function normaliseSettings(input: unknown): AnalyticsSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = (camel: string, snake: string) => (camel in r ? r[camel] : r[snake]);
  const roles: Record<string, CategoryRole> = {};
  const rawRoles = pick("categoryRoles", "category_roles");
  if (rawRoles && typeof rawRoles === "object" && !Array.isArray(rawRoles))
    for (const [k, v] of Object.entries(rawRoles)) if (uuidish(k) && isRole(v)) roles[k] = v;
  const rawClients = pick("notCustomers", "not_customers");
  return {
    lapseAfterDays: wholeIn(pick("lapseAfterDays", "lapse_after_days"), MIN_LAPSE_DAYS, MAX_LAPSE_DAYS),
    quoteFromCents: wholeIn(pick("quoteFromCents", "quote_from_cents"), 0, MAX_QUOTE_FROM_CENTS),
    autoCloseDays: wholeIn(pick("autoCloseDays", "auto_close_days"), 0, MAX_AUTO_CLOSE_DAYS),
    categoryRoles: roles,
    notCustomers: Array.isArray(rawClients) ? [...new Set(rawClients.filter(uuidish))].slice(0, 200) : null,
  };
}

/** The row as the table keeps it. */
export const settingsRow = (s: AnalyticsSettings) => ({
  lapse_after_days: s.lapseAfterDays,
  quote_from_cents: s.quoteFromCents,
  auto_close_days: s.autoCloseDays,
  category_roles: s.categoryRoles,
  not_customers: s.notCustomers,
});

/** The rules the figures are worked out by. */
export type Rules = {
  lapseAfterDays: number;
  quoteFromCents: number;
  /** the age ServiceM8 closes an unanswered Quote at; null: it doesn't, or none was found */
  closeAfterDays: number | null;
};

/** The business's rules; the close age is its setting, else what was found in the jobs. */
export const rulesOf = (s: AnalyticsSettings, found: number | null = null): Rules => ({
  lapseAfterDays: s.lapseAfterDays ?? LAPSE_AFTER_DAYS,
  quoteFromCents: s.quoteFromCents ?? QUOTE_LIKELY_FROM_CENTS,
  closeAfterDays: s.autoCloseDays === null ? found : s.autoCloseDays === 0 ? null : s.autoCloseDays,
});

/** A category's role read from its name, as the live account names them
    ("Install", "Construction Project", "Service Call", "Annual Maintenance",
    "Warranty"); anything else is other work. */
export function guessRole(name: string | null): CategoryRole {
  const n = (name ?? "").toLowerCase();
  if (/warrant/.test(n)) return "warranty";
  if (/service/.test(n)) return "service";
  if (/maint/.test(n)) return "maintenance";
  if (/install|construction|project/.test(n)) return "install";
  return "other";
}

/** A category's role: the business's, else read from the name. */
export const roleOf = (s: AnalyticsSettings, uuid: string | null, name: string | null): CategoryRole =>
  (uuid ? s.categoryRoles[uuid] : undefined) ?? guessRole(name);

/* ── found in the jobs ── */

/** One card as the finding reads it. */
export type CardFacts = { clientId: string | null; quoted: boolean; invoiced: boolean; paid: boolean; priced: boolean };

/** Below this many cards a client is never taken for a booking. */
export const BOOKING_CARDS = 6;

/** Clients whose cards look like bookings rather than work (the live
    account's TAFE NSW: 161 cards for the apprentice's TAFE day, none
    quoted, invoiced or paid, nine with a template's call-out fee): six
    cards or more, none quoted, invoiced or paid, a fifth or fewer priced.
    Most cards first. */
export function bookingClients(cards: readonly CardFacts[]): { clientId: string; cards: number }[] {
  const by = new Map<string, { cards: number; priced: number; work: boolean }>();
  for (const c of cards) {
    if (!c.clientId) continue;
    const b = by.get(c.clientId) ?? { cards: 0, priced: 0, work: false };
    b.cards++;
    if (c.priced) b.priced++;
    if (c.quoted || c.invoiced || c.paid) b.work = true;
    by.set(c.clientId, b);
  }
  return [...by]
    .filter(([, b]) => b.cards >= BOOKING_CARDS && !b.work && b.priced <= b.cards / 5)
    .map(([clientId, b]) => ({ clientId, cards: b.cards }))
    .sort((a, b) => b.cards - a.cards);
}

/** The fewest Unsuccessful quotes, and the share of them, that one close age must hold. */
const CLOSE_AT_LEAST = 5;
const CLOSE_SHARE = 0.25;

/** Hours from a Quote's quote date to its last edit, for an Unsuccessful
    job; null when either stamp can't be read. Stamps are the account's wall
    clock, compared as they stand. */
export function hoursToClose(quoteStamp: string | null, editStamp: string | null): number | null {
  const at = (s: string | null) => (s && s.length >= 19 ? Date.parse(`${s.slice(0, 10)}T${s.slice(11, 19)}Z`) : NaN);
  const h = (at(editStamp) - at(quoteStamp)) / 3_600_000;
  return Number.isFinite(h) && h > 0 ? h : null;
}

/** Whether a gap is a whole number of days to within two hours, and which. */
export function wholeDays(hours: number): number | null {
  const d = Math.round(hours / 24);
  return d >= 1 && Math.abs(hours - d * 24) <= 2 ? d : null;
}

/** The age ServiceM8 closes an unanswered Quote at, found in the jobs: the
    one whole number of days, to the hour, that a quarter of the Unsuccessful
    quotes and at least five were closed at (the live account: 60 days,
    35 of 80). Null when no age stands out. */
export function closeAgeOf(gapsHours: readonly number[]): { days: number; count: number } | null {
  const by = new Map<number, number>();
  for (const h of gapsHours) {
    const d = wholeDays(h);
    if (d !== null) by.set(d, (by.get(d) ?? 0) + 1);
  }
  let best: { days: number; count: number } | null = null;
  for (const [days, count] of by) if (!best || count > best.count) best = { days, count };
  if (!best || best.count < CLOSE_AT_LEAST || best.count < gapsHours.length * CLOSE_SHARE) return null;
  return best;
}
