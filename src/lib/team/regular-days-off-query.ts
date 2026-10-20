/* Regular days off, read (server only). The table may not exist yet
   (docs/migrations/staff_regular_days_off.sql, applied at the switch-over at
   the latest): a read that fails returns nothing, and every screen says what
   it said before. NO SESSION HERE: callers gate. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { RegularDayOff } from "./regular-days-off";

export const RDO_TABLE = "staff_regular_days_off";

type Row = {
  id: string;
  staff_profile_id: string;
  reason: string;
  weekdays: number[] | null;
  every_weeks: number | null;
  from_date: string;
  to_date: string | null;
  part_from: string | null;
  part_to: string | null;
  skip_dates: string[] | null;
};

export const RDO_COLUMNS = "id, staff_profile_id, reason, weekdays, every_weeks, from_date, to_date, part_from, part_to, skip_dates";

export function ruleOf(r: Row): RegularDayOff {
  return {
    id: r.id,
    staffProfileId: r.staff_profile_id,
    reason: r.reason,
    weekdays: (r.weekdays ?? []).map(Number),
    everyWeeks: r.every_weeks === 2 ? 2 : 1,
    fromDate: r.from_date,
    toDate: r.to_date,
    partFrom: r.part_from,
    partTo: r.part_to,
    skipDates: r.skip_dates ?? [],
  };
}

/** Every rule in the org, or one person's. */
export async function readRegularDaysOff(orgId: string, staffProfileId?: string): Promise<RegularDayOff[]> {
  try {
    let q = supabaseAdmin.from(RDO_TABLE).select(RDO_COLUMNS).eq("org_id", orgId);
    if (staffProfileId) q = q.eq("staff_profile_id", staffProfileId);
    const { data, error } = await q.order("from_date", { ascending: true });
    if (error) return [];
    return ((data ?? []) as Row[]).map(ruleOf);
  } catch {
    return [];
  }
}

/** HeyTiff person → their ServiceM8 staff uuid, through the staff links. */
export async function sm8StaffByProfile(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("integration_links")
    .select("staff_profile_id, remote_id")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .eq("kind", "staff");
  return new Map(
    ((data ?? []) as { staff_profile_id: string | null; remote_id: string | null }[])
      .filter((l): l is { staff_profile_id: string; remote_id: string } => !!l.staff_profile_id && !!l.remote_id)
      .map((l) => [l.staff_profile_id, l.remote_id]),
  );
}
