import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { supabaseAdmin } from "./supabase-server";

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

    // First login with no invite — create the org and owner membership
    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .insert({ name: session.user.email ?? userId })
      .select("id")
      .single();

    if (error || !org) {
      console.error("Failed to create organisation:", error);
      return session;
    }

    await supabaseAdmin
      .from("memberships")
      .insert({ user_id: userId, org_id: org.id, role: "owner" });

    return { ...session, orgId: org.id, orgRole: "owner" };
  },
});
