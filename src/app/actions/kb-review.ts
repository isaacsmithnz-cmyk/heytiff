"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { staffIdFor } from "@/lib/workboard/projects-query";

/* Curating field-learned knowledge — the "publish first, review after" half
   of Isaac's call (2026-08-06). Entries go live the moment their author ticks
   them; THIS is where an admin later agrees or takes one down.

   ADMIN+, not owner. deleteKbDoc is owner-only because deleting a MANUAL
   changes what the whole company is told from a source someone paid for and
   uploaded on purpose. A field note is a colleague's two sentences, published
   on a tick from a review card — the blast radius of removing a wrong one is
   smaller than the blast radius of leaving it, and making the queue owner-only
   would mean bad advice stays up until Isaac personally logs in. The role
   gate matches the section that hosts the queue.

   Removal never touches kb_usage and never touches storage: a field note has
   no file, and no pages were ever billed for it. The chunks follow the row by
   cascade. */

export type ReviewResult = { ok: true } | { ok: false; error: string };

const NOT_ALLOWED = "Only an admin can curate the library.";
const GONE = "That entry is already gone.";

type Ctx = { orgId: string; staffId: string | null };

async function adminCtx(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  if (!hasMinRole(await getDbRole(), "admin")) return null;
  return { orgId, staffId: await staffIdFor(orgId, userId) };
}

const refresh = () => {
  revalidatePath("/dashboard/admin/knowledge");
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/tiff/knowledge");
};

/** "Looks right" — the entry leaves the queue and stays published. Scoped to
    category 'field' so this endpoint can never stamp a manual. */
export async function markFieldNoteReviewed(documentId: string): Promise<ReviewResult> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const { data, error } = await supabaseAdmin
    .from("kb_documents")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: ctx.staffId })
    .eq("org_id", ctx.orgId)
    .eq("category", "field")
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't mark that as reviewed." };
  if (!data) return { ok: false, error: GONE };
  refresh();
  return { ok: true };
}

/** "That's not right" — the entry comes down. The words survive in the
    workboard note they were spoken into; only the LIBRARY copy goes. */
export async function removeFieldNote(documentId: string): Promise<ReviewResult> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: NOT_ALLOWED };

  const { data, error } = await supabaseAdmin
    .from("kb_documents")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("category", "field")
    .eq("id", documentId)
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: "Couldn't remove that entry." };
  if (!data) return { ok: false, error: GONE };
  refresh();
  return { ok: true };
}
