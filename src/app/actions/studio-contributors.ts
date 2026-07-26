"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { requireOrg } from "@/lib/permissions-server";

/* Who has worked on a design. Every save records the saver (via
   lib/studio/contributions-server — deliberately not an action); the Summary
   sheet lists them here. Same invite-action pattern as the rest of studio
   persistence: authenticate the session AND the `studio` capability, then
   read through the service role with an explicit org scope, because Server
   Functions are reachable by direct POST and must re-check for themselves. */

export type DesignContributor = {
  userId: string;
  /** the person's name, or null when no staff profile exists for them yet */
  name: string | null;
  photoUrl: string | null;
  firstAt: string;
  lastAt: string;
};

export async function listDesignContributors(
  designId: string
): Promise<DesignContributor[]> {
  const { orgId } = await requireOrg("studio");
  const { data, error } = await supabaseAdmin
    .from("studio_design_contributors")
    .select("user_id, first_at, last_at")
    .eq("org_id", orgId)
    .eq("design_id", designId)
    .order("first_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { user_id: string; first_at: string; last_at: string }[];
  if (rows.length === 0) return [];

  /* names live on the staff profile, not on the contribution — look them up
     in one hit, and fall back to null so a contributor with no profile yet
     still appears (the design history is the point, not the directory) */
  const { data: staff } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id, full_name, preferred_name, photo_url")
    .eq("org_id", orgId)
    .in(
      "user_id",
      rows.map((r) => r.user_id)
    );
  const byUser = new Map(
    ((staff ?? []) as {
      user_id: string;
      full_name: string | null;
      preferred_name: string | null;
      photo_url: string | null;
    }[]).map((s) => [s.user_id, s])
  );

  return rows.map((r) => {
    const s = byUser.get(r.user_id);
    return {
      userId: r.user_id,
      name: s?.preferred_name?.trim() || s?.full_name?.trim() || null,
      photoUrl: s?.photo_url ?? null,
      firstAt: r.first_at,
      lastAt: r.last_at,
    };
  });
}
