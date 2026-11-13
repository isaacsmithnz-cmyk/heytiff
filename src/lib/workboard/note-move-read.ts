import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { streetLine } from "@/lib/studio/job-link";
import type { MoveBooking } from "./note-move";

/* THE BOOKINGS A MOVE IS LOOKED FOR AMONG (note-move): one person's, from
   today to a fortnight out, as ServiceM8's mirror has them, each with the
   words it can be named by — its job's number, client, street and suburb. */

/** How far ahead a booking is looked for. */
export const MOVE_DAYS = 14;

const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];
const dayAfter = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The ServiceM8 staff member on this staff card, by their link. */
export async function sm8StaffOfCard(orgId: string, staffProfileId: string): Promise<string | null> {
  const state = await readSm8WriteState(orgId).catch(() => null);
  if (!state?.tenantId) return null;
  const links = await listSm8StaffLinks(orgId, state.tenantId).catch(() => []);
  return links.find((l) => l.staffProfileId === staffProfileId)?.remoteId ?? null;
}

/** Their coming bookings, soonest first. Null when the mirror couldn't be read. */
export async function comingBookingsOf(orgId: string, staffUuid: string, staffName: string, today: string): Promise<MoveBooking[] | null> {
  const { data, error } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, job_uuid, staff_uuid, start_date, end_date")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .in("staff_uuid", spellings(staffUuid))
    .gte("start_date", `${today} 00:00:00`)
    .lt("start_date", `${dayAfter(today, MOVE_DAYS + 1)} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(60);
  if (error) return null;
  const rows = ((data ?? []) as { uuid: string; job_uuid: string | null; staff_uuid: string | null; start_date: string | null; end_date: string | null }[]).filter(
    (r) => r.job_uuid && r.start_date && r.end_date,
  );
  if (rows.length === 0) return [];
  const jobUuids = [...new Set(rows.map((r) => r.job_uuid!))];
  const { data: jobs } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, company_uuid, job_address, geo_city, active")
    .eq("org_id", orgId)
    .in("uuid", jobUuids.flatMap(spellings));
  const jobRows = (jobs ?? []) as { uuid: string; generated_job_id: string | null; company_uuid: string | null; job_address: string | null; geo_city: string | null; active: unknown }[];
  const companyIds = [...new Set(jobRows.map((j) => j.company_uuid).filter((c): c is string => !!c))];
  const { data: companies } = companyIds.length
    ? await supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companyIds)
    : { data: [] };
  const client = new Map(((companies ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid.toLowerCase(), c.name?.trim() ?? ""]));
  const job = new Map(jobRows.map((j) => [j.uuid.toLowerCase(), j]));

  return rows.flatMap((r) => {
    const j = job.get(r.job_uuid!.toLowerCase());
    /* a job taken off ServiceM8 holds no booking to move */
    if (j && Number(j.active) === 0) return [];
    const street = streetLine(j?.job_address ?? null);
    const place = [street, j?.geo_city?.trim()].filter(Boolean).join(", ");
    const who = j?.company_uuid ? (client.get(j.company_uuid.toLowerCase()) ?? "") : "";
    return [
      {
        uuid: r.uuid,
        jobUuid: r.job_uuid!,
        staffUuid: r.staff_uuid ?? staffUuid,
        staffName,
        start: r.start_date!,
        end: r.end_date!,
        place,
        match: [j?.generated_job_id ?? "", who, j?.job_address ?? "", j?.geo_city ?? ""].join(" "),
      },
    ];
  });
}
