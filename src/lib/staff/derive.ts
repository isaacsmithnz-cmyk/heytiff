/* Values the Team directory and the profile header show but never store —
   derived from the stored card so they can't drift out of sync. */

import { daysUntil as daysBetween, todayInAu } from "@/lib/au-dates";
import { expiryClause } from "@/lib/format/duration";
import type { ComplianceState, StaffLicence } from "./types";

/** Whole-ish years of service, one decimal. "—" when there's no start date. */
export function yearsSince(startIso: string | null | undefined, now = new Date()): string {
  if (!startIso) return "—";
  const start = new Date(String(startIso).slice(0, 10));
  if (Number.isNaN(start.getTime())) return "—";
  const years = (now.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 0) return "—";
  return years.toFixed(1);
}

/** Two-letter avatar initials. Falls back to the email, then "?". */
export function initialsFrom(name: string | null | undefined, email?: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** "Mar 2021" from an ISO date — the profile header's Started line. The bare
    date parses as midnight UTC, so it must be read back in UTC too: with the
    server's own zone, any negative-offset host renders a 1st-of-month start
    as the previous month. */
export function startedLabel(startIso: string | null | undefined): string {
  if (!startIso) return "—";
  const d = new Date(String(startIso).slice(0, 10));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { month: "short", year: "numeric", timeZone: "UTC" });
}

/* Whole days from today to an ISO date. Negative = already past.

   The Date-and-nullable twin of lib/au-dates' `daysUntil`, which does the
   actual counting — this one only exists because `deriveCompliance` is handed a
   `now` rather than a calendar day, and because a card with no expiry recorded
   has to be distinguishable from one expiring today. The moment resolves to the
   AU calendar day — the same anchor every other day-count uses. It used to
   resolve via toISOString(), i.e. the UTC day, which is one behind AU until
   UTC midnight — so for the whole working morning the Team directory said
   "expires tomorrow" while the dashboard chip said "expires today". */
export function daysUntil(iso: string | null | undefined, now = new Date()): number | null {
  const day = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (Number.isNaN(now.getTime())) return null;
  return daysBetween(day, todayInAu(now));
}

/** A licence within this many days reads as "expiring", not "fine". */
export const EXPIRY_WARN_DAYS = 30;

/* Sorts before every real day-count so "nothing recorded" and "all clear"
   never outrank a genuine expiry when the directory sorts by urgency. */
const NO_EXPIRY = 9999;

export type Compliance = { label: string; state: ComplianceState; expiresDays: number };

/* The directory's compliance chip.

   Worst-first: an expired licence beats an expiring one, which beats
   unverified work rights. `expiresDays` drives the "soonest expiry" sort, so
   it always carries the number behind the label — not a placeholder.

   Work rights only warn when a status has been recorded but not verified.
   Someone with nothing entered at all is "not set up yet", not "at risk" —
   flagging them would make every new hire look non-compliant on day one. */
export function deriveCompliance(
  licences: readonly StaffLicence[],
  workRights: { status: string | null; verifiedAt: string | null },
  now = new Date()
): Compliance {
  let worst: { days: number; lic: StaffLicence } | null = null;
  for (const lic of licences) {
    const days = daysUntil(lic.expiryDate, now);
    if (days === null) continue;
    if (!worst || days < worst.days) worst = { days, lic };
  }

  if (worst && worst.days < 0) {
    return {
      label: `${worst.lic.typeName} expired`,
      state: "bad",
      expiresDays: worst.days,
    };
  }
  if (worst && worst.days <= EXPIRY_WARN_DAYS) {
    return {
      label: `${worst.lic.typeName} ${expiryClause(worst.days)}`,
      state: "warn",
      expiresDays: worst.days,
    };
  }

  if (workRights.status && !workRights.verifiedAt) {
    return { label: "Work rights unverified", state: "warn", expiresDays: 0 };
  }

  if (worst) {
    return { label: "Compliant", state: "ok", expiresDays: worst.days };
  }
  // nothing recorded yet — not a problem, just not set up
  return { label: "—", state: "ok", expiresDays: NO_EXPIRY };
}
