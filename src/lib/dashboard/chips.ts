/* Pure derivations for the Dashboard's "action required" chips.

   A chip is one actionable expiry or overdue item. The rule is uniform across
   every source: something already past reads `bad`, something inside its
   warning window reads `warn`, and everything else produces NO chip — a clean
   dashboard is one where nothing needs doing. "ok" is therefore never a chip
   state here (only bad | warn); the empty list IS the all-clear.

   Everything below is pure and deterministic. Each builder takes already-shaped
   fields plus the context needed to label and link the chip, and returns
   chips. It never reads the DB and never sees a capability: the query /
   page-data layer decides WHOSE rows to fetch (your own vs the team's) and what
   the chip links to. That keeps the scoping boundary in the query, matching the
   projection rule the rest of the app follows.

   Date logic reuses fleet's `daysUntil` and warn windows, and the vehicle chips
   read the same `regoDays` / `serviceKmLeft` the register does, so a rego chip
   on the dashboard and the same chip in Assets can't drift apart. */

import {
  INSURANCE_WARN_DAYS,
  REGO_WARN_DAYS,
  SERVICE_WARN_KM,
  daysUntil,
  fmtKm,
  serviceKmLeft,
  type ChipState,
  type VehicleWithFacts,
} from "@/components/fleet/logic";
import { EXPIRY_WARN_DAYS } from "@/lib/staff/derive";

export type ChipKind =
  | "licence"
  | "work-rights"
  | "rego"
  | "insurance"
  | "service"
  | "org-insurance";

/** Only actionable states surface as chips; a compliant thing produces none. */
export type ActionState = Exclude<ChipState, "ok">; // "bad" | "warn"

export type ActionChip = {
  /** Stable React key, unique within a payload. */
  key: string;
  kind: ChipKind;
  state: ActionState;
  /** Headline — what is wrong ("Rego expired 4d ago"). */
  label: string;
  /** Who or what it concerns — a person, a vehicle, or the business. */
  subject: string;
  /** Where to go to fix it. */
  href: string;
  /** Lower = more urgent. Drives the worst-first sort within a section. */
  urgency: number;
};

/* Bad chips always rank before warn chips; within a bucket, closer-to-now wins.
   Date sources contribute `daysUntil` directly (negative = overdue = smallest =
   first). Service is km-based, so its km-left is normalised to a days-like
   number (÷ a nominal 50 km/day) purely so an overdue/soon service interleaves
   sensibly with date expiries instead of dwarfing them — it is a sort hint, not
   a claim about time. */
const SERVICE_KM_PER_DAY = 50;
function urgency(state: ActionState, metric: number): number {
  return (state === "bad" ? 0 : 10_000) + metric;
}

/** "4d ago" / "1d ago" — the trailing clause on an expired label. */
function agoDays(days: number): string {
  return `${-days}d ago`;
}

/** A single licence → a chip when it is expired or expiring soon, else null. */
export function licenceChip(
  lic: { id: string; typeName: string; expiryDate: string | null },
  ctx: { subject: string; href: string; today: string },
): ActionChip | null {
  if (!lic.expiryDate) return null;
  const days = daysUntil(lic.expiryDate, ctx.today);
  if (days > EXPIRY_WARN_DAYS) return null;
  const state: ActionState = days < 0 ? "bad" : "warn";
  return {
    key: `licence:${lic.id}`,
    kind: "licence",
    state,
    label: days < 0 ? `${lic.typeName} expired ${agoDays(days)}` : `${lic.typeName} expires ${days}d`,
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, days),
  };
}

/* Work rights raise two distinct concerns, both actionable:

     1. A recorded visa with an expiry inside the warning window (or past).
     2. A recorded status that has never been verified (VEVO / evidence).

   These are separate items — an in-date visa can still be unverified, and a
   verified visa can still be expiring — so a person can hold one, the other, or
   both. Someone with nothing recorded at all raises neither: a new hire with a
   blank card is "not set up yet", not "at risk", exactly as deriveCompliance
   treats them. */
export function workRightsChips(
  wr: {
    staffId: string;
    status: string | null;
    visaType: string | null;
    visaExpiry: string | null;
    verifiedAt: string | null;
  },
  ctx: { subject: string; href: string; today: string },
): ActionChip[] {
  const chips: ActionChip[] = [];

  if (wr.visaExpiry) {
    const days = daysUntil(wr.visaExpiry, ctx.today);
    if (days <= EXPIRY_WARN_DAYS) {
      const state: ActionState = days < 0 ? "bad" : "warn";
      const what = wr.visaType?.trim() || "Visa";
      chips.push({
        key: `work-rights-visa:${wr.staffId}`,
        kind: "work-rights",
        state,
        label: days < 0 ? `${what} expired ${agoDays(days)}` : `${what} expires ${days}d`,
        subject: ctx.subject,
        href: ctx.href,
        urgency: urgency(state, days),
      });
    }
  }

  if (wr.status && !wr.verifiedAt) {
    // No date to count down — an unverified record is a standing warn until
    // someone checks it, so it sits mid-warn (0-day urgency within the bucket).
    chips.push({
      key: `work-rights-unverified:${wr.staffId}`,
      kind: "work-rights",
      state: "warn",
      label: "Work rights unverified",
      subject: ctx.subject,
      href: ctx.href,
      urgency: urgency("warn", 0),
    });
  }

  return chips;
}

/** Rego expiry chip for a vehicle, from the same day-count the register shows. */
export function regoChip(
  v: Pick<VehicleWithFacts, "id" | "status" | "regoDays">,
  ctx: { subject: string; href: string },
): ActionChip | null {
  if (v.status === "sold") return null;
  if (v.regoDays > REGO_WARN_DAYS) return null;
  const state: ActionState = v.regoDays < 0 ? "bad" : "warn";
  return {
    key: `rego:${v.id}`,
    kind: "rego",
    state,
    label: v.regoDays < 0 ? `Rego expired ${agoDays(v.regoDays)}` : `Rego expires ${v.regoDays}d`,
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, v.regoDays),
  };
}

/** Insurance expiry chip for a vehicle. */
export function insuranceChip(
  v: Pick<VehicleWithFacts, "id" | "status" | "insuranceDays">,
  ctx: { subject: string; href: string },
): ActionChip | null {
  if (v.status === "sold") return null;
  if (v.insuranceDays > INSURANCE_WARN_DAYS) return null;
  const state: ActionState = v.insuranceDays < 0 ? "bad" : "warn";
  return {
    key: `insurance:${v.id}`,
    kind: "insurance",
    state,
    label:
      v.insuranceDays < 0
        ? `Insurance expired ${agoDays(v.insuranceDays)}`
        : `Insurance expires ${v.insuranceDays}d`,
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, v.insuranceDays),
  };
}

/** Service-due chip for a vehicle (km-based, not a date). */
export function serviceChip(
  v: Pick<VehicleWithFacts, "id" | "status" | "odometer" | "serviceIntervalKm" | "lastServiceOdo">,
  ctx: { subject: string; href: string },
): ActionChip | null {
  if (v.status === "sold") return null;
  const left = serviceKmLeft(v as VehicleWithFacts);
  if (left > SERVICE_WARN_KM) return null;
  const state: ActionState = left < 0 ? "bad" : "warn";
  return {
    key: `service:${v.id}`,
    kind: "service",
    state,
    label: left < 0 ? `Service overdue ${fmtKm(-left)} km` : `Service in ${fmtKm(left)} km`,
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, left / SERVICE_KM_PER_DAY),
  };
}

/** All expiry/overdue chips for one vehicle, worst-first. */
export function vehicleChips(
  v: VehicleWithFacts,
  ctx: { subject: string; href: string },
): ActionChip[] {
  return sortChips(
    [regoChip(v, ctx), insuranceChip(v, ctx), serviceChip(v, ctx)].filter(
      (c): c is ActionChip => c !== null,
    ),
  );
}

/** The business's own public-liability insurance expiry. */
export function orgInsuranceChip(
  org: { insurer: string | null; insuranceExpiry: string | null },
  ctx: { href: string; today: string },
): ActionChip | null {
  if (!org.insuranceExpiry) return null;
  const days = daysUntil(org.insuranceExpiry, ctx.today);
  if (days > EXPIRY_WARN_DAYS) return null;
  const state: ActionState = days < 0 ? "bad" : "warn";
  return {
    key: "org-insurance",
    kind: "org-insurance",
    state,
    label: days < 0 ? `Public liability expired ${agoDays(days)}` : `Public liability expires ${days}d`,
    subject: org.insurer?.trim() || "Public liability insurance",
    href: ctx.href,
    urgency: urgency(state, days),
  };
}

/** Worst-first: bad before warn, then closest-to-now within a bucket. Stable. */
export function sortChips(chips: readonly ActionChip[]): ActionChip[] {
  return [...chips].sort((a, b) => a.urgency - b.urgency);
}
