"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { auth0 } from "@/lib/auth0";
import { isMaster } from "@/lib/permissions-server";

/* HANDING THE ACCOUNT OVER — the one master-only write this app has.

   `transfer_ownership` has been the first entry in MASTER_ONLY since the
   ownership model landed, and nothing implemented it: `primary_owner_user_id`
   was written once at first login and never again, so the Account card stated
   a fact with no way to change it.

   THE GATE IS `isMaster()`, not `hasMinRole("owner")`. Every other write on the
   Organisation screen is owner-intrinsic and co-owners share it; this one is
   the definition of the difference. A co-owner pressing this by direct POST is
   refused here and refused again inside the transaction.

   THE WRITE IS AN RPC because two rows have to move together — the new owner's
   role and the org's pointer — and PostgREST cannot span a transaction. See
   docs/migrations/transfer_org_ownership.sql for what each half-state would
   break. The exceptions it raises are named, not prose, so the wording lives
   here where the rest of this screen's wording is. */

export type TransferResult = { ok: true } | { ok: false; error: string };

const NOT_MASTER = "Only the account owner can hand the account over.";

/* The RPC's named exceptions, in the words the modal shows. Postgres puts the
   raised name in the message, so a match is a substring test — anything
   unrecognised falls through to its own message rather than being swallowed as
   a generic failure. */
const REFUSALS: [string, string][] = [
  ["not_master", NOT_MASTER],
  ["already_master", "They already hold the account."],
  ["not_a_member", "They haven't signed in yet, so the account can't be put in their name."],
  ["org_not_found", "That organisation no longer exists."],
];

function refusalFor(message: string): string | null {
  for (const [name, said] of REFUSALS) if (message.includes(name)) return said;
  return null;
}

export async function transferOwnership(newOwnerUserId: string): Promise<TransferResult> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");

  const actorId = session.user.sub as string;
  if (!(await isMaster())) return { ok: false, error: NOT_MASTER };

  const target = (newOwnerUserId ?? "").trim();
  if (!target) return { ok: false, error: "Choose who the account goes to." };
  if (target === actorId) return { ok: false, error: "You already hold the account." };

  const { error } = await supabaseAdmin.rpc("transfer_org_ownership", {
    p_org_id: orgId,
    p_actor_user_id: actorId,
    p_new_owner_user_id: target,
  });

  if (error) {
    return { ok: false, error: refusalFor(error.message) ?? "That didn't go through." };
  }

  /* Both screens that say who the owner is, and the shell: the sidebar and
     every gate read role per request (permissions-server), so the new owner
     has the powers on their next request without signing out — but the pages
     already rendered still name the old one. */
  revalidatePath("/dashboard/admin/organization");
  revalidatePath("/dashboard/team");
  return { ok: true };
}
