"use server";

import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";
import { shareExpiresAt, isShareExpired, shareDaysLeft } from "@/lib/studio/share";
import { parseLinkScope, type LinkScope } from "@/lib/studio/send";

/* Design Studio — the customer live link. One token per design, riding the
   studio_designs row itself (share_token unique, nullable): create rotates a
   fresh UUID, revoke nulls it, and /live/[token] serves whatever the row
   holds RIGHT NOW — the design summary off the latest save, not a snapshot.
   Org-scoped AND `studio`-gated like every studio action — creating one mints a PUBLIC
   unauthenticated URL, so this file least of all can rely on the page gate.
   The public read lives in the /live route, not here.

   WHAT THE LINK SHOWS rides the row too (`share_scope`): the Send dialog's
   ticks, re-read through parseLinkScope because they come from a browser —
   so a POST can narrow the link but never put the picklist on it. */

export interface ShareLink {
  url: string;
  createdAt: string;
  /** when it stops working — links last SHARE_TTL_DAYS (see lib/studio/share) */
  expiresAt: string;
  /** already past it: the link is dead until someone creates a new one */
  expired: boolean;
  /** whole days remaining, 0 once expired */
  daysLeft: number;
  /** what the customer sees on it */
  scope: LinkScope;
}

const describe = (token: string, createdAt: string, scope: unknown): ShareLink => ({
  url: linkFor(token),
  scope: parseLinkScope(scope),
  createdAt,
  expiresAt: shareExpiresAt(createdAt).toISOString(),
  expired: isShareExpired(createdAt),
  daysLeft: shareDaysLeft(createdAt),
});

const linkFor = (token: string): string =>
  `${process.env.APP_BASE_URL ?? ""}/live/${token}`;

/** create (or rotate) the design's live link, showing `scope` */
export async function createShareLink(designId: string, scope?: unknown): Promise<ShareLink> {
  const { orgId } = await requireOrg("studio");
  const token = randomUUID();
  const createdAt = new Date().toISOString();
  const shareScope = parseLinkScope(scope);
  const { error, data } = await supabaseAdmin
    .from("studio_designs")
    .update({ share_token: token, share_created_at: createdAt, share_scope: shareScope })
    .eq("org_id", orgId)
    .eq("id", designId)
    .select("id");
  if (error) throw new Error(`share failed: ${error.message}`);
  if (!data || data.length === 0)
    throw new Error("design not found — save it first");
  return describe(token, createdAt, shareScope);
}

/** Change what an existing link shows. The token and its expiry stay: the
    customer's link keeps working, and shows the new ticks. */
export async function updateShareScope(designId: string, scope: unknown): Promise<ShareLink> {
  const { orgId } = await requireOrg("studio");
  const { error, data } = await supabaseAdmin
    .from("studio_designs")
    .update({ share_scope: parseLinkScope(scope) })
    .eq("org_id", orgId)
    .eq("id", designId)
    .not("share_token", "is", null)
    .select("share_token, share_created_at, share_scope");
  if (error) throw new Error(`share update failed: ${error.message}`);
  const row = data?.[0];
  if (!row?.share_token) throw new Error("no live link to update");
  return describe(row.share_token, row.share_created_at ?? new Date(0).toISOString(), row.share_scope);
}

export async function getShareLink(
  designId: string
): Promise<ShareLink | null> {
  const { orgId } = await requireOrg("studio");
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("share_token, share_created_at, share_scope")
    .eq("org_id", orgId)
    .eq("id", designId)
    .maybeSingle();
  if (error) throw new Error(`share lookup failed: ${error.message}`);
  if (!data?.share_token) return null;
  /* a row with no timestamp predates the expiry rule — epoch reads as long
     expired, which is the safe way round */
  return describe(
    data.share_token,
    data.share_created_at ?? new Date(0).toISOString(),
    data.share_scope
  );
}

export async function revokeShareLink(designId: string): Promise<void> {
  const { orgId } = await requireOrg("studio");
  const { error } = await supabaseAdmin
    .from("studio_designs")
    .update({ share_token: null, share_created_at: null, share_scope: null })
    .eq("org_id", orgId)
    .eq("id", designId);
  if (error) throw new Error(`revoke failed: ${error.message}`);
}
