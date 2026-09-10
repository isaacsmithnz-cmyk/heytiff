import { daysUntil, parseAuDate } from "@/lib/au-dates";
import { expiresIn } from "@/lib/format/duration";

/* Pure rules for a staff licence — validation of what goes IN, and the status
   label that comes OUT. Kept out of the server action (which only does I/O) and
   out of the render (which only does markup) so both agree on the same rules
   and both are testable without a database or a DOM.

   A licence is a row in `staff_licences`, not a column, so it never rides the
   flat section-save; the actions in app/actions/{profile,staff} call these. */

/* The tickets worth NAMING — the handful nearly every trades business holds,
   so they arrive spelled and coloured consistently instead of as four
   spellings of "ARC". Everything else is free text: this is a set of
   suggestions and a badge lookup, never an allowlist.

   It lived in components/profile/compliance-card.tsx until the licence modal
   needed it too. A list of domain facts is not a component's to own. */
export type LicType = { name: string; sub?: string; color?: string };

export const LIC_TYPES: readonly LicType[] = [
  { name: "Driver’s licence", sub: "State driver licence", color: "#2E68FF" },
  { name: "ARC licence", sub: "Refrigerant handling", color: "#00A389" },
  { name: "White card", sub: "Construction induction", color: "#8A2BE2" },
  { name: "Contractor licence", sub: "Trade contractor", color: "#F0A431" },
];

/** The colour a newly-picked type suggests, or "" for a custom one. */
export function defaultLicenceColor(typeName: string): string {
  const wanted = typeName.trim().toLowerCase();
  return LIC_TYPES.find((t) => t.name.toLowerCase() === wanted)?.color ?? "";
}

export type LicenceInput = {
  typeName: string;
  licenceNumber?: string;
  /** dd/mm/yyyy from the form, or blank for a licence with no expiry. */
  expiryDate?: string;
  /** cosmetic accent from the picker; validated to a hex, else dropped. */
  color?: string;
};

export type LicenceRow = {
  type_name: string;
  licence_number: string | null;
  expiry_date: string | null;
  color: string | null;
};

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** Validate + normalise a licence for insert, or return why it can't be saved. */
export function buildLicenceRow(input: LicenceInput): { row: LicenceRow } | { error: string } {
  const typeName = (input.typeName ?? "").trim();
  if (!typeName) return { error: "Choose a licence type, or name a custom one." };

  let expiry: string | null = null;
  const rawExpiry = (input.expiryDate ?? "").trim();
  if (rawExpiry) {
    const iso = parseAuDate(rawExpiry);
    if (!iso) return { error: "Check the expiry date — use dd/mm/yyyy." };
    expiry = iso;
  }

  const number = (input.licenceNumber ?? "").trim();
  const color = (input.color ?? "").trim();

  return {
    row: {
      type_name: typeName.slice(0, 120),
      licence_number: number ? number.slice(0, 80) : null,
      expiry_date: expiry,
      color: HEX.test(color) ? color : null,
    },
  };
}

/* The 2–4 letter stamp on a credential card.

   Known types get the abbreviation a tradesperson would actually say ("ARC",
   "DL", "WC", "CL"); anything custom is initialled from its words. Colour
   rides along so a card and its badge agree without the caller repeating the
   mapping — teal is the fallback, matching the licence colour default. */
export type CredBadge = { code: string; color: string };

const KNOWN_BADGES: [RegExp, CredBadge][] = [
  [/\barc\b/i, { code: "ARC", color: "#00A389" }],
  [/driver|drivers|driver’s|driver's/i, { code: "DL", color: "#2E68FF" }],
  [/white\s*card/i, { code: "WC", color: "#8A2BE2" }],
  [/contractor/i, { code: "CL", color: "#F0A431" }],
];

export function credBadgeCode(typeName: string | null | undefined): CredBadge {
  const name = (typeName ?? "").trim();
  if (!name) return { code: "—", color: "#00A389" };
  for (const [re, badge] of KNOWN_BADGES) if (re.test(name)) return badge;
  const initials = name
    .split(/[\s/&-]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("");
  return { code: initials || name.slice(0, 2).toUpperCase(), color: "#00A389" };
}

export type LicenceStatus = { label: string; tone: "ok" | "warn" | "bad" | "mute" };

/* The little status pill on a licence card. Same 30-day warning window the
   dashboard's action chips use, so a licence that reads "Expires in 2 weeks"
   here is exactly the one that raises a chip there.

   The expired pill stays the bare word "Expired": on the card the expiry date
   itself is right there beside it, so counting the days back adds length
   without adding information. Everywhere the date ISN'T shown — chips, the
   compliance label — the full "expired 4 weeks ago" clause is used instead. */
export function licenceStatus(expiry: string | null, today: string, warnDays: number): LicenceStatus {
  if (!expiry) return { label: "No expiry", tone: "mute" };
  const days = daysUntil(expiry, today);
  if (days < 0) return { label: "Expired", tone: "bad" };
  if (days <= warnDays) return { label: expiresIn(days), tone: "warn" };
  return { label: "Valid", tone: "ok" };
}
