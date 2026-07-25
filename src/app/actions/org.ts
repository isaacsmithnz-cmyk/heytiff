"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { refIsOrgs } from "@/lib/documents/files";
import { deleteDocument } from "./documents";
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

/** `fields` marks WHICH input was rejected, like the staff card's actions. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

const NOT_OWNER = "Only an owner can change organisation settings.";

/** The one owner gate. Every write in this file and in org-credentials.ts
    passes through the same three checks, in the same order. */
async function ownerOrgId(): Promise<{ orgId: string } | { error: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId };
}

export async function saveOrgSection(
  section: string,
  fields: Record<string, string>
): Promise<SaveResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { orgId } = ctx;

  if (!isOrgSection(section)) {
    return { ok: false, error: "That section can't be edited here." };
  }

  const { patch, invalid } = buildOrgPatch(section, Object.entries(fields ?? {}));
  if (invalid.length) {
    return { ok: false, error: "Check the date format — use dd/mm/yyyy.", fields: invalid };
  }

  // ABN/ACN are validated, not just stored — a typo'd ABN on an invoice is a
  // real-world problem, and the checksum catches it at entry.
  if (typeof patch.abn === "string") {
    if (!isValidAbn(patch.abn)) {
      return {
        ok: false,
        error: "That ABN doesn't check out — it should be 11 digits.",
        fields: ["abn"],
      };
    }
    patch.abn = normalizeAbn(patch.abn);
  }
  if (typeof patch.acn === "string" && !isValidAcn(patch.acn)) {
    return { ok: false, error: "An ACN is 9 digits.", fields: ["acn"] };
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

/* ---------------------------------------------------------------------------
   The logo.

   organizations.logo_url holds a storage REF, never a URL: the bucket is
   private, so a link is minted per request (lib/documents/query.ts::signOne)
   and expires. Storing a signed URL would mean storing something that stops
   working, and something anybody who kept it could keep using.

   The upload itself already happened — the browser asked for a slot, PUT the
   bytes and confirmed them (lib/documents/upload-client.ts). All this does is
   POINT the org at a document, which is why it re-checks everything about that
   document rather than trusting the id it was handed: a Server Function is
   reachable by direct POST, so "the picker only offered your own upload" is not
   a control. Wrong org, wrong kind or an unconfirmed upload are all refused.
   --------------------------------------------------------------------------- */

export async function setOrgLogo(documentId: string): Promise<SaveResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { orgId } = ctx;

  const { data } = await supabaseAdmin
    .from("documents")
    .select("kind, storage_ref, uploaded_at")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That upload no longer exists." };
  if (data.kind !== "org_logo") return { ok: false, error: "That file isn't a logo." };
  if (!data.uploaded_at) return { ok: false, error: "That upload didn't finish." };

  const ref = String(data.storage_ref);
  if (!refIsOrgs(ref, orgId)) {
    return { ok: false, error: "That file doesn't belong to this organisation." };
  }

  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ logo_url: ref, updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) return { ok: false, error: "Couldn't save that logo." };

  revalidatePath("/dashboard/admin/organization");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Take the logo off the org, and take the file with it — an object nothing
    points at is invisible everywhere and still billable. The column is cleared
    FIRST because that is the part the owner can see; the file delete follows,
    and a failure there leaves rubbish rather than a broken image. */
export async function clearOrgLogo(): Promise<SaveResult> {
  const ctx = await ownerOrgId();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { orgId } = ctx;

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("logo_url")
    .eq("id", orgId)
    .maybeSingle();
  const ref = (org?.logo_url as string) ?? null;
  if (!ref) return { ok: true };

  const { error } = await supabaseAdmin
    .from("organizations")
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) return { ok: false, error: "Couldn't remove that logo." };

  const { data: doc } = await supabaseAdmin
    .from("documents")
    .select("id")
    .eq("org_id", orgId)
    .eq("storage_ref", ref)
    .maybeSingle();
  if (doc?.id) await deleteDocument(String(doc.id));

  revalidatePath("/dashboard/admin/organization");
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
