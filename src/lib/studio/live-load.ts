/* ONE READ FOR THE LIVE LINK, SHARED BY THE PAGE AND ITS PREVIEW.

   The page, its `generateMetadata` and the preview image all begin the same
   way: find the studio_designs row the token points at, check the link is
   still open, bring the saved document up to the current schema, and find
   out whose business it is. Wrapped in React's `cache` so the page and its
   metadata, which run in the same request, share a single round trip; the
   image is its own request and pays for its own.

   The order of checks is the page's, unchanged: a missing row and an
   unreadable document both come back as `missing` and 404 there, an aged
   link comes back as `expired` and gets the plain "ask for a new one" page.
   Expiry is enforced HERE and not only in the UI — this is the only thing
   standing between a public token and the design. */

import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { orgBrand } from "@/lib/org/query";
import { NO_BRAND } from "@/lib/org/brand";
import { migrateDesign } from "./migrations";
import { isShareExpired } from "./share";
import type { DesignDocument } from "./document";
import type { LiveShare } from "./live-og";

export type LoadedLiveShare = LiveShare & { orgId: string | null };

export const loadLiveShare = cache(async (token: string): Promise<LoadedLiveShare> => {
  if (!token || token.length < 16) return { kind: "missing", orgId: null };

  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("doc, share_created_at, org_id")
    .eq("share_token", token)
    .maybeSingle();
  if (error || !data?.doc) return { kind: "missing", orgId: null };

  const orgId = (data.org_id as string | null) ?? null;
  const shareCreatedAt = data.share_created_at as string | null;
  if (isShareExpired(shareCreatedAt)) return { kind: "expired", orgId };

  let doc: DesignDocument;
  try {
    doc = migrateDesign(data.doc).doc;
  } catch {
    return { kind: "missing", orgId };
  }

  /* Signed on the SIX-HOUR clock the plan rasters use, not the one-page-view
     default: a customer keeps this tab open, and a letterhead that dies an
     hour in above drawings that are still there looks like a broken page.
     Fails soft — orgBrand returns NO_BRAND for a missing row. */
  const brand = orgId ? await orgBrand(orgId, { seconds: 21600 }) : NO_BRAND;

  // shareCreatedAt is non-null here: a null one is expired above
  return { kind: "live", doc, brand, shareCreatedAt: shareCreatedAt as string, orgId };
});
