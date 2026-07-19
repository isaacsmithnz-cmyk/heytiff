"use server";

import { randomUUID } from "crypto";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Design Studio — the customer live link. One token per design, riding the
   studio_designs row itself (share_token unique, nullable): create rotates a
   fresh UUID, revoke nulls it, and /live/[token] serves whatever the row
   holds RIGHT NOW — the link is live, not a snapshot. Org-scoped like every
   studio action; the public read lives in the /live route, not here. */

async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.sub as string };
}

export interface ShareLink {
  url: string;
  createdAt: string;
}

const linkFor = (token: string): string =>
  `${process.env.APP_BASE_URL ?? ""}/live/${token}`;

/** create (or rotate) the design's live link */
export async function createShareLink(designId: string): Promise<ShareLink> {
  const { orgId } = await requireOrg();
  const token = randomUUID();
  const createdAt = new Date().toISOString();
  const { error, data } = await supabaseAdmin
    .from("studio_designs")
    .update({ share_token: token, share_created_at: createdAt })
    .eq("org_id", orgId)
    .eq("id", designId)
    .select("id");
  if (error) throw new Error(`share failed: ${error.message}`);
  if (!data || data.length === 0)
    throw new Error("design not found — save it first");
  return { url: linkFor(token), createdAt };
}

export async function getShareLink(
  designId: string
): Promise<ShareLink | null> {
  const { orgId } = await requireOrg();
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("share_token, share_created_at")
    .eq("org_id", orgId)
    .eq("id", designId)
    .maybeSingle();
  if (error) throw new Error(`share lookup failed: ${error.message}`);
  if (!data?.share_token) return null;
  return {
    url: linkFor(data.share_token),
    createdAt: data.share_created_at ?? new Date(0).toISOString(),
  };
}

export async function revokeShareLink(designId: string): Promise<void> {
  const { orgId } = await requireOrg();
  const { error } = await supabaseAdmin
    .from("studio_designs")
    .update({ share_token: null, share_created_at: null })
    .eq("org_id", orgId)
    .eq("id", designId);
  if (error) throw new Error(`revoke failed: ${error.message}`);
}
