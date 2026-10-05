"use server";

import { revalidatePath } from "next/cache";
import { requireHq } from "@/lib/hq/guard";
import { supabaseAdmin } from "@/lib/supabase-server";

/* Delete a workspace that holds nothing but setup — a test sign-up (Grok made
   one through the public form, 2026-10-05, and it took SQL by hand to clear).

   THE DATABASE DECIDES, IN ONE TRANSACTION. `hq_delete_workspace` locks the
   workspace, refuses one the person deleting belongs to, asks the catalogue
   whether any table holds a row for it beyond the setup list, and only then
   logs it to hq_deleted_workspaces and deletes it
   (docs/migrations/hq_delete_workspace.sql). The page offers the button only
   when that check came back empty, but it read the check at page load, and a
   Server Function is reachable by direct POST anyway.

   The typed name is re-checked here: it is the one thing standing between a
   stray click and a workspace there is no restore for.

   The logins are not touched; they are Auth0's. What comes back is the
   addresses that now belong to no workspace, so the screen can say which ones
   are left to delete there. */

export type DeleteWorkspaceResult =
  | { ok: true; logins: string[] }
  | { ok: false; error: string };

export async function deleteWorkspace(
  orgId: string,
  typedName: string
): Promise<DeleteWorkspaceResult> {
  const { email, userId } = await requireHq();

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return { ok: false, error: "That workspace is already gone." };
  if (typedName.trim() !== String(org.name).trim()) {
    return { ok: false, error: "The name doesn't match." };
  }

  // read before the delete takes the seats: who this was the only seat for
  const { data: seats } = await supabaseAdmin
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId);
  const userIds = (seats ?? []).map((s) => String(s.user_id));
  const { data: elsewhere } = userIds.length
    ? await supabaseAdmin
        .from("memberships")
        .select("user_id")
        .in("user_id", userIds)
        .neq("org_id", orgId)
    : { data: [] };
  const kept = new Set((elsewhere ?? []).map((s) => String(s.user_id)));
  const orphans = userIds.filter((id) => !kept.has(id));
  const { data: profiles } = orphans.length
    ? await supabaseAdmin.from("profiles").select("user_id, email").in("user_id", orphans)
    : { data: [] };
  const emailOf = new Map((profiles ?? []).map((p) => [String(p.user_id), p.email as string | null]));
  const logins = orphans.map((id) => emailOf.get(id) ?? id);

  const { data, error } = await supabaseAdmin.rpc("hq_delete_workspace", {
    p_org: orgId,
    p_actor: userId,
    p_actor_email: email,
  });
  if (error) return { ok: false, error: "Couldn't delete it." };
  switch (data as string) {
    case "deleted":
      revalidatePath("/hq");
      return { ok: true, logins };
    case "own":
      return { ok: false, error: "You belong to this workspace, so it can't be deleted from here." };
    case "in_use":
      return { ok: false, error: "It holds records now, so nothing was deleted." };
    case "not_found":
      return { ok: false, error: "That workspace is already gone." };
    default:
      return { ok: false, error: "Couldn't delete it." };
  }
}
