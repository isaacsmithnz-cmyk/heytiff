import { chipGroup, sortChips, type ActionChip, type ChipKind } from "./chips";
import type { DashboardChips } from "./assemble";

/* WHAT IS EXPIRING, for the morning email — the pure half (issue #640,
   piece 4 of 4).

   An expiry warning is a fact the software can see coming, not something a
   person asked for, so the email does not keep a list of its own: it reads
   THE SAME CHIPS THE BELL SHOWS, assembled for the same person under the same
   capabilities, and carries the ones that are about a date. Nothing is
   stored, nothing is stamped — the list is a status, present each morning
   while something sits inside the org's window, gone the morning it is
   renewed. That is the whole reason the per-card Remind me could go: the
   thing it was the only door to is now automatic.

   Pay chips stay out. A claim waiting on a decision, a timesheet sent back,
   a leave request declined — those are real and the bell shows them, but
   they are not expiries and the switch on the Organisation card says
   "expiring", not "everything". */

export type ExpiringItem = {
  /** "Public liability expires in 12 days" — the chip's own headline. */
  label: string;
  /** Who or what — a person, a vehicle, the business. */
  subject: string;
  state: "bad" | "warn";
  href: string;
};

/** The chip kinds that are about a DATE (or, for a service, a date-or-km). */
export const EXPIRY_KINDS: ReadonlySet<ChipKind> = new Set<ChipKind>([
  "licence",
  "work-rights",
  "rego",
  "insurance",
  "ctp",
  "service",
  "org-insurance",
  "org-licence",
]);

export function isExpiryChip(chip: ActionChip): boolean {
  return EXPIRY_KINDS.has(chip.kind) && chipGroup(chip.kind) !== "Pay";
}

/** The expiry chips a person would see in their bell, worst first. */
export function expiringItems(chips: DashboardChips): ExpiringItem[] {
  return sortChips([...chips.self, ...chips.team].filter(isExpiryChip)).map((c) => ({
    label: c.label,
    subject: c.subject,
    state: c.state,
    href: c.href,
  }));
}
