import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { supabaseAdmin } from "./supabase-server";
import { splitName } from "./staff/name";

/* Make sure the user has a staff card in this org. Best effort, like the
   profiles upsert: a failure here must never block login — /dashboard/profile
   creates the row on demand as well.

   Exported because the invite-accept route needs it too: `beforeSessionSaved`
   runs only when the SDK saves a session it built, not on `updateSession`, so
   accepting an invite would otherwise leave a member with an org but no staff
   card for the whole of their first session. */
export async function ensureStaffCard(
  orgId: string,
  userId: string,
  session: { user: { name?: unknown; email?: string | null; picture?: unknown } }
) {
  try {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return;

    const seedName =
      (session.user.name as string | undefined) ??
      session.user.email?.split("@")[0] ??
      null;
    await supabaseAdmin.from("staff_profiles").insert({
      org_id: orgId,
      user_id: userId,
      // Auth0 hands us one `name` claim, so the seed splits it best-effort;
      // the person can correct either half on their own card.
      ...splitName(seedName),
      full_name: seedName,
      photo_url: (session.user.picture as string | undefined) ?? null,
    });
  } catch (e) {
    console.error("Failed to ensure staff card:", e);
  }
}

export const auth0 = new Auth0Client({
  signInReturnToPath: "/dashboard",
  beforeSessionSaved: async (session) => {
    const userId = session.user.sub;

    // Keep a per-user profile row current — created_at (first login) and
    // last_login_at power the HQ portal's user lists / tenure / activity. Best
    // effort: a profiles failure must never block login (same posture as the
    // org-creation error handling below).
    try {
      await supabaseAdmin.from("profiles").upsert(
        {
          user_id: userId,
          email: session.user.email ?? null,
          name: (session.user.name as string | undefined) ?? null,
          picture: (session.user.picture as string | undefined) ?? null,
          last_login_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (e) {
      console.error("Failed to sync profile:", e);
    }

    const { data: memberships } = await supabaseAdmin
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", userId)
      .limit(1);

    const existing = memberships?.[0];

    if (existing) {
      await ensureStaffCard(existing.org_id, userId, session);
      return { ...session, orgId: existing.org_id, orgRole: existing.role };
    }

    // If there's a pending invite for this email, don't auto-create an org —
    // the invite accept flow will create the membership and set orgId.
    if (session.user.email) {
      const { data: pendingInvite } = await supabaseAdmin
        .from("invitations")
        .select("id")
        .eq("email", session.user.email)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1);

      if (pendingInvite?.[0]) return session;
    }

    // First login with no invite — create the org and owner membership.
    // organizations.primary_owner_user_id is NOT NULL and its composite FK onto
    // memberships is DEFERRABLE INITIALLY DEFERRED: the org row and the owner
    // membership can only land together, in one transaction, with the owner
    // named at insert time. Two sequential inserts can never satisfy that, so
    // the pair is written by one RPC (docs/migrations/create_org_for_owner.sql).
    const { data: orgId, error } = await supabaseAdmin.rpc("create_org_for_owner", {
      p_user_id: userId,
      p_name: session.user.email ?? userId,
    });

    if (error || !orgId) {
      console.error("Failed to create organisation:", error);
      return session;
    }

    await ensureStaffCard(orgId, userId, session);

    return { ...session, orgId, orgRole: "owner" };
  },
});
