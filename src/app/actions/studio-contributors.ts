"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Who has worked on a design. Every save records the saver; the Summary
   sheet lists them. Same invite-action pattern as the rest of studio
   persistence: authenticate the session, then read/write through the service
   role with an explicit org scope, because Server Functions are reachable by
   direct POST and must re-check for themselves. */

export type DesignContributor = {
  userId: string;
  /** the person's name, or null when no staff profile exists for them yet */
  name: string | null;
  photoUrl: string | null;
  firstAt: string;
  lastAt: string;
};

async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.sub as string };
}

/** Record that the current user just worked on this design. Called on save.
    first_at survives — only last_at moves — so the list keeps its order. */
export async function recordContribution(
  orgId: string,
  designId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("studio_design_contributors")
    .upsert(
      { org_id: orgId, design_id: designId, user_id: userId, first_at: now, last_at: now },
      { onConflict: "org_id,design_id,user_id", ignoreDuplicates: false }
    );
  // A contribution is a footnote, never the point of the save — see the
  // caller, which deliberately swallows this.
  if (error) throw new Error(error.message);
}

export async function listDesignContributors(
  designId: string
): Promise<DesignContributor[]> {
  const { orgId } = await requireOrg();
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
