"use server";

import { revalidatePath } from "next/cache";
import { auth0, ensureStaffCard } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getOwnership } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";

/* The two things an admin can do about a member with no staff card — the
   warning row at the top of Team's Active staff, which used to say "No staff
   card" and offer nothing (Isaac, 2026-09-28: "I can't even action it").

   A member with no card is somebody in `memberships` the directory cannot see:
   it reads cards. The card mints itself on their next sign-in, and for the one
   in production that sign-in has not come since July. So either the org gives
   them the card now, or takes the seat back. */

export type MemberResult = { ok: true } | { ok: false; error: string };

const NO_PERMISSION = "You don't have permission to do that.";

/** The member's seat in the caller's org — never by user id alone. */
async function seatIn(orgId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as { role: string } | null;
}

async function hasCard(orgId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

/* Give a member the card their next sign-in would have made.

   THE SAME CARD, BY THE SAME DOOR. `ensureStaffCard` is what sign-in and
   invite-accept already run, so the name rule (never an address), the holiday
   state and the photo all come out exactly as they would have — this only
   stops waiting for them. Gated on `team`, the capability the page and every
   card edit already sit behind. */
export async function createCardForMember(userId: string): Promise<MemberResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId || !(await can("team"))) return { ok: false, error: NO_PERMISSION };

  if (!(await seatIn(orgId, userId))) return { ok: false, error: "They're not in this workspace." };

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email, name, picture")
    .eq("user_id", userId)
    .maybeSingle();

  await ensureStaffCard(orgId, userId, {
    user: {
      email: (profile?.email as string | null) ?? null,
      name: profile?.name ?? undefined,
      picture: profile?.picture ?? undefined,
    },
  });

  /* ensureStaffCard is best effort and swallows its own failure — right for a
     sign-in, wrong for a button. Read the answer back rather than report a
     card that is not there. */
  if (!(await hasCard(orgId, userId))) return { ok: false, error: "Couldn't create the card." };

  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Take the seat back from a member who never got a card.

   OWNERS ONLY, because this is offboarding — the owner-intrinsic list in
   permissions-server — not a card edit.

   ONLY WHERE THERE IS NO CARD. With no card they have no timesheets, jobs,
   comments or documents here (every one of those hangs off the card), so
   removing the membership takes nothing with it. A member WITH a card has a
   history, and the way out for them is Deactivate on the card; this refuses
   rather than decide what happens to that history.

   Never yourself and never an owner: the first locks you out, the second is a
   change of ownership, which is not what a warning row is for. */
export async function removeMemberWithoutCard(userId: string): Promise<MemberResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return { ok: false, error: NO_PERMISSION };

  const actor = await getOwnership();
  if (!hasMinRole(actor.role, "owner")) return { ok: false, error: NO_PERMISSION };
  if (userId === actor.userId) return { ok: false, error: "You can't remove yourself." };

  const seat = await seatIn(orgId, userId);
  if (!seat) return { ok: false, error: "They're not in this workspace." };
  if (seat.role === "owner" || userId === actor.primaryOwnerUserId) {
    return { ok: false, error: "Owners can't be removed here." };
  }
  if (await hasCard(orgId, userId)) {
    return { ok: false, error: "They have a staff card now. Deactivate it from their row instead." };
  }

  const { error } = await supabaseAdmin
    .from("memberships")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: "Couldn't remove them." };

  revalidatePath("/dashboard/team");
  return { ok: true };
}

/* Delete a staff card that has nothing on the records — a test account, or
   someone added by mistake who never worked (Isaac, 2026-09-02 and 09-28).

   THE DATABASE DECIDES, IN ONE TRANSACTION. `delete_staff_card` locks the card,
   checks every table with a foreign key onto it (found from the catalogue, not
   a list kept here), and only then deletes the card, its login's seat in this
   org, and any unaccepted invitation that names it. A card with history is
   refused whatever the screen showed — the screen's list of deletable cards is
   read at page load and a timesheet can land after it.

   Owners only (offboarding is owner-intrinsic), never your own card, and never
   an owner's — the function refuses that too. The person's LOGIN is not
   touched: it is Auth0's, and it may belong to another workspace. */
export async function deleteStaffCard(staffId: string): Promise<MemberResult> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return { ok: false, error: NO_PERMISSION };

  const actor = await getOwnership();
  if (!hasMinRole(actor.role, "owner")) return { ok: false, error: NO_PERMISSION };

  const { data: card } = await supabaseAdmin
    .from("staff_profiles")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  if (!card) return { ok: false, error: "That staff member is already gone." };
  if (card.user_id && card.user_id === actor.userId) {
    return { ok: false, error: "You can't delete your own card." };
  }

  const { data, error } = await supabaseAdmin.rpc("delete_staff_card", { p_org: orgId, p_staff: staffId });
  if (error) return { ok: false, error: "Couldn't delete them." };
  switch (data as string) {
    case "deleted":
      revalidatePath("/dashboard/team");
      return { ok: true };
    case "in_use":
      return { ok: false, error: "They have records here now. Deactivate them instead." };
    case "owner":
      return { ok: false, error: "Owners can't be deleted." };
    case "not_found":
      return { ok: false, error: "That staff member is already gone." };
    default:
      return { ok: false, error: "Couldn't delete them." };
  }
}
