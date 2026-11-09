import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { applyOps, owedOf, type Owed, type WrapOp, type WrapRow } from "./wrapups";

/* The days owed a wrap-up as day_wrapups keeps them (docs/migrations/
   day_wrapups.sql): one row per person per day, settled, never deleted. */

type Row = { work_date: string; jobs: unknown; done: unknown; noted: unknown; settled_at: string | null };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const rowOf = (r: Row): WrapRow => ({ on: r.work_date, jobs: strings(r.jobs), done: strings(r.done), noted: strings(r.noted), settled: !!r.settled_at });

/** Every day the person still owes, oldest first. */
export async function readOwedDays(orgId: string, userId: string): Promise<Owed[]> {
  const { data, error } = await supabaseAdmin
    .from("day_wrapups")
    .select("work_date, jobs, done, noted, settled_at")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .is("settled_at", null)
    .order("work_date", { ascending: true })
    .limit(60);
  if (error) throw new Error("Couldn't read the days to wrap up.");
  return owedOf(((data ?? []) as Row[]).map(rowOf));
}

/** The phone's ops, in order, then every day still owed. */
export async function applyWrapOps(orgId: string, userId: string, ops: readonly WrapOp[], at = new Date()): Promise<Owed[]> {
  const days = [...new Set(ops.map((o) => o.on))];
  if (days.length) {
    const { data, error } = await supabaseAdmin
      .from("day_wrapups")
      .select("work_date, jobs, done, noted, settled_at")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .in("work_date", days);
    if (error) throw new Error("Couldn't read the days to wrap up.");
    const before = new Map(((data ?? []) as Row[]).map((r) => [r.work_date, rowOf(r)]));
    const settledAt = new Map(((data ?? []) as Row[]).map((r) => [r.work_date, r.settled_at]));
    const after = applyOps(before, ops);
    const stamp = at.toISOString();
    const rows = [...after.values()].map((r) => {
      const was = before.get(r.on);
      const owedAgain = !was || (was.settled && !r.settled);
      return {
        org_id: orgId,
        user_id: userId,
        work_date: r.on,
        jobs: r.jobs,
        done: r.done,
        noted: r.noted,
        updated_at: stamp,
        ...(owedAgain ? { owed_at: stamp } : {}),
        /* a day settled before keeps when it was */
        settled_at: r.settled ? (was?.settled ? (settledAt.get(r.on) ?? stamp) : stamp) : null,
      };
    });
    if (rows.length) {
      const { error: put } = await supabaseAdmin.from("day_wrapups").upsert(rows, { onConflict: "org_id,user_id,work_date" });
      if (put) throw new Error("Couldn't keep the days to wrap up.");
    }
  }
  return readOwedDays(orgId, userId);
}
