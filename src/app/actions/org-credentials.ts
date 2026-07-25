"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { buildOrgCredentialRow, type OrgCredentialInput } from "@/lib/org/credentials";

/* The business's own licences and insurance policies.

   Owner-only, exactly like saveOrgSection — these are the company's papers, not
   a staff record, and a delegated admin has no business editing what the
   business is licensed to do. A Server Function is reachable by direct POST, so
   the role is re-checked here on every call and every write carries `.eq(
   "org_id", orgId)` — an id from the client can only ever address a row in the
   caller's own org.

   UPDATE exists here, unlike staff licences, because these cards are EDITED:
   a policy renews and the expiry moves, where a staff ticket is replaced. */

export type CredResult = { ok: true } | { ok: false; error: string };

const NOT_OWNER = "Only an owner can change organisation settings.";
const TABLE = "org_credentials";

async function ownerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId };
}

/* The org page shows the cards; the dashboard shows the expiry chip that comes
   off them. Both are revalidated, so a renewed policy stops nagging the whole
   team on the next render rather than at the next deploy. */
function revalidate() {
  revalidatePath("/dashboard/admin/organization");
  revalidatePath("/dashboard");
}

export async function addOrgCredential(input: OrgCredentialInput): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const built = buildOrgCredentialRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .insert({ org_id: ctx.orgId, ...built.row });
  if (error) return { ok: false, error: "Couldn't add that." };

  revalidate();
  return { ok: true };
}

export async function updateOrgCredential(
  id: string,
  input: OrgCredentialInput
): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const built = buildOrgCredentialRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ ...built.row, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't save that." };

  revalidate();
  return { ok: true };
}

export async function removeOrgCredential(id: string): Promise<CredResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that." };

  revalidate();
  return { ok: true };
}
