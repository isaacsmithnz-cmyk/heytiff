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
  CTP_WARN_DAYS,
  INSURANCE_WARN_DAYS,
  REGO_WARN_DAYS,
  SERVICE_WARN_KM,
  fmtKm,
  serviceDue,
  type ChipState,
  type VehicleWithFacts,
} from "@/components/fleet/logic";
import { daysUntil, fmtAuDayMonth } from "@/lib/au-dates";
import { agoLabel, expiryClause, inLabel } from "@/lib/format/duration";
import { EXPIRY_WARN_DAYS } from "@/lib/staff/derive";
import { isNoVisa } from "@/lib/staff/work-rights";

export type ChipKind =
  | "licence"
  | "work-rights"
  | "rego"
  | "insurance"
  | "ctp"
  | "service"
  | "org-insurance"
  | "expenses"
  | "timesheet"
  | "claim"
  | "leave-queue"
  | "leave-declined";

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

/* Which part of the business a chip belongs to.

   The state (red/amber) says how urgent something is, but on its own it never
   says what KIND of thing it is — an expiring rego and an expiring licence
   looked identical apart from their wording. The group is the second channel:
   colour carries urgency, the icon and tag carry the domain, so a mixed list is
   scannable without reading every label. Icons match the ones the nav already
   uses for those areas (Assets is a truck), so the association is pre-taught. */
export type ChipGroup = "Fleet" | "People" | "Business" | "Pay";

const GROUP_OF: Record<ChipKind, ChipGroup> = {
  licence: "People",
  "work-rights": "People",
  rego: "Fleet",
  insurance: "Fleet",
  ctp: "Fleet",
  service: "Fleet",
  "org-insurance": "Business",
  /* All three money-and-hours sources file under Pay, including the approver's
     claim queue — it used to sit under Business, which put "10 claims waiting"
     and "your claim was declined" in two different groups when both are the
     same screen's work. The icon is the nav's Time & Pay clock. */
  expenses: "Pay",
  timesheet: "Pay",
  claim: "Pay",
  /* Leave is the same screen's work as the two above it — a queue to decide
     and a decision that came back — so it files with them rather than under
     People, where the licence expiries live. */
  "leave-queue": "Pay",
  "leave-declined": "Pay",
};

export const GROUP_ICON: Record<ChipGroup, string> = {
  Fleet: "truck",
  People: "shield",
  Business: "hexagon",
  Pay: "clock",
};

export function chipGroup(kind: ChipKind): ChipGroup {
  return GROUP_OF[kind];
}

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

/* Every chip label is "<thing> <expiry clause>", from lib/format/duration —
   "Rego expires in 2 weeks", "White Card expired 4 days ago". Keeping it in one
   helper is what stops a rego chip and a licence chip wording the same fact two
   different ways when only one of them gets edited.

   These labels are PLAIN TEXT on purpose. They render as text nodes — in the
   hero's counters and on the action-required tiles — so a marked-up twin would
   arrive on screen as visible angle brackets rather than as markup. (That used
   to be enforced by hand-escaping into an HTML string; the hero is React now,
   so it is simply how React renders a string.) */
function expiryLabel(what: string, days: number): string {
  return `${what} ${expiryClause(days)}`;
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
    label: expiryLabel(lic.typeName, days),
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
   treats them.

   `vevoCheckedAt` is the column the forms write. It was `verifiedAt`, reading
   `work_rights_verified_at` — which nothing writes — so chip (2) stood
   permanently on everyone with a status recorded, and no action a person could
   take would clear it. See lib/staff/derive. */
export function workRightsChips(
  wr: {
    staffId: string;
    status: string | null;
    visaType: string | null;
    visaExpiry: string | null;
    vevoCheckedAt: string | null;
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
        label: expiryLabel(what, days),
        subject: ctx.subject,
        href: ctx.href,
        urgency: urgency(state, days),
      });
    }
  }

  /* Same exemption as deriveCompliance, and it has to be — Home and the bell
     count this rule for the same people the directory chip does, so the two
     disagreeing means one of them is telling somebody about a problem the other
     says they don't have. A citizen or permanent resident has no visa in the
     entitlement register, so there is no check to have done. */
  if (wr.status && !isNoVisa(wr.status) && !wr.vevoCheckedAt) {
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
  // no date entered, nothing to chase — see expiryState in fleet/logic.ts
  if (v.regoDays == null || v.regoDays > REGO_WARN_DAYS) return null;
  const state: ActionState = v.regoDays < 0 ? "bad" : "warn";
  return {
    key: `rego:${v.id}`,
    kind: "rego",
    state,
    label: expiryLabel("Rego", v.regoDays),
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
  if (v.insuranceDays == null || v.insuranceDays > INSURANCE_WARN_DAYS) return null;
  const state: ActionState = v.insuranceDays < 0 ? "bad" : "warn";
  return {
    key: `insurance:${v.id}`,
    kind: "insurance",
    state,
    label: expiryLabel("Insurance", v.insuranceDays),
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, v.insuranceDays),
  };
}

/* CTP expiry chip — the green slip, and its own chip rather than rego's.

   They usually fall on the same day, so folding the two would be right most of
   the time. But the green slip is what the rego renewal DEPENDS on: let it
   lapse and the rego cannot be renewed at all, and the chip that would have
   said so was the one we didn't send. */
export function ctpChip(
  v: Pick<VehicleWithFacts, "id" | "status" | "ctpDays">,
  ctx: { subject: string; href: string },
): ActionChip | null {
  if (v.status === "sold") return null;
  if (v.ctpDays == null || v.ctpDays > CTP_WARN_DAYS) return null;
  const state: ActionState = v.ctpDays < 0 ? "bad" : "warn";
  return {
    key: `ctp:${v.id}`,
    kind: "ctp",
    state,
    label: expiryLabel("Green slip", v.ctpDays),
    subject: ctx.subject,
    href: ctx.href,
    urgency: urgency(state, v.ctpDays),
  };
}

/** Service-due chip for a vehicle — distance or time, whichever arrives first. */
export function serviceChip(
  v: Pick<
    VehicleWithFacts,
    | "id"
    | "status"
    | "odometer"
    | "serviceIntervalKm"
    | "lastServiceOdo"
    | "serviceDays"
    | "motorised"
  >,
  ctx: { subject: string; href: string },
): ActionChip | null {
  if (v.status === "sold") return null;
  const due = serviceDue(v as VehicleWithFacts);
  if (due.state === "ok") return null;
  const state: ActionState = due.state === "bad" ? "bad" : "warn";
  /* Whichever limit is the reason gets to word the chip. A vehicle overdue on
     time and fine on distance must not be told it is overdue by kilometres. */
  const byKm = due.kmLeft != null && (due.kmLeft < 0 || due.kmLeft <= SERVICE_WARN_KM);
  const km = due.kmLeft ?? 0;
  const days = due.daysLeft ?? 0;
  return {
    key: `service:${v.id}`,
    kind: "service",
    state,
    label: byKm
      ? km < 0
        ? `Service overdue ${fmtKm(-km)} km`
        : `Service in ${fmtKm(km)} km`
      : days < 0
        ? `Service overdue ${agoLabel(days)}`
        : `Service ${inLabel(days)}`,
    subject: ctx.subject,
    href: ctx.href,
    // days-to-due either way: the km limit converts, the time limit already is
    urgency: urgency(state, byKm ? km / SERVICE_KM_PER_DAY : days),
  };
}

/* What to call a vehicle in a chip. `name` is optional in the register — plenty
   of vehicles are only ever known by their plate — so falling back keeps the
   chip from rendering with a blank subject and no way to tell which van it is. */
export function vehicleLabel(v: Pick<VehicleWithFacts, "name" | "plate">): string {
  return v.name?.trim() || v.plate?.trim() || "Unnamed vehicle";
}

/** All expiry/overdue chips for one vehicle, worst-first. */
export function vehicleChips(
  v: VehicleWithFacts,
  ctx: { subject: string; href: string },
): ActionChip[] {
  return sortChips(
    [regoChip(v, ctx), insuranceChip(v, ctx), ctpChip(v, ctx), serviceChip(v, ctx)].filter(
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
    label: expiryLabel("Public liability", days),
    subject: org.insurer?.trim() || "Public liability insurance",
    href: ctx.href,
    urgency: urgency(state, days),
  };
}

/** Expense claims waiting on a decision.

    Money in limbo is an action, not a fact — the audit found pending claims
    living only on a tile two screens deep, invisible from the dashboard's
    action rail. One chip for the queue, not one per claim: the decision
    surface is the expenses screen, and ten chips would say less than "10
    waiting" does. Always `warn` — a queue ages, it never "expires". */
export function expensesChip(pendingCount: number): ActionChip | null {
  if (pendingCount <= 0) return null;
  return {
    key: "expenses-pending",
    kind: "expenses",
    state: "warn",
    label:
      pendingCount === 1
        ? "1 expense claim waiting on a decision"
        : `${pendingCount} expense claims waiting on a decision`,
    subject: "Expenses",
    href: "/dashboard/timepay/expenses",
    urgency: urgency("warn", 0),
  };
}

/* ── things that happened TO you ──────────────────────────────────────────

   Every chip above is an expiry: a date the software can see coming. These two
   are the opposite — a decision somebody else made about your work, which the
   app previously told you nowhere at all. A timesheet came back with a question
   and a claim was declined, and the only way to find out was to open the screen
   and look. Both are yours (assembleChips files them under `self`, no
   capability), and both link to the screen where you answer them. */

/** Your own timesheet, handed back with a question on it.

    Always `bad`, never `warn`: there is no "getting close" for this — either an
    approver has asked you something or they haven't. It clears itself when you
    resubmit, because the status is the chip, so nothing has to be dismissed. */
export function timesheetChip(
  sheet: { status: string; periodStart: string; periodLabel: string } | null,
): ActionChip | null {
  if (!sheet || sheet.status !== "sent_back") return null;
  return {
    key: `timesheet:${sheet.periodStart}`,
    kind: "timesheet",
    state: "bad",
    label: "Timesheet sent back with a question",
    subject: sheet.periodLabel,
    // the period the question is about, not whichever one is current
    href: `/dashboard/my-timesheet?period=${sheet.periodStart}`,
    urgency: urgency("bad", 0),
  };
}

/** How long a declined claim keeps nudging. Unlike a sent-back timesheet, a
    declined claim has no state left to change — it stays declined forever — so
    without a window the chip would never clear and would teach people to read
    past the whole board. Two weeks is long enough to see it after a break. */
export const CLAIM_NUDGE_DAYS = 14;

/** A claim of yours that came back declined, while it is still news.

    One chip per claim rather than a queue count (the shape `expensesChip` uses):
    a queue is one job done ten times, but each declined claim is its own
    conversation with its own note, and the description is what tells you which
    receipt it was. */
export function declinedClaimChip(
  claim: { id: string; description: string; amount: number; decidedOn: string | null },
  ctx: { today: string },
): ActionChip | null {
  if (!claim.decidedOn) return null;
  // reviewed_at is a timestamp; the chip only cares which DAY it landed
  const days = daysUntil(claim.decidedOn.slice(0, 10), ctx.today);
  const age = -days; // 0 = decided today
  if (age > CLAIM_NUDGE_DAYS) return null;
  return {
    key: `claim-declined:${claim.id}`,
    kind: "claim",
    state: "bad",
    label: "Expense claim declined",
    subject: `${claim.description} · ${fmtMoney(claim.amount)}`,
    href: "/dashboard/my-expenses",
    // newest first within the bad bucket — the freshest decision is the one
    // you are most likely to still be able to do something about
    urgency: urgency("bad", age),
  };
}

/** Leave requests waiting on somebody to decide them.

    THE PRINCIPLE WAS ALREADY WRITTEN, one queue over: "a claim queue belongs
    to whoever can decide it, which is `approvals`, not `team`". That is just
    as true of leave, and this board carried the expense queue and not this
    one — so an approver's "everything waiting on you" told them about money
    and not about time, while the pending list sat two screens deep on the
    Leave tab.

    One chip for the queue, not one per request, for the same reason
    `expensesChip` gives: the decision surface is the leave screen, and ten
    chips would say less than "10 waiting" does. Always `warn` — a queue ages,
    it never expires. */
export function leaveQueueChip(pendingCount: number): ActionChip | null {
  if (pendingCount <= 0) return null;
  return {
    key: "leave-pending",
    kind: "leave-queue",
    state: "warn",
    label:
      pendingCount === 1
        ? "1 leave request waiting on a decision"
        : `${pendingCount} leave requests waiting on a decision`,
    subject: "Leave",
    href: "/dashboard/timepay/leave",
    urgency: urgency("warn", 0),
  };
}

/** A leave request of yours that came back declined, while it is still news.

    The gap this closes: a declined EXPENSE claim chipped you and a declined
    LEAVE request chipped nobody, though the two are the same shape — the
    expense_claims migration says so out loud, "deliberately the same one as
    leave_requests, because it is the same". The only way to learn your leave
    was refused was to open My leave and find it in the history list.

    Arguably the more urgent of the two, which is why it shares
    `CLAIM_NUDGE_DAYS` rather than a shorter window: money you are owed keeps;
    days you were counting on not working do not. Same reason for the window
    existing at all — a declined request has no state left to change, so
    without one the chip would never clear. */
export function declinedLeaveChip(
  request: { id: string; kind: string; startDate: string; endDate: string; decidedOn: string | null },
  ctx: { today: string },
): ActionChip | null {
  if (!request.decidedOn) return null;
  const age = -daysUntil(request.decidedOn.slice(0, 10), ctx.today);
  if (age > CLAIM_NUDGE_DAYS) return null;
  const span =
    request.startDate === request.endDate
      ? fmtAuDayMonth(request.startDate)
      : `${fmtAuDayMonth(request.startDate)} – ${fmtAuDayMonth(request.endDate)}`;
  return {
    key: `leave-declined:${request.id}`,
    kind: "leave-declined",
    state: "bad",
    label: "Leave request declined",
    subject: span,
    href: "/dashboard/my-leave",
    urgency: urgency("bad", age),
  };
}

/** Whole dollars where it divides evenly, cents where it doesn't — a chip is a
    glance, and "$340" reads faster than "$340.00" without ever being wrong. */
function fmtMoney(n: number): string {
  const cents = Math.round(n * 100) % 100;
  return `$${n.toLocaleString("en-AU", {
    minimumFractionDigits: cents === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/* The one-line version, for the hero tile. The dashboard shows the COUNT and
   links through to the full board — the same bargain the noticeboard makes, and
   for the same reason: a summary you click into is honest about being a summary,
   where a truncated list pretends to be the whole picture. */
export type ChipSummary = { total: number; bad: number; warn: number };

export function chipSummary(chips: readonly ActionChip[]): ChipSummary {
  let bad = 0;
  let warn = 0;
  for (const c of chips) {
    if (c.state === "bad") bad += 1;
    else warn += 1;
  }
  return { total: bad + warn, bad, warn };
}

/** "1 overdue · 2 due soon". Empty when all clear. */
export function summaryLine(s: ChipSummary): string {
  const parts: string[] = [];
  if (s.bad > 0) parts.push(`${s.bad} overdue`);
  if (s.warn > 0) parts.push(`${s.warn} due soon`);
  return parts.join(" · ");
}

/* `heroAction` lived here — the hero's action band, which named the worst item
   ("3 things need your attention · Rego expired 4 days ago · Hilux ute"). The
   hero now carries four counters instead, and the band under the greeting was
   saying the same thing twice, so it is gone. What it knew that a count does
   not — WHICH thing is worst — lives on the action-required board, which is
   where both urgent counters point. `chipSummary` above is the surviving
   tally, and the counters split it. */

/** Worst-first: bad before warn, then closest-to-now within a bucket. Stable. */
export function sortChips(chips: readonly ActionChip[]): ActionChip[] {
  return [...chips].sort((a, b) => a.urgency - b.urgency);
}
