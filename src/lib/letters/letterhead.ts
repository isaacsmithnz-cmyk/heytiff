import { formatAbn, formatAcn } from "@/lib/org/settings";
import type { OrgBrand } from "@/lib/org/brand";
import type { Letterhead, LetterheadDetail } from "@/lib/templates/settings";

/* THE BUSINESS'S OWN PAPER — the facts a letterhead can print, and which of
   them it does. The facts are the business's (Admin → Organisation), read
   on the server; the template (lib/templates/settings, Letterhead) only
   chooses among them, so a letter never carries an ABN typed twice.

   Pure: the template's preview in the browser and the printed letter on
   the server draw the same lines. */

export type LetterheadFacts = {
  brand: OrgBrand;
  legalName: string | null;
  acn: string | null;
  /** The street, then the suburb, state and postcode: two lines at most. */
  address: string[];
  /** "ARC authorisation AU12345", "Contractor licence 123456C". */
  licences: string[];
};

export type LetterSigner = {
  name: string;
  title: string | null;
  /** Drawn on the staff card; null when there is none or it is left off. */
  signatureSvg: string | null;
};

/** The detail lines under the business's name, in the order they print. */
export function letterheadLines(f: LetterheadFacts, t: Letterhead): string[] {
  const b = f.brand;
  const lines: string[] = [];
  const add = (k: LetterheadDetail, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (t.show[k] && v) lines.push(v);
  };
  /* the legal name only when it says something the trading name doesn't */
  if (f.legalName && f.legalName.trim().toLowerCase() !== b.name.trim().toLowerCase()) add("legalName", f.legalName);
  const ids = [
    t.show.abn && b.abn ? `ABN ${formatAbn(b.abn)}` : "",
    t.show.acn && f.acn ? `ACN ${formatAcn(f.acn)}` : "",
  ].filter(Boolean);
  if (ids.length) lines.push(ids.join("   "));
  if (t.show.address) lines.push(...f.address.filter((l) => l.trim()));
  add("phone", b.phone);
  add("email", b.email);
  add("website", b.website);
  if (t.show.licences) lines.push(...f.licences);
  return lines;
}

/** The address as it prints: the street, then the locality. */
export function addressLinesOf(o: { address?: string | null; suburb?: string | null; state?: string | null; postcode?: string | null }): string[] {
  const street = (o.address ?? "").trim();
  const place = [o.suburb, o.state, o.postcode].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  return [street, place].filter(Boolean);
}
