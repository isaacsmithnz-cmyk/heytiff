import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { inChunks } from "@/lib/in-chunks";

/* A CHECK-IN LEFT ON, FIXED: when a ServiceM8 check-in really ended, said in
   HeyTiff (docs/migrations/check_in_fixes.sql). Read over the mirror
   wherever recorded time is counted, so the job card, its visits and the
   phone's actual time all count the fixed hours. ServiceM8 is unchanged. */

/** The fixes for these ServiceM8 activities, by lower-cased uuid: their new ends. */
export async function readCheckInFixes(orgId: string, activityUuids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(activityUuids.filter(Boolean).flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))];
  if (!ids.length) return out;
  /* in pieces: a big job's check-ins, each in three spellings, would run past the URL's limit */
  const rows = await inChunks(ids, 150, async (chunk) => {
    const { data } = await supabaseAdmin.from("check_in_fixes").select("sm8_activity_uuid, ends_at").eq("org_id", orgId).in("sm8_activity_uuid", chunk);
    return (data ?? []) as { sm8_activity_uuid: string; ends_at: string }[];
  });
  for (const r of rows) out.set(r.sm8_activity_uuid.toLowerCase(), r.ends_at);
  return out;
}

/** A row with its fixed end, where it has one. */
export const withFix = <T extends { uuid?: string; end_date: string | null }>(row: T, fixes: Map<string, string>): T => {
  const end = row.uuid ? fixes.get(row.uuid.toLowerCase()) : undefined;
  return end ? { ...row, end_date: end } : row;
};

/** A fixed end is a time on the day the check-in began, after it began, no more than a working day later. */
export function fixedEndOk(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(end) || end.slice(0, 10) !== start.slice(0, 10) || end <= start) return false;
  const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  return mins(end) - mins(start) <= 12 * 60;
}
