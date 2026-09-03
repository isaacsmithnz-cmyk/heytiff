/* Renewal reminders — the pure half.

   "Remind me 30 days before the rego expires" is a TASK: titled for the
   vehicle, due `lead` days before the expiry, nudged that morning through the
   same bell, day rail, snooze and completion every other task has. Nothing
   here is a second reminders system; these are the few facts the fleet adds
   to a task — which leads are offered, what the task is called, when it falls
   due — kept pure so they are tested to the day. */

import type { RenewalKind, VehicleIdentity } from "@/components/fleet/logic";
import { plusDays } from "@/lib/workboard/dates";

/** The leads the card offers, in the order the chips read. Zero is "on expiry". */
export const REMINDER_LEADS = [30, 14, 7, 0] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

export const isReminderLead = (v: unknown): v is ReminderLead =>
  typeof v === "number" && (REMINDER_LEADS as readonly number[]).includes(v);

/** "30 days before" · "On expiry". */
export function leadLabel(lead: number): string {
  return lead === 0 ? "On expiry" : `${lead} days before`;
}

/** A reminder as the card sees it: one of the viewer's own open tasks about
    this vehicle's renewal. The card only ever asks "is this chip on". */
export type RenewalReminder = {
  taskId: string;
  kind: RenewalKind;
  leadDays: number;
  dueDate: string | null;
};

export const RENEWAL_NOUN: Record<RenewalKind, string> = {
  rego: "rego",
  insurance: "insurance",
  ctp: "green slip",
};

/** The day the reminder falls due: the expiry, less the lead. */
export function reminderDueDate(expiresOn: string, leadDays: number): string {
  return plusDays(expiresOn, -leadDays);
}

/** "Renew rego — WORK TRITON (YLI59V)". The plate is always there, because
    two vehicles can share a name and no two share a plate. */
export function reminderTitle(v: Pick<VehicleIdentity, "name" | "plate" | "make" | "model">, kind: RenewalKind): string {
  const who = v.name.trim() || `${v.make} ${v.model}`.trim() || v.plate;
  return `Renew ${RENEWAL_NOUN[kind]} — ${who} (${v.plate})`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y}`;
};

/** "Expires 29 Sep 2027 · 30 days' notice" — what the bell shows under the title. */
export function reminderDetail(expiresOn: string, leadDays: number): string {
  const notice = leadDays === 1 ? "1 day's notice" : leadDays > 0 ? `${leadDays} days' notice` : null;
  return [`Expires ${dayLabel(expiresOn)}`, notice].filter(Boolean).join(" · ");
}
