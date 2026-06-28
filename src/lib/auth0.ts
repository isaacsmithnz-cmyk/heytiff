import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { supabaseAdmin } from "./supabase-server";

export const auth0 = new Auth0Client({
  signInReturnToPath: "/dashboard",
  beforeSessionSaved: async (session) => {
    const userId = session.user.sub;

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
