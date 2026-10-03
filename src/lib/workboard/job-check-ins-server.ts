import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { ourSessions, sameName, type CheckInPerson, type CheckInRow, type OurSession } from "./job-check-ins";

/* The job's check-ins pressed on the card, as sessions, with who each person
   is: their linked ServiceM8 staff member, else the one with the same full
   name, else themselves. Server only; the card reads it inside its one job
   read. */
export async function readJobCheckInSessions(
  orgId: string,
  jobUuid: string,
  timezone: string | null,
  now: Date
): Promise<{ sessions: OurSession[]; names: Map<string, string> }> {
  const { data } = await supabaseAdmin
    .from("job_check_ins")
    .select("id, user_id, checked_in_at, checked_out_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("checked_in_at", { ascending: true });
  const rows: CheckInRow[] = ((data ?? []) as { id: string; user_id: string; checked_in_at: string; checked_out_at: string | null }[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    inAt: r.checked_in_at,
    outAt: r.checked_out_at,
  }));
  if (rows.length === 0) return { sessions: [], names: new Map() };

  const people = await checkInPeople(orgId, [...new Set(rows.map((r) => r.userId))]);
  const sessions = ourSessions(rows, people, timezone, now);
  const names = new Map<string, string>();
  for (const [userId, p] of people) if (!p.sm8StaffUuid) names.set(`hey:${userId}`, p.name);
  return { sessions, names };
}

/** Each user as a name and, where known, the ServiceM8 staff member they are. */
export async function checkInPeople(orgId: string, userIds: string[]): Promise<Map<string, CheckInPerson>> {
  const out = new Map<string, CheckInPerson>();
  if (userIds.length === 0) return out;
  const [{ data: profiles }, { data: links }, { data: staff }] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("id, user_id, first_name, last_name").eq("org_id", orgId).in("user_id", userIds),
    supabaseAdmin.from("integration_links").select("staff_profile_id, remote_id").eq("org_id", orgId).eq("provider", "servicem8").eq("kind", "staff"),
    supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", orgId),
  ]);
  const linked = new Map(((links ?? []) as { staff_profile_id: string | null; remote_id: string | null }[]).filter((l) => l.staff_profile_id && l.remote_id).map((l) => [l.staff_profile_id!, l.remote_id!]));
  const sm8 = ((staff ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((s) => ({
    uuid: s.uuid,
    name: [s.first, s.last].filter(Boolean).join(" ").trim(),
  }));
  for (const p of (profiles ?? []) as { id: string; user_id: string; first_name: string | null; last_name: string | null }[]) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || "Someone";
    const byName = sm8.filter((s) => sameName(s.name, name));
    out.set(p.user_id, { name, sm8StaffUuid: linked.get(p.id) ?? (byName.length === 1 ? byName[0]!.uuid : null) });
  }
  for (const id of userIds) if (!out.has(id)) out.set(id, { name: "Someone", sm8StaffUuid: null });
  return out;
}
