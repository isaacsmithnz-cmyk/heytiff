/* Turning Xero's responses into our own shapes — pure, so it can be tested
   without a network or a grant.

   This module exists because the SDK's models are generated, optional almost
   everywhere, and carry far more than we want anywhere near a screen. An
   employee record includes a home address, a date of birth, bank accounts and
   super memberships; what the linking screen needs is a name, an id and whether
   they still work there. Shaping at the boundary means none of the rest is ever
   in a payload to leak.

   Nothing here throws. A record we can't identify is dropped rather than
   half-built — a row in the picker that can't be linked is worse than no row. */

/** A Xero payroll employee, as the linking screen sees them. */
export type XeroEmployee = {
  employeeId: string;
  firstName: string;
  lastName: string;
  /** Display name, already joined — the screens never re-derive this. */
  name: string;
  /** Xero has it or it doesn't; absence is normal and is not an error. */
  email: string | null;
  jobTitle: string | null;
  /** False once Xero says TERMINATED — a linked one of these needs attention. */
  active: boolean;
  /** EMPLOYEE | CONTRACTOR, when Xero says. Advisory input to employment_type. */
  employmentType: "EMPLOYEE" | "CONTRACTOR" | null;
  /** Which Xero pay calendar they sit on — advisory against pay_settings. */
  payrollCalendarId: string | null;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const orNull = (v: unknown): string | null => str(v) || null;

/* Compared as STRINGS, not against the SDK's enum objects. The wire format is
   'ACTIVE' / 'TERMINATED' either way, and going through the enum would couple
   our shaping to an SDK export that a major version could rename. */
const TERMINATED = "TERMINATED";
const CONTRACTOR = "CONTRACTOR";
const EMPLOYEE = "EMPLOYEE";

/** One employee record → our shape, or null if it can't be identified.

    An employee with no id can never be linked to (there'd be nothing to store
    in `remote_id`), and one with no name at all can't be shown in a picker.
    Both are dropped rather than rendered as an unusable row. */
export function shapeEmployee(raw: unknown): XeroEmployee | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const employeeId = str(r.employeeID);
  if (!employeeId) return null;

  const firstName = str(r.firstName);
  const lastName = str(r.lastName);
  const name = [firstName, lastName].filter(Boolean).join(" ");
  if (!name) return null;

  const rawType = str(r.employmentType).toUpperCase();

  return {
    employeeId,
    firstName,
    lastName,
    name,
    email: orNull(r.email),
    jobTitle: orNull(r.jobTitle),
    // Absent status means active: Xero omits the field on organisations that
    // have never terminated anyone, and defaulting the other way would show a
    // whole healthy payroll as gone.
    active: str(r.status).toUpperCase() !== TERMINATED,
    employmentType:
      rawType === CONTRACTOR ? "CONTRACTOR" : rawType === EMPLOYEE ? "EMPLOYEE" : null,
    payrollCalendarId: orNull(r.payrollCalendarID),
  };
}

/** A page of employees → our shapes, junk dropped. */
export function shapeEmployees(raw: unknown): XeroEmployee[] {
  if (!Array.isArray(raw)) return [];
  const out: XeroEmployee[] = [];
  for (const e of raw) {
    const shaped = shapeEmployee(e);
    if (shaped) out.push(shaped);
  }
  return out;
}

/** A Xero pay calendar — enough to compare against `pay_settings.cycle`. */
export type XeroPayCalendar = {
  payrollCalendarId: string;
  name: string;
  /** WEEKLY | FORTNIGHTLY | MONTHLY | … verbatim from Xero, uppercased. */
  calendarType: string | null;
};

export function shapeCalendars(raw: unknown): XeroPayCalendar[] {
  if (!Array.isArray(raw)) return [];
  const out: XeroPayCalendar[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const r = c as Record<string, unknown>;
    const payrollCalendarId = str(r.payrollCalendarID);
    if (!payrollCalendarId) continue;
    out.push({
      payrollCalendarId,
      name: str(r.name) || payrollCalendarId,
      calendarType: orNull(r.calendarType)?.toUpperCase() ?? null,
    });
  }
  return out;
}
