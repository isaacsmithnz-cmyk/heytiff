"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole, requireOrg } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { normaliseLetterInput, type LetterInput } from "@/lib/letters/letter";
import { loadLetter, mayOpenLetter, type LetterViewer } from "@/lib/letters/query";

/* WRITING A LETTER — Admin → Letters, so admin and up, like the rest of the
   section. A letter is seen and changed by whoever wrote it, whoever signs
   it, and the owner (lib/letters/query, mayOpenLetter).

   A SIGNATURE IS THE SIGNER'S OWN MARK. It goes on only when the signer
   saves the letter themselves; a save by anyone else takes it off, so a
   signature never sits under words its owner didn't see.

   Server Functions are reachable by direct POST, so each one re-checks for
   itself, and every id from a browser is re-resolved in this org. Nothing
   here throws: the editor says what went wrong in words. */

export type LetterSaveResult = { ok: true; id: string; updatedAt: string; withSignature: boolean } | { ok: false; error: string };
export type LetterResult = { ok: true } | { ok: false; error: string };

async function context(): Promise<(LetterViewer & { orgId: string }) | string> {
  try {
    const { orgId, userId } = await requireOrg();
    const role = await getDbRole();
    if (!hasMinRole(role, "admin")) return "Letters are in Admin, for admins and the owner.";
    return { orgId, staffId: await staffIdFor(orgId, userId), isOwner: hasMinRole(role, "owner") };
  } catch {
    return "Sign in to write letters.";
  }
}

export async function saveLetter(raw: unknown): Promise<LetterSaveResult> {
  const ctx = await context();
  if (typeof ctx === "string") return { ok: false, error: ctx };
  const input: LetterInput = normaliseLetterInput(raw);

  if (input.signerStaffId) {
    const { data } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", ctx.orgId).eq("id", input.signerStaffId).maybeSingle();
    if (!data) return { ok: false, error: "That signer isn't on this workspace's staff." };
  }
  const withSignature = input.withSignature && !!input.signerStaffId && input.signerStaffId === ctx.staffId;
  const now = new Date().toISOString();
  const row = {
    title: input.title,
    letter_date: input.date || null,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    signer_staff_id: input.signerStaffId,
    with_signature: withSignature,
    updated_by_staff_id: ctx.staffId,
    updated_at: now,
  };

  if (input.id) {
    const existing = await loadLetter(ctx.orgId, input.id);
    if (!existing) return { ok: false, error: "That letter is gone. Copy what you need and start a new one." };
    if (!mayOpenLetter(existing, ctx)) return { ok: false, error: "Only whoever wrote it, whoever signs it, or the owner can change this letter." };
    const { error } = await supabaseAdmin.from("letters").update(row).eq("org_id", ctx.orgId).eq("id", input.id);
    if (error) return { ok: false, error: "Couldn't save the letter. Try again." };
    revalidatePath("/dashboard/admin/letters");
    return { ok: true, id: input.id, updatedAt: now, withSignature };
  }

  const { data, error } = await supabaseAdmin
    .from("letters")
    .insert({ org_id: ctx.orgId, created_by_staff_id: ctx.staffId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save the letter. Try again." };
  revalidatePath("/dashboard/admin/letters");
  return { ok: true, id: (data as { id: string }).id, updatedAt: now, withSignature };
}

export async function deleteLetter(id: string): Promise<LetterResult> {
  const ctx = await context();
  if (typeof ctx === "string") return { ok: false, error: ctx };
  const letterId = String(id ?? "").trim().slice(0, 80);
  const existing = letterId ? await loadLetter(ctx.orgId, letterId) : null;
  if (!existing) return { ok: false, error: "That letter is already gone." };
  if (!mayOpenLetter(existing, ctx)) return { ok: false, error: "Only whoever wrote it, whoever signs it, or the owner can delete this letter." };
  const { error } = await supabaseAdmin.from("letters").delete().eq("org_id", ctx.orgId).eq("id", letterId);
  if (error) return { ok: false, error: "Couldn't delete the letter. Try again." };
  revalidatePath("/dashboard/admin/letters");
  return { ok: true };
}
