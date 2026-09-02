"use server";

import { auth0, ensureStaffCard } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Founding a company — the act that used to happen by accident.

   Until now `beforeSessionSaved` called create_org_for_owner for anybody who
   signed in without a membership, so signing up and founding a business were
   the same keystroke. Whoever created an account before their invite existed
   became the owner of an empty company named after their gmail. Nothing on
   any screen said it had happened, and the only defence was knowing to do two
   things in the right order.

   So it is a button now, on /start, pressed by someone who read what it does.
   The RPC is unchanged (docs/migrations/create_org_for_owner.sql): the org row
   and the owner membership are one transaction because
   organizations.primary_owner_user_id is NOT NULL and its composite FK onto
   memberships is DEFERRABLE INITIALLY DEFERRED — two sequential inserts can
   never satisfy that shape.

   NO CAPABILITY GATE, deliberately, and no org gate either: this is the one
   action in the app whose whole purpose is to be reachable by someone who
   belongs to nothing. The guard that matters is that they must not already
   belong to something, checked below against the table rather than against
   the session — a session is a cookie and can be stale. */

export type CreateOrgResult = { ok: true } | { ok: false; error: string };

/** The company's own name is asked for on /welcome, which is where this sends
    them. The RPC needs SOMETHING for the legacy `organizations.name` column
    (NOT NULL), and the sign-in address is the only fact available at this
    point — `trading_name`, the one every screen actually reads, stays empty
    until they say what the business is called. */
export async function createMyOrg(): Promise<CreateOrgResult> {
  const session = await auth0.getSession();
  const userId = session?.user?.sub;
  if (!session || !userId) return { ok: false, error: "You're not signed in." };

  /* Already in a workspace: adopt it into the session rather than founding a
     second one. Covers the double-press and the stale cookie in one path —
     and because it returns ok, the caller lands on the same screen either way.
     Same ordering as beforeSessionSaved's pick, so both agree on which
     workspace is "theirs" when there is more than one. */
  const { data: existing } = await supabaseAdmin
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (existing?.[0]) {
    await auth0.updateSession({
      ...session,
      orgId: existing[0].org_id,
      orgRole: existing[0].role,
    });
    return { ok: true };
  }

  const { data: orgId, error } = await supabaseAdmin.rpc("create_org_for_owner", {
    p_user_id: userId,
    p_name: session.user.email ?? userId,
  });

  if (error || !orgId) {
    console.error("Failed to create organisation:", error);
    return { ok: false, error: "Couldn't create your company. Try again in a moment." };
  }

  /* Before the session flips, so /welcome and everything after it can read a
     staff card. `updateSession` writes the cookie directly and does NOT run
     `beforeSessionSaved`, which is the only other thing that would create one
     — the same reason the invite-accept route calls it by hand. */
  await ensureStaffCard(orgId, userId, session);

  await auth0.updateSession({ ...session, orgId, orgRole: "owner" });

  return { ok: true };
}
