import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { versionOf, type QuoteVersion, type VersionOption } from "./quote-versions";

/* A QUOTE'S PAST VERSIONS (quote-versions.ts says why): read newest first,
   and kept once, numbered. Service role, by org; the callers gate. */

const KEPT = 20;

export async function readVersions(orgId: string, cardId: string): Promise<QuoteVersion[]> {
  const { data } = await supabaseAdmin
    .from("quote_versions")
    .select("n, what, snapshot, approved_at, made_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .order("n", { ascending: false })
    .limit(KEPT);
  return ((data as Record<string, unknown>[] | null) ?? []).map(versionOf);
}

/** Keeps version `n`; refused when one by that number was kept meanwhile. */
export async function keepVersion(
  orgId: string,
  cardId: string,
  v: { n: number; what: string; options: VersionOption[]; approvedAt: string | null; approvedBy: string | null },
  by: string
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { data, error } = await supabaseAdmin
    .from("quote_versions")
    .insert({ org_id: orgId, sm8_job_uuid: cardId, n: v.n, what: v.what, snapshot: { options: v.options }, approved_at: v.approvedAt, approved_by: v.approvedBy, made_by: by })
    .select("id")
    .single();
  if (error || !data) return { ok: false, reason: "The quote changed as you pressed it. Try again." };
  return { ok: true, id: (data as { id: string }).id };
}

/** A kept version taken back: what keeping it was for didn't happen. */
export async function dropVersion(orgId: string, id: string) {
  await supabaseAdmin.from("quote_versions").delete().eq("org_id", orgId).eq("id", id);
}
