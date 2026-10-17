import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { draftBodyOf, type DraftBox } from "./drafts";

/* A person's unsent words in a reply box (drafts.ts says why). Service role,
   by org and sign-in: a draft is only ever its writer's. The callers gate. */

export type DraftKey = { orgId: string; userSub: string; box: DraftBox; ref: string };

/** The draft, or "" when there is none or it can't be read. */
export async function readDraft(k: DraftKey): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("reply_drafts")
    .select("body")
    .eq("org_id", k.orgId)
    .eq("user_sub", k.userSub)
    .eq("box", k.box)
    .eq("ref", k.ref)
    .maybeSingle();
  if (error || !data) return "";
  return typeof data.body === "string" ? data.body : "";
}

/** Keep the words, or remove the draft when they're empty. */
export async function saveDraft(k: DraftKey, text: unknown): Promise<boolean> {
  const body = draftBodyOf(text);
  if (!body) return clearDraft(k);
  const { error } = await supabaseAdmin
    .from("reply_drafts")
    .upsert({ org_id: k.orgId, user_sub: k.userSub, box: k.box, ref: k.ref, body, updated_at: new Date().toISOString() }, { onConflict: "org_id,user_sub,box,ref" });
  return !error;
}

/** The words were sent, or the box emptied: no draft is left behind. */
export async function clearDraft(k: DraftKey): Promise<boolean> {
  const { error } = await supabaseAdmin.from("reply_drafts").delete().eq("org_id", k.orgId).eq("user_sub", k.userSub).eq("box", k.box).eq("ref", k.ref);
  return !error;
}
