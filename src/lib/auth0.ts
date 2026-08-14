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

/* SELF-SERVE SIGNUP IS OFF UNLESS SOMEBODY TURNS IT ON.

   First login with no invite used to mint a whole ORGANISATION named after the
   person's email address and make them its owner. That is the correct front
   door for a new BUSINESS signing up, and the wrong one for every other way a
   stranger reaches the site — including, and this is what actually happened,
   an employee who was told "we've got a new app", typed the address in, and
   never touched the invite link that was sitting in their texts.

   Prod carries three of these: two owned by the same address, which is one
   person signing in twice. They are unrecoverable from inside the app — there
   is no "join a company" screen and no way to move a user between orgs — so
   the person is permanently stuck alone in an empty company that looks exactly
   like a broken product, and the admin's invite for them can never be accepted
   under that login without leaving a second membership behind (see the ordering
   note on the membership read below).

   Invite emails are NOT sent yet (actions/invite.ts), so an invite reaches
   someone only when an admin copies its link by hand — which makes "signed in
   before clicking the link" the LIKELY path through onboarding, not the odd
   one. The flag is therefore off by default, and its polarity is deliberate:
   an unset variable is the safe behaviour, because an unset variable is what
   we actually ship with (CRON_SECRET spent two months teaching us that a
   missing env var is invisible in Vercel's UI).

   With it off, a stranger lands on /no-org — signed in, told what happened,
   and handed their pending invite if one exists — instead of owning a ghost. */
const selfServeSignup = () => process.env.SELF_SERVE_SIGNUP === "1";

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

    /* ORDERED, because "the first row" was never a defined thing. This read
       picked whichever membership Postgres happened to hand back first, so a
       user holding two of them would land in a DIFFERENT company on different
       logins — and the empty one looks exactly like every screen having lost
       its data. There is no org switcher mounted anywhere in the app to climb
       back out with (components/org-switcher.tsx exists and nothing renders
       it), so an arbitrary pick is the whole story for that person's day.

       NEWEST WINS, and the direction is chosen for the state prod is actually
       in rather than for tidiness. The people holding two memberships are the
       ones who signed themselves in before their invite existed: membership
       one is the ghost org that signup minted for them, membership two is the
       real company they were invited to. Oldest-first would pin them to the
       ghost forever. Joining a company is also simply the more deliberate act
       of the two — an accident cannot be later than the decision that followed
       it — so the most recent membership is the better answer generally, not
       only here. */
    const { data: memberships } = await supabaseAdmin
      .from("memberships")
      .select("org_id, role")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = memberships?.[0];

    if (existing) {
      await ensureStaffCard(existing.org_id, userId, session);
      return { ...session, orgId: existing.org_id, orgRole: existing.role };
    }

    // If there's a pending invite for this email, don't auto-create an org —
    // the invite accept flow will create the membership and set orgId.
    // Lowercased to match the write side: createInvite normalises on insert,
    // but Auth0 relays whatever casing the identity provider holds, and a
    // missed match here strands the invitee as owner of a phantom org.
    if (session.user.email) {
      /* EXPIRY IS NOT CHECKED HERE, and that is the point. This read asks
         "does anyone believe this person belongs to a company?", not "may they
         walk in right now" — the accept route is what enforces the window, and
         it still does. An invite that lapsed after seven days used to fall
         through to org creation, so the slowest person in an onboarding round
         was the one who ended up owning a ghost company. Now they reach
         /no-org, which names the org that invited them and tells them to ask
         for a renew — a state an admin can fix with the Renew button that
         already exists. */
      const { data: pendingInvite } = await supabaseAdmin
        .from("invitations")
        .select("id")
        .eq("email", session.user.email.toLowerCase())
        .is("accepted_at", null)
        .limit(1);

      if (pendingInvite?.[0]) return session;
    }

    // First login with no invite — create the org and owner membership.
    // OFF by default; see the note on selfServeSignup above for why.
    if (!selfServeSignup()) return session;

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
