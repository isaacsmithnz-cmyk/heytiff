"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { displayNameOf } from "@/lib/staff/name";
import { emailsByUser } from "@/lib/staff/query";
import { EMPLOYMENT_TYPES } from "@/lib/staff/employment";
import { getConnectionView } from "@/lib/integrations/store";
import {
  getOrdinaryPayLine,
  listEarningsRates,
  listPayCalendars,
  listPayrollEmployees,
} from "@/lib/integrations/xero-read";
import {
  isPlausibleHourly,
  resolveXeroPay,
  wageDrift,
  type WageDrift,
} from "@/lib/integrations/wage";
import {
  countLinksElsewhere,
  linkPayrollEmployee,
  listPayrollLinks,
  unlinkPayrollEmployee,
} from "@/lib/integrations/links";
import {
  buildLinkingRows,
  calendarAdvisory,
  unaccountedEmployees,
  type CalendarAdvisory,
  type LinkingRow,
  type LinkingStaff,
} from "@/lib/integrations/linking";
import { getPaySettings } from "@/lib/timepay/query";
import type { XeroEmployee } from "@/lib/integrations/xero-shape";

/* Linking HeyTiff staff to Xero payroll employees.

   `financials` on EVERY function, including the read. Two reasons, and the
   second is the real one: linking decides whose pay attaches to which payroll
   record, which is the same class of decision as setting a wage; and the drift
   this screen reports is drift in pay-adjacent fields. A Server Function is
   reachable by direct POST, so the gate is re-checked here rather than trusted
   from the settings modal that renders it.

   NOTHING HERE WRITES TO XERO. The only local write is a link row, plus the
   one deliberate adoption of an employment type — and that goes into the same
   column, under the same capability, that the staff card's payroll section
   already uses. Xero remains a thing we read.

   No org id is ever taken from the client: it comes from the session, so a
   call can only ever reach the caller's own workspace. */

export type LinkingData = {
  connected: boolean;
  tenantName: string | null;
  /** Rows for every active staff member, with link state and drift. */
  rows: LinkingRow[];
  /** People in Xero who aren't accounted for here. */
  unaccounted: XeroEmployee[];
  calendar: CalendarAdvisory | null;
  /** Links recorded against a DIFFERENT Xero organisation — so a tenant switch
      reads as "parked", not "lost". */
  elsewhere: number;
  /** Set when Xero couldn't be read; the section shows this instead of an
      empty roster, which would look like nobody is on payroll. */
  error: string | null;
};

const EMPTY: LinkingData = {
  connected: false,
  tenantName: null,
  rows: [],
  unaccounted: [],
  calendar: null,
  elsewhere: 0,
  error: null,
};

/** Active staff, with only what matching needs.

    Deliberately its own narrow select rather than a shared roster helper: the
    roster reads used elsewhere carry `hourly_wage`, and this payload crosses to
    a client component. Nothing that isn't needed to identify a person is here.
    (The money rule, lib/timepay/query.ts, applied by omission as usual.) */
async function linkingStaff(orgId: string): Promise<LinkingStaff[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, user_id, first_name, last_name, full_name, preferred_name, employment_type")
    .eq("org_id", orgId)
    .eq("status", "Active");

  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = rows.map((r) => r.user_id).filter((v): v is string => typeof v === "string");
  // Emails live on `profiles`, keyed by Auth0 sub — null until an invite is
  // accepted, which is the ordinary case for a card made ahead of onboarding.
  const emails = await emailsByUser(userIds);

  return rows.map((r) => {
    const first = (r.first_name as string | null) ?? null;
    const last = (r.last_name as string | null) ?? null;
    const full = (r.full_name as string | null) ?? null;
    return {
      staffProfileId: String(r.id),
      firstName: first,
      lastName: last,
      fullName: full,
      email: typeof r.user_id === "string" ? (emails.get(r.user_id) ?? null) : null,
      name: displayNameOf({
        first_name: first,
        last_name: last,
        full_name: full,
        preferred_name: (r.preferred_name as string | null) ?? null,
      }),
      employmentType: (r.employment_type as string | null) ?? null,
    };
  });
}

export async function getLinkingData(): Promise<LinkingData> {
  const { orgId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection || !connection.tenantId) return EMPTY;

  const tenantId = connection.tenantId;
  const base = { ...EMPTY, connected: true, tenantName: connection.tenantName };

  const [staff, employeesRead, links, elsewhere] = await Promise.all([
    linkingStaff(orgId),
    listPayrollEmployees(orgId),
    listPayrollLinks(orgId, tenantId),
    countLinksElsewhere(orgId, tenantId),
  ]);

  if (!employeesRead.ok) return { ...base, elsewhere, error: employeesRead.error };

  const employees = employeesRead.data;
  const rows = buildLinkingRows(staff, employees, links);

  /* Calendars are only worth a call once something is actually linked — the
     advisory compares LINKED people's calendars, so with no links there is
     nothing to say and no reason to spend a request. */
  let calendar: CalendarAdvisory | null = null;
  if (rows.some((r) => r.state.kind === "linked")) {
    const [calendars, pay] = await Promise.all([listPayCalendars(orgId), getPaySettings(orgId)]);
    if (calendars.ok) {
      calendar = calendarAdvisory(rows, employees, calendars.data, pay.settings.cycle);
    }
  }

  return {
    ...base,
    rows,
    unaccounted: unaccountedEmployees(rows, employees),
    calendar,
    elsewhere,
  };
}

export type LinkActionResult = { ok: true } | { ok: false; error: string };

function refresh() {
  revalidatePath("/dashboard/timepay");
  revalidatePath("/dashboard/admin/integrations/xero");
}

/** Confirm one person ↔ one Xero employee.

    `matchedBy` records provenance, not confidence: 'auto' means a human
    accepted a suggestion, 'manual' means they picked from the list. Both are
    human decisions — nothing in this codebase links anybody on its own. */
export async function linkEmployee(
  staffProfileId: string,
  remoteId: string,
  matchedBy: "auto" | "manual"
): Promise<LinkActionResult> {
  const { orgId, userId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection?.tenantId) return { ok: false, error: "Xero isn't connected." };

  /* Both ids arrive from a browser, so both are checked against what actually
     exists rather than trusted. The employee list is re-read for that: an id
     that isn't in the connected tenant's payroll right now names nothing we
     could ever sync, and a staff id outside this org must not resolve at all.
     (Same posture as setXeroTenant — an id from a client names a CHOICE, not a
     target.) */
  const [employees, staffCheck] = await Promise.all([
    listPayrollEmployees(orgId),
    supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", staffProfileId)
      .maybeSingle(),
  ]);

  if (!staffCheck.data) return { ok: false, error: "That person isn't in this workspace." };
  if (!employees.ok) return { ok: false, error: employees.error };

  const employee = employees.data.find((e) => e.employeeId === remoteId);
  if (!employee) return { ok: false, error: "That employee isn't in the connected Xero organisation." };

  const result = await linkPayrollEmployee({
    orgId,
    tenantId: connection.tenantId,
    staffProfileId,
    remoteId,
    remoteLabel: employee.name,
    matchedBy,
    userId,
  });
  if (!result.ok) return result;

  refresh();
  return { ok: true };
}

export async function unlinkEmployee(staffProfileId: string): Promise<LinkActionResult> {
  const { orgId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection?.tenantId) return { ok: false, error: "Xero isn't connected." };

  const result = await unlinkPayrollEmployee(orgId, connection.tenantId, staffProfileId);
  if (!result.ok) return result;

  refresh();
  return { ok: true };
}

/* ── pay rates ────────────────────────────────────────────────────────────

   ON DEMAND, AND ITS OWN ACTION, for two separate reasons.

   COST: reading a pay rate is one Xero call PER PERSON, where every other read
   here is one per organisation. Xero allows 60 a minute per tenant and 1,000 a
   day on the starter tier. Doing this on every open of the settings modal
   would spend somebody's quota on a screen they came to for break rules, so it
   runs only when asked, for LINKED staff only, and the screen says how many
   calls it will make first.

   MONEY: keeping it out of getLinkingData means the default payload for this
   screen contains no wages at all. The capability gate is the guarantee; not
   sending the data unless it was asked for is the belt. */

export type WagePayRow = {
  staffProfileId: string;
  /** null when this workspace has no wage recorded for them. */
  here: number | null;
  drift: WageDrift;
};

export type PayRatesResult =
  | { ok: true; rows: WagePayRow[] }
  | { ok: false; error: string };

export async function checkPayRates(): Promise<PayRatesResult> {
  const { orgId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection?.tenantId) return { ok: false, error: "Xero isn't connected." };

  const links = await listPayrollLinks(orgId, connection.tenantId);
  if (links.length === 0) return { ok: true, rows: [] };

  /* THE ONE PLACE IN THIS MODULE THAT READS A WAGE. Scoped to the org and to
     the people who are actually linked, behind the `financials` gate above. */
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, hourly_wage")
    .eq("org_id", orgId)
    .in("id", links.map((l) => l.staffProfileId));

  const wageHere = new Map<string, number | null>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const raw = r.hourly_wage;
    wageHere.set(String(r.id), typeof raw === "number" ? raw : raw ? Number(raw) : null);
  }

  // One call for the whole org, before any per-person call — it resolves the
  // USEEARNINGSRATE case, where the rate lives on the org, not the employee.
  const rates = await listEarningsRates(orgId);
  const earningsRates = rates.ok ? rates.data : [];

  const rows: WagePayRow[] = [];
  for (const link of links) {
    const line = await getOrdinaryPayLine(orgId, link.remoteId);
    // One person's read failing shouldn't lose everybody else's answer.
    const pay = line.ok ? resolveXeroPay(line.data, earningsRates) : ({ kind: "unknown" } as const);
    const here = wageHere.get(link.staffProfileId) ?? null;
    rows.push({ staffProfileId: link.staffProfileId, here, drift: wageDrift(here, pay) });
  }

  return { ok: true, rows };
}

/** Take Xero's hourly rate as this workspace's wage.

    Writes `staff_profiles.hourly_wage` — the same column, under the same
    `financials` capability, that the staff card's payroll section already
    writes. The rate is re-derived from Xero here rather than trusted from the
    client: the browser is telling us WHICH person to update, not what they
    earn. */
export async function adoptWage(staffProfileId: string): Promise<LinkActionResult> {
  const { orgId } = await requireOrg("financials");

  const connection = await getConnectionView(orgId, "xero");
  if (!connection?.tenantId) return { ok: false, error: "Xero isn't connected." };

  const links = await listPayrollLinks(orgId, connection.tenantId);
  const link = links.find((l) => l.staffProfileId === staffProfileId);
  if (!link) return { ok: false, error: "They aren't matched to a Xero employee." };

  const [line, rates] = await Promise.all([
    getOrdinaryPayLine(orgId, link.remoteId),
    listEarningsRates(orgId),
  ]);
  if (!line.ok) return { ok: false, error: line.error };

  const pay = resolveXeroPay(line.data, rates.ok ? rates.data : []);
  if (pay.kind !== "hourly") {
    // The salary case lands here, and stays a refusal: converting a salary to
    // an hourly rate needs an hours-per-year assumption the Rate Calculator
    // already makes differently (working_weeks, 46 not 52).
    return { ok: false, error: "Xero doesn't have an hourly rate for them." };
  }
  if (!isPlausibleHourly(pay.rate)) {
    return { ok: false, error: "That rate doesn't look right — set it on their staff card instead." };
  }

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ hourly_wage: pay.rate })
    .eq("org_id", orgId)
    .eq("id", staffProfileId);

  if (error) return { ok: false, error: "Couldn't save that." };

  refresh();
  // Every charge-out rate is derived from this column.
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/admin/rate-calculator");
  return { ok: true };
}

/** Take Xero's word for someone's employment type — the ONE place this screen
    writes a HeyTiff field.

    It writes `staff_profiles.employment_type`, the same column the staff card's
    payroll section writes under the same `financials` capability, so this is a
    shortcut to an existing decision rather than a second way in. The value is
    validated against the roster's own vocabulary, never passed through from
    Xero: their labels are theirs, and `classifyEmployment` must keep seeing
    strings it recognises. */
export async function adoptEmploymentType(
  staffProfileId: string,
  value: string
): Promise<LinkActionResult> {
  const { orgId } = await requireOrg("financials");

  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(value)) {
    return { ok: false, error: "That isn't an employment type." };
  }

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({ employment_type: value })
    .eq("org_id", orgId)
    .eq("id", staffProfileId);

  if (error) return { ok: false, error: "Couldn't save that." };

  refresh();
  // The staff card and every timesheet presumption read this column.
  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/my-timesheet");
  return { ok: true };
}
