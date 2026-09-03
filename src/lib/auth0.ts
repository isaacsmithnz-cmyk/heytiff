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
  session: { user: { name?: unknown; email?: string | null; picture?: unknown } },
  /** What the org already calls this person — today, the name typed on their
      invitation. Beats the identity provider because somebody here decided
      it; see the seed below for why the provider often has nothing. */
  knownAs?: string | null
) {
  try {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return;

    /* AN ADDRESS IS NOT A NAME, AND AUTH0'S CLAIM IS OFTEN ONE. For any
       identity that never set a name — every fresh database sign-up — the
       `name` claim IS the sign-in address. The old seed was written to fall
       back to the local part and never got there: `??` only steps past null,
       and the claim is not null, it is the whole address. So production holds
       a card whose full_name reads 'isaacsmithnz+test@gmail.com'.

       THE FALLBACK IS THE LOCAL PART, NOT NULL, AND THAT IS A DELIBERATE
       SECOND CHOICE. Null is the cleaner record — it makes "nobody has ever
       told us this person's name" a state you can see — but only ONE reader
       in the app can survive it. `toStaffRow` splits the address for its own
       display; the other fifteen resolve a card through `displayNameOf` /
       `fullNameOf`, which have no address to fall back to and answer
       "Unnamed". Two nameless people then become two identical rows in every
       assignee picker, on Time & Pay, on the job sheet — indistinguishable,
       which is worse than an ugly handle. `ben` is not their name; it is a
       handle nobody can mistake for one, and it is what those screens have
       always drawn anyway.

       WHAT ACTUALLY FIXES THE NAME IS `knownAs` — the invitation carrying who
       the inviter is inviting. This line is the last resort behind it, and it
       is still reached by the founder at /start and by anyone signing in
       without an invitation. */
    const seedName =
      personName(knownAs) ??
      personName(session.user.name) ??
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

/** A name is a name — never an address, whatever claim it arrived in. Mirrors
    `asPersonName` in the invite action; kept local because this module is
    imported by the Auth0 client itself and must stay free of app actions. */
function personName(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return !s || s.includes("@") ? null : s;
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
