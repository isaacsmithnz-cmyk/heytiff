import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bookedVisits, type Activity } from "./built-from";

export type BookedVisitRead = { day: string; who: string; minutes: number };

/** The job's past bookings that were visits (built-from.ts), each with who
    went. Visits only, never money. */
export async function readBookedVisits(orgId: string, jobUuid: string, today: string): Promise<BookedVisitRead[]> {
  const [acts, photos, notes] = await Promise.all([
    supabaseAdmin.from("sm8_job_activities").select("start_date, end_date, staff_uuid, activity_was_scheduled").eq("org_id", orgId).eq("active", 1).eq("job_uuid", jobUuid),
    supabaseAdmin.from("sm8_attachments").select("created_by_staff_uuid, timestamp").eq("org_id", orgId).eq("active", 1).eq("related_object_uuid", jobUuid).limit(2000),
    supabaseAdmin.from("sm8_job_notes").select("edit_by_staff_uuid, create_date").eq("org_id", orgId).eq("active", 1).eq("related_object_uuid", jobUuid).limit(2000),
  ]);
  const marks = [
    ...((photos.data ?? []) as { created_by_staff_uuid: string | null; timestamp: string | null }[]).map((p) => ({ by: p.created_by_staff_uuid, at: p.timestamp })),
    ...((notes.data ?? []) as { edit_by_staff_uuid: string | null; create_date: string | null }[]).map((n) => ({ by: n.edit_by_staff_uuid, at: n.create_date })),
  ];
  const found = bookedVisits((acts.data ?? []) as Activity[], marks, today);
  if (found.length === 0) return [];
  const { data: staff } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last")
    .eq("org_id", orgId)
    .in("uuid", [...new Set(found.map((f) => f.staffId))]);
  const names = new Map(((staff ?? []) as { uuid: string; first: string | null; last: string | null }[]).map((s) => [s.uuid, [s.first, s.last].filter(Boolean).join(" ").trim()]));
  return found.map((f) => ({ day: f.day, who: names.get(f.staffId) || "Someone", minutes: f.minutes }));
}
