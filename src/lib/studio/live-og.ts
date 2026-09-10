/* WHAT A LIVE LINK SAYS ABOUT ITSELF BEFORE IT IS OPENED.

   A customer gets the live design link in WhatsApp or iMessage, and the app
   sends those a preview: a title, a line of description, an image. Until
   now the route declared a title only, so the preview was a grey box with
   "Live design — HeyTiff" under it — the one page in the product that is
   sent to customers, and the one that arrived looking broken.

   This file decides the words. It is pure so the page's metadata, the image
   route and the tests all read the same model, and so the rule about what a
   preview may reveal lives in one place:

   THE PREVIEW SAYS WHAT THE SHEET'S HEAD SAYS, AND NO MORE. The design's
   name (or its site's first line), whose business prepared it, when, and
   how long the link stays open. Never the client's name, never a figure —
   a preview is cached by whichever messaging service carried the link, and
   sits on a lock screen. A link that is missing or expired describes
   nothing about the design it used to point at, for the same reason the
   expired page does not. */

import type { Metadata } from "next";
import type { DesignDocument } from "./document";
import type { OrgBrand } from "@/lib/org/brand";
import { shareExpiresAt } from "./share";

export type LiveShare =
  | { kind: "missing" }
  | { kind: "expired" }
  | { kind: "live"; doc: DesignDocument; brand: OrgBrand; shareCreatedAt: string };

export interface LiveOgModel {
  /** true for a missing or expired link: the generic card, no design facts */
  closed: boolean;
  /** whose design it is; "HeyTiff" when the business has no name on file */
  org: string;
  /** the big line: the design's name, else the site's first line, else "Design" */
  headline: string;
  /** under the headline */
  line: string;
  /** small, at the foot */
  footer: string;
  /** <title> and og:title */
  title: string;
  /** og:description */
  description: string;
  /** the business's brand colour for a band across the top, as the sheet
      wears it; null when the business has none */
  bandColor: string | null;
}

const CLOSED: LiveOgModel = {
  closed: true,
  org: "HeyTiff",
  headline: "This design link is no longer open",
  line: "Ask whoever sent it for a fresh one.",
  footer: "",
  title: "Live design — HeyTiff",
  description: "This design link is no longer open. Ask whoever sent it for a fresh one.",
  bandColor: null,
};

const AU_LONG: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
const AU_SHORT: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" };

export function liveOgModel(share: LiveShare): LiveOgModel {
  if (share.kind !== "live") return CLOSED;
  const { doc, brand, shareCreatedAt } = share;

  const site = doc.meta.site
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  const headline = doc.meta.name.trim() || site || "Design";
  const org = brand.name.trim() || "HeyTiff";
  const variant = doc.meta.variantLabel ? `, ${doc.meta.variantLabel.toLowerCase()}` : "";
  const preparedOn = new Date(doc.meta.updatedAt).toLocaleDateString("en-AU", AU_LONG);
  const expiresOn = shareExpiresAt(shareCreatedAt).toLocaleDateString("en-AU", AU_SHORT);

  return {
    closed: false,
    org,
    headline,
    line: `Design summary${variant}, prepared ${preparedOn}`,
    footer: `Link open until ${expiresOn}`,
    title: `${headline}, design summary from ${org}`,
    description: `Prepared by ${org} on ${preparedOn}. Link open until ${expiresOn}.`,
    bandColor: brand.color,
  };
}

/** The page's metadata, from the same model. The image comes from the
    file convention (opengraph-image.tsx beside the page) and needs no entry
    here. `robots` stays as it was: a customer link is not for search. */
export function liveMetadata(share: LiveShare): Metadata {
  const m = liveOgModel(share);
  return {
    title: m.title,
    description: m.description,
    robots: { index: false, follow: false },
    openGraph: {
      title: m.title,
      description: m.description,
      type: "website",
      siteName: m.org,
    },
    twitter: { card: "summary_large_image", title: m.title, description: m.description },
  };
}
