/* Assembling the linking screen — pure, so every rule about what a row SAYS is
   testable without a grant or a database.

   This module is where the source-of-truth doctrine becomes something a person
   can read. Its whole job is to put the two systems side by side and describe
   the difference; it never decides that a difference should be resolved, and
   it never produces a write. Adoption is a separate, deliberate act through the
   field's own gated action.

   THE DRIFT RULE, restated: HeyTiff owns employment type and the pay cycle.
   Xero's answers are shown as suggestions and advisories with the reason
   attached, and nothing here writes either. A screen that silently reconciled
   would be the exact "two systems fighting" this design exists to prevent —
   the fight just wouldn't be visible until payroll was wrong. */

import { classifyEmployment, type EmploymentType, type PayBasis } from "@/lib/staff/employment";
import type { XeroEmployee, XeroPayCalendar } from "./xero-shape";
import type { IntegrationLink } from "./links";
import { suggestMatches, type StaffCandidate } from "./match";
import type { WageDrift } from "./wage";

/** One person's employment facts, as the linking screen needs them. Wages are
    deliberately absent: this payload crosses to a client component, and a
    matcher that can see a rate is a matcher that can leak one. */
export type LinkingStaff = StaffCandidate & {
  /** Display name, already resolved by the caller. */
  name: string;
  /** The raw label from staff_profiles — nullable, and null for most rows. */
  employmentType: string | null;
  /** How HeyTiff computes their pay — hourly unless someone said otherwise. */
  payBasis: PayBasis;
};

export type LinkState =
  /** Linked, and the employee is present and current in Xero. */
  | { kind: "linked"; employee: XeroEmployee; matchedBy: "auto" | "manual" }
  /** Linked to someone Xero now says has left — the link is still right, the
      person isn't on payroll any more. Needs a human, not a silent unlink. */
  | { kind: "linked_left"; employee: XeroEmployee; matchedBy: "auto" | "manual" }
  /** Linked to an id Xero no longer returns at all — deleted, or the tenant
      changed underneath. Shows the label captured at link time so the row can
      still say who it meant. */
  | { kind: "linked_missing"; remoteLabel: string | null }
  /** Not linked; one confident candidate to offer. */
  | { kind: "suggested"; employee: XeroEmployee; reason: "email" | "name" }
  /** Not linked; more than one equally-good match, so we offer none. */
  | { kind: "ambiguous" }
  /** Not linked, nothing plausible. */
  | { kind: "unmatched" };

/** What Xero implies about someone's employment type, when it implies anything.

    The payroll LIST only carries EMPLOYEE vs CONTRACTOR. That is enough for the
    one distinction HeyTiff actually branches on — `classifyEmployment` collapses
    everything to subbie / casual / permanent — but it cannot tell full-time from
    part-time from casual, and this deliberately doesn't pretend otherwise. The
    finer split lives on the per-employee detail call and is left for when
    something needs it. */
export type EmploymentDrift =
  /** Xero has them as a contractor; here they're not a subcontractor. */
  | { kind: "suggest_subbie"; suggested: EmploymentType }
  /** Xero has them on payroll as an employee; here they're a subcontractor.
      A real contradiction — a subbie invoices, they don't get payslips. */
  | { kind: "contradiction"; note: string }
  | null;

export type LinkingRow = {
  staffProfileId: string;
  name: string;
  employmentType: string | null;
  payBasis: PayBasis;
  state: LinkState;
  employment: EmploymentDrift;
};

/* ── pay basis ──

   Xero already knows who is on a salary: an ANNUALSALARY pay template is
   exactly that statement, and `resolveXeroPay` has resolved it by the time a
   wage drift exists. So the suggestion is free — and it is only ever a
   suggestion, the same doctrine as employment type: HeyTiff owns pay_basis,
   because it decides what a person's own timesheet asks them for. */
export type BasisDrift =
  /** Xero pays them a salary; here they're marked hourly. */
  | { kind: "suggest_salary" }
  /** Here they're salaried, but Xero pays an hourly rate off a template — a
      real contradiction, and neither side is obviously the wrong one. */
  | { kind: "contradiction"; note: string }
  | null;

/** What Xero's pay shape says about the basis, if anything.

    Reads the WAGE drift rather than the employee list, because the employee
    list can't tell salary from hourly — only the pay template can, and that
    is the per-person read behind "Check pay rates". */
export function payBasisDrift(here: PayBasis, drift: WageDrift | null): BasisDrift {
  if (!drift) return null;

  // Xero states a salary: either converted (basis carries the working) or
  // unconvertible for want of stated weekly hours.
  const xeroSalary =
    drift.kind === "salary" ||
    ((drift.kind === "differs" || drift.kind === "match") && drift.basis !== undefined);

  if (xeroSalary && here !== "salary") return { kind: "suggest_salary" };

  // An hourly rate on the template, with no salary behind it.
  const xeroHourly =
    (drift.kind === "differs" || drift.kind === "match") && drift.basis === undefined;

  if (xeroHourly && here === "salary") {
    return {
      kind: "contradiction",
      note: "Xero pays them an hourly rate, but they're marked salaried here.",
    };
  }
  return null;
}

/* ── employment drift ── */

export function employmentDrift(
  employmentType: string | null,
  employee: XeroEmployee | null
): EmploymentDrift {
  if (!employee || !employee.employmentType) return null;
  const here = classifyEmployment(employmentType);

  if (employee.employmentType === "CONTRACTOR" && here !== "subbie") {
    return { kind: "suggest_subbie", suggested: "Subcontractor" };
  }
  if (employee.employmentType === "EMPLOYEE" && here === "subbie") {
    return {
      kind: "contradiction",
      note: "Xero pays them as an employee, but they're a subcontractor here.",
    };
  }
  return null;
}

/* ── the rows ── */

/** Build every staff row, with its link state and any drift.

    Suggestions come from the shared matcher, which resolves email across the
    whole roster before any name match — see match.ts for why the order is
    load-bearing. */
export function buildLinkingRows(
  staff: LinkingStaff[],
  employees: XeroEmployee[],
  links: IntegrationLink[]
): LinkingRow[] {
  const byRemote = new Map(employees.map((e) => [e.employeeId, e]));
  const linkByStaff = new Map(links.map((l) => [l.staffProfileId, l]));

  // Suggestions are only sought for people who aren't linked already, and can
  // never offer an employee some existing link already claims. The matcher is
  // provider-neutral, so employees are reduced to its RemoteCandidate shape
  // at this boundary.
  const claimed = new Set(links.map((l) => l.remoteId));
  const unlinked = staff.filter((s) => !linkByStaff.has(s.staffProfileId));
  const { suggestions, ambiguous } = suggestMatches(
    unlinked,
    employees.map((e) => ({ id: e.employeeId, name: e.name, email: e.email })),
    claimed
  );

  const suggestionByStaff = new Map(suggestions.map((s) => [s.staffProfileId, s]));
  const ambiguousSet = new Set(ambiguous);

  return staff.map((s) => {
    const link = linkByStaff.get(s.staffProfileId);

    let state: LinkState;
    let employee: XeroEmployee | null = null;

    if (link) {
      const found = byRemote.get(link.remoteId);
      if (!found) {
        state = { kind: "linked_missing", remoteLabel: link.remoteLabel };
      } else {
        employee = found;
        state = found.active
          ? { kind: "linked", employee: found, matchedBy: link.matchedBy }
          : { kind: "linked_left", employee: found, matchedBy: link.matchedBy };
      }
    } else {
      const suggestion = suggestionByStaff.get(s.staffProfileId);
      if (suggestion) {
        const found = byRemote.get(suggestion.remoteId)!;
        state = { kind: "suggested", employee: found, reason: suggestion.reason };
      } else if (ambiguousSet.has(s.staffProfileId)) {
        state = { kind: "ambiguous" };
      } else {
        state = { kind: "unmatched" };
      }
    }

    return {
      staffProfileId: s.staffProfileId,
      name: s.name,
      employmentType: s.employmentType,
      payBasis: s.payBasis,
      state,
      // Drift is only meaningful against a CONFIRMED link. Reading it off a
      // suggestion would put a "change their employment type" prompt next to a
      // match nobody has agreed to yet.
      employment:
        state.kind === "linked" || state.kind === "linked_left"
          ? employmentDrift(s.employmentType, employee)
          : null,
    };
  });
}

/* ── pay-calendar advisory ── */

/** Xero's calendar vocabulary → the `pay_settings.cycle` vocabulary, for
    comparison only. Anything else (twice-monthly, four-weekly) has no HeyTiff
    equivalent and returns null rather than being forced into one. */
export function cycleOfCalendar(calendarType: string | null): string | null {
  switch ((calendarType ?? "").toUpperCase()) {
    case "WEEKLY":
      return "Weekly";
    case "FORTNIGHTLY":
      return "Fortnightly";
    case "MONTHLY":
      return "Monthly";
    default:
      return null;
  }
}

export type CalendarAdvisory = {
  /** The distinct HeyTiff-equivalent cycles the linked people sit on in Xero. */
  xeroCycles: string[];
  /** True when Xero disagrees with pay_settings for at least one linked person. */
  differs: boolean;
  note: string | null;
};

/** Compare the pay cycles of LINKED people against this workspace's setting.

    Advisory in the strongest sense: `pay_settings` is the system of record for
    how this business pays, and a business legitimately running Xero on a
    different calendar is not an error to correct. The line exists so nobody
    discovers the mismatch by way of a wrong pay run. */
export function calendarAdvisory(
  rows: LinkingRow[],
  employees: XeroEmployee[],
  calendars: XeroPayCalendar[],
  cycle: string
): CalendarAdvisory {
  const calendarById = new Map(calendars.map((c) => [c.payrollCalendarId, c]));
  const byRemote = new Map(employees.map((e) => [e.employeeId, e]));

  const cycles = new Set<string>();
  for (const row of rows) {
    if (row.state.kind !== "linked") continue;
    const emp = byRemote.get(row.state.employee.employeeId);
    const calendar = emp?.payrollCalendarId ? calendarById.get(emp.payrollCalendarId) : null;
    const mapped = cycleOfCalendar(calendar?.calendarType ?? null);
    if (mapped) cycles.add(mapped);
  }

  const xeroCycles = [...cycles].sort();
  const differs = xeroCycles.some((c) => c !== cycle);
  if (!differs) return { xeroCycles, differs: false, note: null };

  const list = xeroCycles.join(" and ");
  return {
    xeroCycles,
    differs: true,
    note: `Xero pays these people ${list}; this workspace is set to ${cycle}. Nothing has been changed — check which is right.`,
  };
}

/** Xero employees no row here accounts for. Excludes anyone already linked or
    currently being suggested, so the list is genuinely "people in Xero who
    aren't in this workspace". */
export function unaccountedEmployees(
  rows: LinkingRow[],
  employees: XeroEmployee[]
): XeroEmployee[] {
  const spokenFor = new Set<string>();
  for (const row of rows) {
    const s = row.state;
    if (s.kind === "linked" || s.kind === "linked_left" || s.kind === "suggested") {
      spokenFor.add(s.employee.employeeId);
    }
  }
  return employees.filter((e) => e.active && !spokenFor.has(e.employeeId));
}
