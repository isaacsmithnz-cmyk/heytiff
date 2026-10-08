"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getDbRole, requireOrg } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { staffIdFor } from "@/lib/workboard/projects-query";
import {
  TEMPLATE_SETTINGS,
  normaliseChecklist,
  normaliseEmail,
  normaliseLetterhead,
  normaliseNotes,
  normaliseTerms,
  templateProblems,
  type TemplateSetting,
} from "@/lib/templates/settings";

/* CHANGING A BUSINESS'S OWN TEMPLATES — the owner's, as the business's other
   settings are. Each save is read back through the same normaliser the
   readers use, so what is stored is what every quote, project and email
   will read. Going back to the standard wording deletes the row. Nothing
   here throws: the editor says what went wrong in words. */

export type TemplateResult = { ok: true } | { ok: false; error: string };

/* the template pages each setting shows on */
const PAGES: Record<TemplateSetting, string[]> = {
  quote_notes: ["quote"],
  payment_terms: ["quote"],
  project_checklist: ["project-checklist", "handover"],
  documents_email: ["documents-email"],
  letterhead: ["letterhead"],
};

function stored(key: TemplateSetting, value: unknown): unknown {
  if (key === "quote_notes") return normaliseNotes(value);
  if (key === "payment_terms") return normaliseTerms(value);
  if (key === "project_checklist") return normaliseChecklist(value);
  if (key === "letterhead") return normaliseLetterhead(value);
  return normaliseEmail(value);
}

async function owner(): Promise<{ orgId: string; userId: string } | string> {
  try {
    const who = await requireOrg();
    if (!hasMinRole(await getDbRole(), "owner")) return "Only the owner can change the business's templates.";
    return who;
  } catch {
    return "Sign in to change the templates.";
  }
}

function refresh(key: TemplateSetting) {
  revalidatePath("/dashboard/admin/templates");
  for (const p of PAGES[key]) revalidatePath(`/dashboard/admin/templates/${p}`);
}

export async function saveTemplate(key: TemplateSetting, value: unknown): Promise<TemplateResult> {
  if (!TEMPLATE_SETTINGS.includes(key)) return { ok: false, error: "That isn't a template." };
  const who = await owner();
  if (typeof who === "string") return { ok: false, error: who };
  const problems = templateProblems(key, value);
  if (problems.length > 0) return { ok: false, error: problems[0] };
  const staffId = await staffIdFor(who.orgId, who.userId);
  const { error } = await supabaseAdmin.from("org_templates").upsert(
    { org_id: who.orgId, key, value: stored(key, value), updated_by_staff_id: staffId, updated_at: new Date().toISOString() },
    { onConflict: "org_id,key" }
  );
  if (error) return { ok: false, error: "Couldn't save it. Try again." };
  refresh(key);
  return { ok: true };
}

/** Back to the standard wording. */
export async function resetTemplate(key: TemplateSetting): Promise<TemplateResult> {
  if (!TEMPLATE_SETTINGS.includes(key)) return { ok: false, error: "That isn't a template." };
  const who = await owner();
  if (typeof who === "string") return { ok: false, error: who };
  const { error } = await supabaseAdmin.from("org_templates").delete().eq("org_id", who.orgId).eq("key", key);
  if (error) return { ok: false, error: "Couldn't put it back. Try again." };
  refresh(key);
  return { ok: true };
}
