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
    /* Seed the holiday state from the org so every calendar consumer — the
       presumption, the approver's screen, submit-time materialisation —
       resolves the same public holidays from this person's first day. An
       admin can point interstate crew at their own state on the staff card. */
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("state")
      .eq("id", orgId)
      .maybeSingle();
    await supabaseAdmin.from("staff_profiles").insert({
      org_id: orgId,
      user_id: userId,
      // Auth0 hands us one `name` claim, so the seed splits it best-effort;
      // the person can correct either half on their own card.
      ...splitName(seedName),
      full_name: seedName,
      photo_url: (session.user.picture as string | undefined) ?? null,
      state: (org?.state as string | undefined) ?? null,
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

    /* ORDERED, because one person can hold several memberships and this pick
       decides which workspace they open in. Unordered `limit(1)` let Postgres
       answer with whatever row it reached first, so somebody who had been
       invited to a second org could sign in to a different one than they did
       yesterday. Oldest first — the workspace they have had longest — with id
       as the tiebreak so two rows written in the same tick still resolve the
       same way every time. */
    const { data: memberships } = await supabaseAdmin
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1);

    const existing = memberships?.[0];

    if (existing) {
      await ensureStaffCard(existing.org_id, userId, session);
      return { ...session, orgId: existing.org_id, orgRole: existing.role };
    }

    /* NO MEMBERSHIP, NO ORG — and signing in does not mint one.

       This used to call create_org_for_owner for anyone who arrived without a
       membership, which made "sign in" and "found a company" the same act. The
       cost was paid by invited people: whoever signed up BEFORE their invite
       existed became the owner of an empty company named after their gmail,
       and the invite then made them a member of a second one. A guard read the
       invitations table to spot that case, which only narrowed the window — it
       could not close it, because an invite that has not been created yet
       cannot be found. So the order in which two people did two things decided
       whether the product worked, and nothing on screen said so.

       An org is founded on /start now, by pressing a button that says it. A
       session with no orgId is a real, supported state: the proxy sends it to
       /start, which offers the invite waiting for this address or the door to
       create a company. */
    return session;
  },
});
