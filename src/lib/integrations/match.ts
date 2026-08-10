/* Suggesting which Xero employee is which HeyTiff staff member — pure, so the
   rules are testable and identical everywhere.

   THIS MODULE ONLY EVER SUGGESTS. Nothing here writes a link. A suggestion is
   rendered next to a person with the reason it was made, and someone who knows
   the team presses the button — because the cost of an automatic wrong answer
   is a person's pay attached to a stranger's record, and no confidence score is
   worth that. `matched_by` records that provenance: 'auto' means a human
   accepted a suggestion, not that the machine decided alone.

   TWO SIGNALS, IN ORDER:

   EMAIL is near-proof, and it is deliberately the first thing tried. Note
   where the address comes from: once someone has signed in it lives on
   `profiles`, keyed by the Auth0 sub through staff_profiles.user_id; before
   that, a card imported or pre-seeded ahead of onboarding may carry
   staff_profiles.contact_email, and callers feed whichever exists. A card
   with neither is still ordinary, not a fault, and it must degrade to the
   name pass rather than look broken.

   NAME is a hint, never proof. Two Daniels on a crew of nine is not unusual,
   which is why an ambiguous name match is reported as AMBIGUOUS and offers
   nothing — showing one of two equally-good matches is how the wrong person
   gets linked by someone clicking through. */

import type { XeroEmployee } from "./xero-shape";

/** The HeyTiff side of the comparison. Deliberately tiny: a matcher that can
    see wages is a matcher that can leak them into a suggestion payload. */
export type StaffCandidate = {
  staffProfileId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Account email (profiles join) or, for a card that predates its person,
      the contact_email it was seeded with. Null when neither exists. */
  email: string | null;
};

export type SuggestionReason = "email" | "name";

export type Suggestion = {
  staffProfileId: string;
  employeeId: string;
  reason: SuggestionReason;
};

export type MatchOutcome =
  /** One confident candidate. */
  | { kind: "suggested"; employeeId: string; reason: SuggestionReason }
  /** More than one equally-good name match — we show none and say why. */
  | { kind: "ambiguous"; employeeIds: string[] }
  /** Nothing plausible. */
  | { kind: "none" };

/* ── normalisation ── */

/** Case and whitespace only. Emails are compared as the identifiers they are —
    no dot-stripping or plus-tag removal, because those rules are provider-
    specific folklore and getting them wrong invents a match. */
export function normEmail(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/** Names are compared with punctuation and spacing flattened, so "O'Brien",
    "obrien" and "O Brien" agree, and accents fold to their base letters so
    "Renée" matches "Renee" — a real case when one system was typed on a phone.
    Order is normalised too: `full_name` here is derived as "first last", but a
    Xero record typed by hand can be either way round. */
export function normName(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // the combining marks NFD just split out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A name reduced to its sorted parts, so "Dan Smith" and "Smith Dan" are the
    same key. Returns "" when there is nothing to compare — and an empty key
    must never match another empty key. */
export function nameKey(v: string | null | undefined): string {
  const parts = normName(v).split(" ").filter(Boolean);
  return parts.length ? parts.sort().join(" ") : "";
}

/** The staff member's name, however much of it exists. Prefers the two halves
    over `full_name`, since full_name is DERIVED from them and can lag a rename
    that only touched one field. */
export function staffName(s: StaffCandidate): string {
  const halves = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
  return halves || (s.fullName ?? "").trim();
}

/* ── matching ── */

/** Find the best match for ONE staff member among the employees still free.

    `taken` is the set of employee ids already linked or already suggested to
    someone else — passed in rather than derived here so the caller controls
    the order, and so one Xero employee can never be offered to two people. */
export function matchOne(
  staff: StaffCandidate,
  employees: XeroEmployee[],
  taken: ReadonlySet<string>
): MatchOutcome {
  const free = employees.filter((e) => !taken.has(e.employeeId));

  // Email first: near-proof, and it beats an ambiguous name outright.
  const email = normEmail(staff.email);
  if (email) {
    const hits = free.filter((e) => normEmail(e.email) === email);
    if (hits.length === 1) return { kind: "suggested", employeeId: hits[0].employeeId, reason: "email" };
    // Two Xero employees sharing an address is a data problem over there, not
    // something to resolve by guessing.
    if (hits.length > 1) return { kind: "ambiguous", employeeIds: hits.map((e) => e.employeeId) };
  }

  const key = nameKey(staffName(staff));
  if (!key) return { kind: "none" };

  const hits = free.filter((e) => nameKey(e.name) === key);
  if (hits.length === 1) return { kind: "suggested", employeeId: hits[0].employeeId, reason: "name" };
  if (hits.length > 1) return { kind: "ambiguous", employeeIds: hits.map((e) => e.employeeId) };
  return { kind: "none" };
}

/** Suggestions for a whole roster.

    EMAIL MATCHES ARE RESOLVED FIRST, ACROSS EVERYONE, before any name match is
    considered. Otherwise the order staff happen to come back in decides the
    outcome: a weak name match for the first person could consume the employee
    that the third person matches by email — and the strong evidence would lose
    to the weak one purely by accident of sorting.

    `alreadyLinked` holds employee ids that existing links already claim, so a
    saved decision is never re-offered elsewhere. */
export function suggestMatches(
  staff: StaffCandidate[],
  employees: XeroEmployee[],
  alreadyLinked: ReadonlySet<string> = new Set()
): { suggestions: Suggestion[]; ambiguous: string[] } {
  const taken = new Set(alreadyLinked);
  const suggestions: Suggestion[] = [];
  const ambiguous: string[] = [];
  const settled = new Set<string>();

  // Pass 1 — email only.
  for (const s of staff) {
    if (!normEmail(s.email)) continue;
    const out = matchOne(s, employees, taken);
    if (out.kind === "suggested" && out.reason === "email") {
      suggestions.push({ staffProfileId: s.staffProfileId, employeeId: out.employeeId, reason: "email" });
      taken.add(out.employeeId);
      settled.add(s.staffProfileId);
    } else if (out.kind === "ambiguous") {
      ambiguous.push(s.staffProfileId);
      settled.add(s.staffProfileId);
    }
  }

  // Pass 2 — names, over whoever and whatever is left.
  for (const s of staff) {
    if (settled.has(s.staffProfileId)) continue;
    const out = matchOne(s, employees, taken);
    if (out.kind === "suggested") {
      suggestions.push({ staffProfileId: s.staffProfileId, employeeId: out.employeeId, reason: out.reason });
      taken.add(out.employeeId);
    } else if (out.kind === "ambiguous") {
      ambiguous.push(s.staffProfileId);
    }
  }

  return { suggestions, ambiguous };
}

/** Xero employees nobody here corresponds to — the "in Xero, not in HeyTiff"
    list. Terminated ones are dropped: a leaver who was never linked is noise,
    and hiding them keeps the list to people someone might actually need to add. */
export function unmatchedEmployees(
  employees: XeroEmployee[],
  linkedOrSuggested: ReadonlySet<string>
): XeroEmployee[] {
  return employees.filter((e) => e.active && !linkedOrSuggested.has(e.employeeId));
}
