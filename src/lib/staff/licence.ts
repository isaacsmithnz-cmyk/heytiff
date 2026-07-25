import { parseAuDate } from "@/lib/au-dates";
import { daysUntil } from "@/components/fleet/logic";
import { EXPIRY_WARN_DAYS } from "./derive";

/* Pure rules for a staff licence — validation of what goes IN, and the status
   label that comes OUT. Kept out of the server action (which only does I/O) and
   out of the render (which only does markup) so both agree on the same rules
   and both are testable without a database or a DOM.

   A licence is a row in `staff_licences`, not a column, so it never rides the
   flat section-save; the actions in app/actions/{profile,staff} call these. */

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

export type LicenceStatus = { label: string; tone: "ok" | "warn" | "bad" | "mute" };

/* The little status pill on a licence card. Same 30-day warning window the
   dashboard's action chips use, so a licence that reads "Expires 14d" here is
   exactly the one that raises a chip there. */
export function licenceStatus(expiry: string | null, today: string): LicenceStatus {
  if (!expiry) return { label: "No expiry", tone: "mute" };
  const days = daysUntil(expiry, today);
  if (days < 0) return { label: "Expired", tone: "bad" };
  if (days <= EXPIRY_WARN_DAYS) return { label: `Expires ${days}d`, tone: "warn" };
  return { label: "Valid", tone: "ok" };
}
