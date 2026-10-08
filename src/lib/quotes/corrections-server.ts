import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { correctionsFrom, type ChangeRow, type Correction } from "./corrections";
import { namesBySignIn } from "./lines-server";

/* Corrections, read (corrections.ts says what one is): the business's line
   history, each job's kind from its ServiceM8 category, and who each person
   is by name. Reads only. Service role, by org; callers gate. */

const MAX_READ = 3000;

/** Each job's ServiceM8 category name, by job. */
async function kindsOf(orgId: string, jobs: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (jobs.length === 0) return out;
  const { data } = await supabaseAdmin.from("sm8_jobs").select("uuid, category_uuid").eq("org_id", orgId).in("uuid", jobs.slice(0, 500));
  const rows = (data ?? []) as { uuid: string; category_uuid: string | null }[];
  const cats = [...new Set(rows.map((r) => r.category_uuid).filter((c): c is string => !!c))];
  const { data: named } = cats.length ? await supabaseAdmin.from("sm8_categories").select("uuid, name").eq("org_id", orgId).in("uuid", cats) : { data: [] };
  const name = new Map(((named ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid, c.name]));
  for (const r of rows) out.set(r.uuid, r.category_uuid ? (name.get(r.category_uuid) ?? null) : null);
  return out;
}

/** The business's corrections, newest first: on one kind of job when it's
    named, else every kind. */
export async function readCorrections(orgId: string, opts: { kind?: string | null; limit?: number } = {}): Promise<Correction[]> {
  const { data } = await supabaseAdmin
    .from("quote_line_changes")
    .select("line_id, sm8_job_uuid, action, before, after, why, made_by, made_at")
    .eq("org_id", orgId)
    .order("made_at", { ascending: false })
    .limit(MAX_READ);
  const rows: ChangeRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    lineId: String(r.line_id),
    job: String(r.sm8_job_uuid),
    action: r.action as ChangeRow["action"],
    before: (r.before as Record<string, unknown> | null) ?? null,
    after: (r.after as Record<string, unknown> | null) ?? null,
    why: String(r.why ?? ""),
    madeBy: String(r.made_by),
    madeAt: String(r.made_at),
  }));
  const jobs = [...new Set(rows.filter((r) => r.madeBy !== "tiff").map((r) => r.job))];
  const all = correctionsFrom(rows, await kindsOf(orgId, jobs));
  const picked = (opts.kind ? all.filter((c) => c.kind === opts.kind) : all).slice(0, opts.limit ?? 30);
  const names = await namesBySignIn(orgId, [...new Set(picked.map((c) => c.by))]);
  return picked.map((c) => ({ ...c, by: names[c.by] ?? "Someone" }));
}

/** One job's kind, for her to read the corrections made on its kind. */
export async function jobKind(orgId: string, job: string): Promise<string | null> {
  return (await kindsOf(orgId, [job])).get(job) ?? null;
}
