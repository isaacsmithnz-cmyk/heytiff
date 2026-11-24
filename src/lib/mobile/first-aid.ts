import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import { streetLine } from "@/lib/studio/job-link";
import type { SwmsContent } from "@/lib/swms/library";
import { staffUuidOf, wallMinute } from "./clock";
import { sm8Wall } from "./day-stop";
import type { MobileCtx } from "./auth";
import { callable, namedOrNull, todaysBooking, type Booking, type FirstAidAnswer, type FirstAidJob } from "./first-aid-plan";

/* FIRST AID'S "ON TODAY'S JOB" (heytiff-mobile, app/first-aid): who the first aider is and the nearest
   hospital, for the job you're on today or going to next, as that job's latest SWMS names them, the
   same Emergency table its paper prints (app/swms/[versionId]). Nothing is worked out here that the
   SWMS didn't say: no SWMS, no card; a first aider from outside the business has no number to call.
   Every read is scoped by the phone's workspace. */

const spell = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

/** The person's ServiceM8 bookings that start today, in the account's zone, with now as a stamp. */
async function bookingsToday(ctx: MobileCtx, now: number): Promise<{ bookings: Booking[]; now: string } | null> {
  const [state, z] = await Promise.all([readSm8WriteState(ctx.orgId).catch(() => null), bookingZone(ctx.orgId)]);
  if (!z.zone) return null;
  const staffUuid = state ? await staffUuidOf(ctx, state.tenantId).catch(() => null) : null;
  const wall = wallMinute(new Date(now).toISOString(), z.zone);
  if (!staffUuid || !wall) return null;
  const day = wall.slice(0, 10);
  const { data } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("job_uuid, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .in("staff_uuid", spell(staffUuid))
    .gte("start_date", `${day} 00:00:00`)
    .lte("start_date", `${day} 23:59:59`);
  const bookings = ((data ?? []) as { job_uuid: string | null; start_date: string | null; end_date: string | null }[])
    .filter((r) => r.job_uuid && r.start_date)
    .map((r) => ({ jobUuid: r.job_uuid!, start: r.start_date!, end: r.end_date }));
  return { bookings, now: sm8Wall(wall) };
}

type JobRow = { uuid: string; generated_job_id: string | null; job_address: string | null; geo_city: string | null; geo_state: string | null; geo_postcode?: string | null };

/** The job's latest SWMS's emergency block, with the first aider's number off their staff card. */
async function emergencyOf(orgId: string, jobUuid: string, near: PromiseLike<string | null>): Promise<FirstAidJob["swms"]> {
  const { data: swmsRows } = await supabaseAdmin.from("swms").select("id").eq("org_id", orgId).in("sm8_job_uuid", spell(jobUuid));
  const ids = ((swmsRows ?? []) as { id: string }[]).map((s) => s.id);
  if (!ids.length) return null;
  const { data: top } = await supabaseAdmin
    .from("swms_versions")
    .select("id, content")
    .eq("org_id", orgId)
    .in("swms_id", ids)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = top as { id: string; content: Partial<SwmsContent> | null } | null;
  if (!v) return null;
  const e = v.content?.emergency;

  const aider = namedOrNull(e?.firstAider);
  let phone: string | null = null;
  if (aider) {
    /* the first aider is one of the people the version covers, named as the paper names them */
    const { data: people } = await supabaseAdmin.from("swms_people").select("staff_profile_id").eq("org_id", orgId).eq("version_id", v.id);
    const staffIds = ((people ?? []) as { staff_profile_id: string | null }[]).map((p) => p.staff_profile_id).filter((x): x is string => !!x);
    if (staffIds.length) {
      const { data: profiles } = await supabaseAdmin
        .from("staff_profiles")
        .select("id, first_name, last_name, full_name, preferred_name, phone")
        .eq("org_id", orgId)
        .in("id", staffIds);
      const matches = ((profiles ?? []) as (NameParts & { id: string; phone: string | null })[]).filter((p) => displayNameOf(p) === aider);
      /* two people of one name: no guessing which to ring */
      phone = matches.length === 1 ? callable(matches[0].phone) : null;
    }
  }

  const hospital = namedOrNull(e?.hospital);
  return {
    versionId: v.id,
    firstAider: aider ? { name: aider, phone } : null,
    hospital: hospital ? { name: hospital, near: await near } : null,
    extinguisher: namedOrNull(e?.extinguisher),
  };
}

/** Today's job and what its SWMS says to do in an emergency; `job: null` when you've no booking today. */
export async function readFirstAid(ctx: MobileCtx, now: number = Date.now()): Promise<FirstAidAnswer> {
  const today = await bookingsToday(ctx, now);
  const booking = today ? todaysBooking(today.bookings, today.now) : null;
  if (!booking) return { job: null };

  const job = supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, job_address, geo_city, geo_state, geo_postcode")
    .eq("org_id", ctx.orgId)
    .in("uuid", spell(booking.jobUuid))
    .limit(1)
    .maybeSingle()
    .then(({ data }) => data as JobRow | null);
  /* the hospital is the one for the site's area, so the maps look for it there */
  const near = job.then((j) => (j ? [j.geo_city?.trim(), j.geo_state?.trim(), j.geo_postcode?.trim()].filter(Boolean).join(" ") || null : null));
  const [j, swms] = await Promise.all([job, emergencyOf(ctx.orgId, booking.jobUuid, near)]);
  return {
    job: {
      jobUuid: j?.uuid ?? booking.jobUuid,
      number: j?.generated_job_id ?? null,
      where: j ? [streetLine(j.job_address), j.geo_city?.trim()].filter(Boolean).join(", ") : "",
      swms,
    },
  };
}
