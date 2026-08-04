import { parseAuDate } from "@/lib/au-dates";

/* The tax half of a fuel log — the rules, pure.

   These figures leave the app. A litres reading that is out by two is a
   slightly wrong economy chip; a GST figure that is out by two ends up on a
   BAS, so every one of these refuses rather than rounds, corrects, or guesses.
   The modal applies the same rules for kindness; this file is the truth.

   Kept apart from components/fleet/logic.ts on purpose: that module is what
   the screens compute with, and this is what the server enforces before a row
   is written. */

/** How far back a docket may be dated. Long enough for the glovebox pile
    somebody finally empties in July, short enough that a mistyped year is
    caught rather than filed. */
export const MAX_BACKDATE_DAYS = 400;

export type FuelTaxInput = {
  cost?: number;
  gst?: number;
  abn?: string;
  purchasedOn?: string;
};

export type FuelTaxColumns = {
  gst: number | null;
  supplier_abn: string | null;
  logged_on: string;
};

export type FuelTaxCheck = { ok: true; columns: FuelTaxColumns } | { ok: false; error: string };

/** Eleven digits, however they were typed. Null for anything else — a partial
    ABN is not a smaller ABN, it is a wrong one. */
export function normaliseAbn(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

/** "51 824 753 556" — how the ATO prints it, and how it should read on screen
    and in the export. Anything not eleven digits comes back untouched. */
export function formatAbn(abn: string | null | undefined): string {
  if (!abn) return "";
  const d = abn.replace(/\D/g, "");
  if (d.length !== 11) return abn;
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
}

/** Days between two ISO dates, positive when `later` is after `earlier`. */
function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/* The GST ceiling. On a GST-INCLUSIVE total, the tax component is exactly one
   eleventh, so anything above that came off the wrong line of the docket —
   the litre price, the loyalty points, the pump number. The cent of tolerance
   is for the servo's own rounding, not for slack. */
function gstCeiling(cost: number): number {
  return cost / 11 + 0.01;
}

/** Turn what the person confirmed into the columns to write, or say why not. */
export function fuelTaxColumns(input: FuelTaxInput, today: string): FuelTaxCheck {
  /* THE DATE IS THE DOCKET'S, not the app's. Somebody who fuels up on Friday
     and files it on Monday has a Friday purchase, and the financial year it
     falls in is decided by the pump, not by when they got round to it. */
  let loggedOn = today;
  if (input.purchasedOn !== undefined) {
    const raw = input.purchasedOn.trim();
    /* parseAuDate, not a regex and not Date.parse. V8 happily turns
       "2026-02-31" into 3 March rather than NaN, so a shape check plus a parse
       would accept a date that does not exist and file it in the wrong month.
       The shared parser checks the real calendar. */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || parseAuDate(raw) !== raw) {
      return { ok: false, error: "That receipt date isn't a real date." };
    }
    const drift = daysBetween(raw, today);
    if (drift < 0) return { ok: false, error: "That receipt is dated in the future — check the date." };
    if (drift > MAX_BACKDATE_DAYS)
      return { ok: false, error: "That receipt is more than a year old — check the date." };
    loggedOn = raw;
  }

  let gst: number | null = null;
  if (input.gst !== undefined && input.gst !== null) {
    if (!Number.isFinite(input.gst) || input.gst < 0)
      return { ok: false, error: "That GST amount isn't a number." };
    if (input.gst > 0) {
      // GST without a total is a figure with nothing to check it against, and
      // it would land in the export as tax on a purchase of unknown size.
      if (!input.cost || input.cost <= 0)
        return { ok: false, error: "Enter the total cost before the GST." };
      if (input.gst > gstCeiling(input.cost))
        return { ok: false, error: "That GST is more than an eleventh of the total — check the docket." };
      gst = Math.round(input.gst * 100) / 100;
    }
  }

  let abn: string | null = null;
  if (input.abn !== undefined && input.abn !== null && input.abn.trim() !== "") {
    abn = normaliseAbn(input.abn);
    if (!abn) return { ok: false, error: "An ABN is eleven digits — check that one." };
  }

  return { ok: true, columns: { gst, supplier_abn: abn, logged_on: loggedOn } };
}
