"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import {
  asKbCategory,
  checkKbUpload,
  KB_BUCKET,
  kbRefIsOrgs,
  kbStorageRef,
  kbTitle,
} from "@/lib/tiff/files";
import { signKbRef } from "@/lib/tiff/query";

/* The knowledge base's writes — upload, describe, retry, remove.

   THE BYTES NEVER PASS THROUGH A SERVER ACTION, same as every other upload in
   the app: the client asks for a slot, we mint a signed upload token, the
   browser PUTs the PDF straight to the private `kb` bucket, and then tells us
   it landed. A 40 MB manual would not survive an action body anyway.

   THE ROW COMES FIRST, because the row's id IS the object key — so there is
   never a file in the bucket that no row points at. The opposite is possible
   (a row whose upload was abandoned) and that is the harmless direction:
   `uploaded_at` stays null and every read filters it out.

   EVERY ACTION NAMES `tiff_manage`. Server Functions are reachable by direct
   POST, so the gate on the screen is not a gate — this is. Deleting goes
   further and asks for the owner, because a document is what answers are
   quoted from and removing one silently changes what the whole company is
   told. requireOrg THROWS; it is caught and returned as a result, because an
   action that throws reaches the browser as an opaque digest and the library
   needs a sentence to show. */

export type KbSlot =
  | { ok: true; documentId: string; ref: string; token: string; bucket: string }
  | { ok: false; error: string };

export type KbResult = { ok: true } | { ok: false; error: string };

const NO_MANAGE = "You don't have access to manage the knowledge base.";
const GONE = "That document is no longer here.";

const TITLE_MAX = 160;
const SOURCE_MAX = 120;

type Ctx = { orgId: string; userId: string };

async function ctx(): Promise<Ctx | null> {
  try {
    return await requireOrg("tiff_manage");
  } catch {
    return null;
  }
}

/* Both Tiff screens read the library — the assistant for its category counts,
   the library for the rows themselves. There is no per-document route to
   revalidate; a document is a row on the library page. */
function refresh() {
  revalidatePath("/dashboard/tiff");
  revalidatePath("/dashboard/tiff/knowledge");
}

const trim = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[\r\n\t]/g, " ");
  return s ? s.slice(0, max) : null;
};

/* A link to the file itself, minted per click.

   THE ONE ACTION IN THIS FILE GATED `tiff`, NOT `tiff_manage`. Reading the
   library is the staff tier — that is the whole point of the knowledge base —
   and opening a document is reading. Nothing here writes.

   Signed on demand rather than at render: the bucket is private, links expire,
   and a hundred-document library would otherwise mint a hundred URLs nobody
   clicks on every page load. */
export async function kbDocUrl(
  documentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let orgId: string;
  try {
    ({ orgId } = await requireOrg("tiff"));
  } catch {
    return { ok: false, error: "You don't have access to the knowledge base." };
  }

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("storage_ref")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: GONE };

  const ref = String(data.storage_ref ?? "");
  if (!ref || !kbRefIsOrgs(ref, orgId))
    return { ok: false, error: "That file doesn't belong to this organisation." };

  const url = await signKbRef(ref);
  if (!url) return { ok: false, error: "That file couldn't be opened." };
  return { ok: true, url };
}

/** Ask for somewhere to put a manual. Returns a signed slot, or a reason. */
export async function beginKbUpload(input: {
  title: string;
  category: string;
  source?: string;
  edition?: string;
  mime: string;
  sizeBytes: number;
}): Promise<KbSlot> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const category = asKbCategory(input.category);
  if (!category) return { ok: false, error: "Pick a category for that document." };

  const title = trim(input.title, TITLE_MAX);
  if (!title) return { ok: false, error: "Give that document a title." };

  // the browser checks the same two rules before it offers to upload; this is
  // the one that counts, and the bucket carries the numbers a third time
  const check = checkKbUpload({ type: String(input.mime ?? ""), size: Number(input.sizeBytes) });
  if (!check.ok) return { ok: false, error: check.error };

  const staffId = await staffProfileIdFor(c.orgId, c.userId);

  const { data, error } = await supabaseAdmin
    .from("kb_documents")
    .insert({
      org_id: c.orgId,
      category,
      title: kbTitle(title),
      source: trim(input.source, SOURCE_MAX),
      edition: trim(input.edition, SOURCE_MAX),
      kind: "PDF",
      mime_type: "application/pdf",
      size_bytes: Math.trunc(Number(input.sizeBytes)),
      status: "uploading",
      uploaded_by: staffId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't start that upload." };

  const documentId = String(data.id);
  const ref = kbStorageRef(c.orgId, documentId);

  const { error: refErr } = await supabaseAdmin
    .from("kb_documents")
    .update({ storage_ref: ref, updated_at: new Date().toISOString() })
    .eq("org_id", c.orgId)
    .eq("id", documentId);
  if (refErr) return { ok: false, error: "Couldn't start that upload." };

  const { data: slot, error: slotErr } = await supabaseAdmin.storage
    .from(KB_BUCKET)
    .createSignedUploadUrl(ref);
  if (slotErr || !slot) {
    // no bytes were ever written, so the row is the only thing to clean up
    await supabaseAdmin.from("kb_documents").delete().eq("org_id", c.orgId).eq("id", documentId);
    return { ok: false, error: "Couldn't start that upload." };
  }

  return { ok: true, documentId, ref, token: slot.token, bucket: KB_BUCKET };
}

/* The browser reporting that the bytes landed. Until this runs the row is
   invisible in the library, so a cancelled upload leaves nothing on anyone's
   screen — and `processing` is what tells the ingest loop it has work. */
export async function confirmKbUpload(documentId: string): Promise<KbResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("storage_ref, status")
    .eq("org_id", c.orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That upload no longer exists." };

  const ref = String(data.storage_ref ?? "");
  if (!ref || !kbRefIsOrgs(ref, c.orgId))
    return { ok: false, error: "That file doesn't belong to this organisation." };

  const { error } = await supabaseAdmin
    .from("kb_documents")
    .update({
      uploaded_at: new Date().toISOString(),
      status: "processing",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", c.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't finish that upload." };

  refresh();
  return { ok: true };
}

/** Fix a title, a brand, an edition, or which shelf it sits on. */
export async function updateKbDocMeta(
  documentId: string,
  input: { title?: string; category?: string; source?: string; edition?: string }
): Promise<KbResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const patch: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = trim(input.title, TITLE_MAX);
    if (!title) return { ok: false, error: "Give that document a title." };
    patch.title = kbTitle(title);
  }
  if (input.category !== undefined) {
    const category = asKbCategory(input.category);
    if (!category) return { ok: false, error: "That isn't one of the categories." };
    patch.category = category;
  }
  // an empty string clears the field; absent leaves it alone
  if (input.source !== undefined) patch.source = trim(input.source, SOURCE_MAX);
  if (input.edition !== undefined) patch.edition = trim(input.edition, SOURCE_MAX);

  if (Object.keys(patch).length === 0) return { ok: true };
  patch.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("kb_documents")
    .update(patch)
    .eq("org_id", c.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't save that." };

  refresh();
  return { ok: true };
}

/* Try again, from the bookmark.

   `next_page` is deliberately NOT reset: a manual that failed on page 240 has
   239 pages of chunks already stored and paid for, and re-reading them would
   duplicate every one. A paused document goes back to processing too — the
   allowance is re-checked inside the loop, so this is a request to look again
   rather than a claim that there is room. */
export async function retryKbDoc(documentId: string): Promise<KbResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("status, storage_ref")
    .eq("org_id", c.orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: GONE };

  const status = String(data.status);
  if (status !== "failed" && status !== "paused")
    return { ok: false, error: "That document isn't stopped." };
  if (!data.storage_ref) return { ok: false, error: "That document has no file." };

  const { error } = await supabaseAdmin
    .from("kb_documents")
    .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
    .eq("org_id", c.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't restart that document." };

  refresh();
  return { ok: true };
}

/* Remove a manual. OWNER ONLY, on top of tiff_manage.

   A document in the library is what answers get quoted from, so deleting one
   changes what the whole company is told — quietly, and with no way to notice
   afterwards. That is the same reasoning that makes the org logo owner-only in
   documents.ts, and the opposite of the workboard, where the people doing the
   work manage their own rows.

   The object goes FIRST: an orphaned object is invisible and still billable,
   whereas an orphaned row would be a library entry pointing at nothing. The
   chunks follow the row by cascade, and kb_usage is deliberately untouched —
   those pages were still processed. */
export async function deleteKbDoc(documentId: string): Promise<KbResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };
  if (!hasMinRole(await getDbRole(), "owner"))
    return { ok: false, error: "Only the owner can remove a document." };

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("storage_ref")
    .eq("org_id", c.orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That document is already gone." };

  const ref = String(data.storage_ref ?? "");
  if (ref && !kbRefIsOrgs(ref, c.orgId))
    return { ok: false, error: "That file doesn't belong to this organisation." };
  if (ref) await supabaseAdmin.storage.from(KB_BUCKET).remove([ref]);

  const { error } = await supabaseAdmin
    .from("kb_documents")
    .delete()
    .eq("org_id", c.orgId)
    .eq("id", documentId);
  if (error) return { ok: false, error: "Couldn't remove that document." };

  refresh();
  return { ok: true };
}
