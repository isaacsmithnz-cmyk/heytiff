import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { streetLine } from "@/lib/studio/job-link";
import type { MobileCtx } from "@/lib/mobile/auth";
import { changeAllowed } from "@/lib/mobile/schedule-gate";
import { shiftDay, type MoveBooking } from "./note-move-plan";

/* TIFF MOVES A BOOKING, THE READS AND THE PRESS (note-move-plan decides).
   The move is Schedule's own change of time (lib/mobile/schedule-change
   {do: "time"}, pressed from actions/workboard-notes, where a press may be
   made): the booking at its new time, the old one off, through the same
   gate, so whoever may change the day on Schedule may ask her,
   and nobody else. */

/** How far ahead a booking to move is looked for. */
const AHEAD_DAYS = 21;

const spellings = (uuids: readonly string[]) => [...new Set(uuids.flatMap((u) => [u, u.toLowerCase(), u.toUpperCase()]))];

/** Who's asking, as Schedule's gate reads a person: their role and what they may do in this workspace. */
export async function moveCtx(orgId: string, userId: string): Promise<MobileCtx | null> {
  const { data } = await supabaseAdmin.from("memberships").select("role, permissions").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  const m = data as { role: string | null; permissions: unknown } | null;
  if (!m) return null;
  const role = (m.role as Role | null) ?? null;
  return { userId, orgId, role, caps: resolve(role, m.permissions), orgIds: [orgId] };
}

/** Whether this person may move bookings at all; the gate's words when not. */
export async function mayMove(ctx: MobileCtx): Promise<string | null> {
  const g = await changeAllowed(ctx);
  return g.ok ? null : g.error;
}

/** A person's bookings from today on: ServiceM8's, on jobs that can still be booked. */
export async function bookingsToMove(orgId: string, staffProfileId: string, today: string): Promise<MoveBooking[]> {
  const links = await sm8StaffLinkMap(orgId).catch(() => new Map<string, string>());
  const uuids = [...links.entries()].filter(([, id]) => id === staffProfileId).map(([uuid]) => uuid);
  if (!uuids.length) return [];
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, job_uuid, staff_uuid, start_date, end_date")
    .eq("org_id", orgId)
    .in("staff_uuid", spellings(uuids))
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", `${today} 00:00:00`)
    .lt("start_date", `${shiftDay(today, AHEAD_DAYS)} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(60);
  const acts = (data ?? []) as { uuid: string; job_uuid: string | null; staff_uuid: string; start_date: string; end_date: string | null }[];
  const jobIds = [...new Set(acts.map((a) => a.job_uuid).filter((j): j is string => !!j))];
  if (!jobIds.length) return [];
  const { data: js } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, job_number, job_address, company_uuid, status, active")
    .eq("org_id", orgId)
    .in("uuid", spellings(jobIds));
  const jobs = new Map(
    ((js ?? []) as { uuid: string; generated_job_id: string | null; job_number: number | null; job_address: string | null; company_uuid: string | null; status: string | null; active: unknown }[]).map((j) => [j.uuid.toLowerCase(), j]),
  );
  const companyIds = [...new Set([...jobs.values()].map((j) => j.company_uuid).filter((c): c is string => !!c))];
  const { data: cs } = companyIds.length
    ? await supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companyIds)
    : { data: [] };
  const clients = new Map(((cs ?? []) as { uuid: string; name: string | null }[]).map((c) => [c.uuid.toLowerCase(), c.name ?? ""]));
  return acts.flatMap((a) => {
    const j = a.job_uuid ? jobs.get(a.job_uuid.toLowerCase()) : undefined;
    if (!j || Number(j.active) !== 1 || (j.status !== "Quote" && j.status !== "Work Order")) return [];
    return [
      {
        activity: a.uuid,
        staffUuid: a.staff_uuid,
        jobUuid: j.uuid,
        number: j.generated_job_id ?? (j.job_number != null ? String(j.job_number) : ""),
        client: j.company_uuid ? (clients.get(j.company_uuid.toLowerCase()) ?? "") : "",
        where: streetLine(j.job_address),
        start: a.start_date,
        end: a.end_date,
      },
    ];
  });
}
