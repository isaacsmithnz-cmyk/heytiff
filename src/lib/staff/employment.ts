/* What kind of employee somebody is — the one definition.

   `staff_profiles.employment_type` is the field, and its vocabulary comes from
   the roster: Full-time · Part-time · Casual · Apprentice · Subcontractor. It
   was already read by the Rate Calculator, which owned both the list and the
   classifier; Time & Pay now needs the same answer to decide whose week gets
   filled in for them. Two modules string-matching "casual" independently is
   how one screen ends up presuming a week the other says is manual, so the
   definition moved here and both import it.

   NOTHING outside this module may match on the raw label. Classify, then
   branch — a hyphen, a space or a new label added to the profile dropdown must
   not silently reclassify a person's pay or their timesheet. */

export type EmploymentType =
  | "Full-time"
  | "Part-time"
  | "Casual"
  | "Apprentice"
  | "Subcontractor";

/** The dropdown, in the order it reads on a profile. */
export const EMPLOYMENT_TYPES: readonly EmploymentType[] = [
  "Full-time",
  "Part-time",
  "Casual",
  "Apprentice",
  "Subcontractor",
] as const;

/** How pay burden actually differs. Everything either module needs to know
    about an employment type collapses to one of these three. */
export type EmploymentClass = "subbie" | "casual" | "permanent";

/** Map any employment label to its class, tolerant of spelling. Normalises
    case and every kind of separator, so "Full Time", "full-time" and "Full
    time" all land the same place.
      subbie    — invoices for work; no super, no workers comp, no leave
      casual    — paid weeks worked only; loading is in the wage, no leave loading
      permanent — full/part-time AND APPRENTICES: 52 paid weeks, super + leave
    Apprentices are employees, so they are permanent — the one label people
    most expect to be "special" but which the burden model treats as ordinary.

    UNSET CLASSIFIES AS PERMANENT, and that is load-bearing rather than lazy:
    the column is nullable and is null for most rows, so the fallback is what
    nearly every workspace actually gets. Permanent is the safe end — it fills
    a week in and shows it to the person before anything is submitted, where
    defaulting to casual would quietly stop filling in the weeks of people who
    never told us what they are. */
export function classifyEmployment(raw?: string | null): EmploymentClass {
  const v = (raw ?? "").toLowerCase().replace(/[\s._-]+/g, "");
  if (v === "subcontractor" || v === "subcontract" || v === "contractor") return "subbie";
  if (v === "casual") return "casual";
  return "permanent"; // full-time, part-time, apprentice, or unspecified
}

/** Whose week gets filled in for them.

    A casual has no normal week to presume — they work when they're rostered,
    so every day starts empty and is entered by hand. Presuming a casual's
    Tuesday would invent hours nobody agreed to, and flagging their empty
    Tuesday as "missing" would chase them for a day they were never on. */
export function presumesDays(cls: EmploymentClass): boolean {
  return cls === "permanent";
}
