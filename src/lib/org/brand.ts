/* THE COMPANY'S FACE, on everything it sends a customer.

   The logo has been uploadable since org_logo landed, and until now it was
   read by exactly one screen: the Organisation page, which is where you set
   it. Every surface a customer actually receives — the handover sheet, the
   live design link, the printed copy — either said "HeyTiff" or said
   nothing at all, so a document produced by Smith Air Conditioning arrived
   carrying the name of the software that made it.

   This is the shape those surfaces share. Pure module: no I/O, so the client
   components that print can import it; the read is orgBrand() in query.ts.

   NOT a settings object. Nothing here is configurable — it is the company
   profile, re-cut for a letterhead, and every field is already edited on the
   Organisation page. */

import { formatAbn } from "./settings";

export type OrgBrand = {
  /** trading name, falling back to the legal one; "" when neither is set */
  name: string;
  /** SIGNED at render and short-lived — never a stored URL. Null when there
      is no logo, or when the link could not be minted. */
  logoUrl: string | null;
  /** The ONE seed colour, lowercase #rrggbb, or null for no theme. Never
      painted: `documentTheme` in theme.ts derives what a document may use.
      Deliberately not part of `hasBrand` — a colour with no name and no logo
      is not a letterhead, and must not displace a surface's own wording. */
  color: string | null;
  abn: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

/* HOW LONG A LETTERHEAD LIVES.

   The logo is a private object behind a signed link, and the surface that
   renders it is a studio tab somebody leaves open all afternoon — so the link
   has to outlive the sitting, and the sheet has to be able to notice when it
   has not.

   Both numbers are here rather than in the hook because the SERVER now mints
   the first one (the studio route hands the brand down with the page, so the
   sheet's first paint already has its frame and its mark) and the CLIENT
   re-mints it later. Two places signing for two different windows is how a
   letterhead goes to a broken image mid-afternoon on one surface only. */

/** six hours, matching what the customer's live link signs for */
export const BRAND_TTL_S = 21600;
/** re-sign on return once the link is this old — well inside the TTL */
export const BRAND_STALE_MS = 3_600_000;

/** A business that has told us nothing yet — every surface falls back to its
    own platform wording rather than printing an empty letterhead. */
export const NO_BRAND: OrgBrand = {
  name: "",
  logoUrl: null,
  color: null,
  abn: null,
  phone: null,
  email: null,
  website: null,
};

/** Is there anything to show? A brand with no name and no logo must not
    displace the wording a surface would otherwise use. */
export function hasBrand(b: OrgBrand): boolean {
  return Boolean(b.name.trim() || b.logoUrl);
}

/* The line under the name, assembled from what exists.

   ABN first because it is the one an invoice or a handover is checked
   against, and in its ATO 2-3-3-3 grouping for the same reason it is grouped
   on the Organisation page — eleven unbroken digits is how a transposition
   hides. Everything after it is how to make contact, in the order someone
   reaches for it.

   Returns [] when the business has given us nothing, so a caller can drop the
   whole line rather than render an empty one. */
export function brandContact(b: OrgBrand): string[] {
  const parts: string[] = [];
  if (b.abn?.trim()) parts.push(`ABN ${formatAbn(b.abn)}`);
  if (b.phone?.trim()) parts.push(b.phone.trim());
  if (b.email?.trim()) parts.push(b.email.trim());
  if (b.website?.trim()) parts.push(b.website.trim());
  return parts;
}

/** Two letters off the name, for a mark with no logo uploaded yet. Same rule
    the company card uses, so the two never disagree. */
export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
