import { daysUntil, formatAuDate } from "@/lib/au-dates";
import { expiryClause } from "@/lib/format/duration";
import { isNoVisa } from "./work-rights";
import type { StaffProfile } from "./profile";

/* The work-rights tile on Summary — the first tile in the row of tickets, and
   the one that answers the page's question: is this person cleared to work?

   Three lines, like every tile beside it: what the status is, what visa sits
   under it, and the state in its colour. The state ranks the way the
   directory's compliance chip ranks (derive.ts): a lapsed visa outranks one
   about to lapse, which outranks a visa nobody has checked. A citizen or a
   permanent resident has no visa to check, so the tile says so rather than
   waiting for a check that can never come (see lib/staff/work-rights).

   Pure, so the tile and its test need no DOM. */

export type TileTone = "ok" | "warn" | "bad" | "mute";

export type WorkRightsTile = {
  /** the status, or "Work rights" while there is none */
  title: string;
  /** the visa under it, or null when there is nothing to say */
  sub: string | null;
  /** the state, in its colour */
  foot: { label: string; tone: TileTone };
  /** nothing recorded: the tile is the way into the form, and the field is required */
  unset: boolean;
};

export function workRightsTile(
  p: StaffProfile | null,
  today: string,
  warnDays: number,
): WorkRightsTile {
  const status = (p?.work_rights_status ?? "").trim();
  if (!status) {
    return {
      title: "Work rights",
      sub: "Not recorded",
      foot: { label: "Required", tone: "warn" },
      unset: true,
    };
  }
  if (status === "No working rights") {
    return { title: status, sub: null, foot: { label: "Not cleared to work", tone: "bad" }, unset: false };
  }
  if (isNoVisa(status)) {
    return {
      title: status,
      sub: "No visa required",
      foot: { label: "Full working rights", tone: "ok" },
      unset: false,
    };
  }

  const visa = (p?.visa_type ?? "").trim() || "Visa";
  const expiry = (p?.visa_expiry ?? "").slice(0, 10) || null;
  const sub = expiry ? `${visa}, expires ${formatAuDate(expiry)}` : visa;
  const days = expiry ? daysUntil(expiry, today) : null;
  if (days !== null && days < 0) {
    return { title: status, sub, foot: { label: `Visa ${expiryClause(days)}`, tone: "bad" }, unset: false };
  }
  if (days !== null && days <= warnDays) {
    return { title: status, sub, foot: { label: `Visa ${expiryClause(days)}`, tone: "warn" }, unset: false };
  }
  const checked = (p?.vevo_checked_at ?? "").slice(0, 10);
  if (checked) {
    return { title: status, sub, foot: { label: `Checked ${formatAuDate(checked)}`, tone: "ok" }, unset: false };
  }
  return { title: status, sub, foot: { label: "Not checked", tone: "warn" }, unset: false };
}
