"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import {
  buildOrgPatch,
  isOrgSection,
  isValidAbn,
  isValidAcn,
  normalizeAbn,
} from "@/lib/org/settings";

/* Organisation profile persistence. Owner-only — org settings are an
   owner-intrinsic act (co-owners included, unlike billing which is
   master-only). Server Functions are reachable by direct POST, so the role
   and the section are both re-checked here; the section allowlist has no
   path to primary_owner_user_id, name (legacy seed) or any other column. */

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveOrgSection(
  section: string,
  fields: Record<string, string>
): Promise<SaveResult> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");

  if (!hasMinRole(await getDbRole(), "owner")) {
    return { ok: false, error: "Only an owner can change organisation settings." };
  }
  if (!isOrgSection(section)) {
    return { ok: false, error: "That section can't be edited here." };
  }

  const { patch, invalid } = buildOrgPatch(section, Object.entries(fields ?? {}));
  if (invalid.length) {
    return { ok: false, error: "Check the date format — use dd/mm/yyyy." };
  }

  // ABN/ACN are validated, not just stored — a typo'd ABN on an invoice is a
  // real-world problem, and the checksum catches it at entry.
  if (typeof patch.abn === "string") {
    if (!isValidAbn(patch.abn)) {
      return { ok: false, error: "That ABN doesn't check out — it should be 11 digits." };
    }
    patch.abn = normalizeAbn(patch.abn);
  }
  if (typeof patch.acn === "string" && !isValidAcn(patch.acn)) {
    return { ok: false, error: "An ACN is 9 digits." };
  }

  // gst_registered travels as the segmented control's "Yes"/"No" and is a
  // boolean column; convert (null clears).
  const { gst_registered: gstRaw, ...rest } = patch;
  const update: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (gstRaw !== undefined) update.gst_registered = gstRaw === null ? null : gstRaw === "Yes";

  if (Object.keys(update).length === 1) return { ok: true }; // only the timestamp

  const { error } = await supabaseAdmin
    .from("organizations")
    .update(update)
    .eq("id", orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/admin/organization");
  // the sidebar "HeyTiff × trading name" lives in the dashboard layout
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
