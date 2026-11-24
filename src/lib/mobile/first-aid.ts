import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { listSm8StaffLinks } from "@/lib/integrations/links";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { edNamed, nearestEmergency, pinOf } from "@/lib/hospitals/nearest";
import { displayNameOf, type NameParts } from "@/lib/staff/name";
import { streetLine } from "@/lib/studio/job-link";
import { isFirstAidTicket, type SwmsContent } from "@/lib/swms/library";
import { wallMinute } from "./clock";
import { sm8Wall } from "./day-stop";
import type { MobileCtx } from "./auth";
import { bookedFirstAider, callable, namedOrNull, todaysBooking, type Booking, type FirstAidAnswer, type FirstAidJob } from "./first-aid-plan";

/* FIRST AID'S "ON TODAY'S JOB" (heytiff-mobile, app/first-aid): who the first aider is and the nearest
   hospital, for the job you're on today or going to next.

   The job's latest SWMS first: its Emergency table, as its paper prints it (app/swms/[versionId]), the
   first aider's number off their staff card when the name is theirs alone. Where the SWMS names nobody
   (or there's no SWMS), someone else booked on the job today with a current first aid ticket; where it
   names no hospital, the nearest emergency department to the job's pin (lib/hospitals). Nothing else is
   worked out: no ticket on file, no pin, no answer. Every read is scoped by the phone's workspace. */

const spell = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

type Today = { bookings: Booking[]; now: string; day: string; tenantId: string; viewer: string | null };

/** The person's ServiceM8 bookings that start today, in the account's zone, with now as a stamp. */
async function bookingsToday(ctx: MobileCtx, now: number): Promise<Today | null> {
  const [state, z, viewer] = await Promise.all([
    readSm8WriteState(ctx.orgId).catch(() => null),
    bookingZone(ctx.orgId),
    staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null),
  ]);
  const tenantId = state?.tenantId ?? null;
  if (!z.zone || !tenantId || !viewer) return null;
  const links = await listSm8StaffLinks(ctx.orgId, tenantId).catch(() => []);
  const staffUuid = links.find((l) => l.staffProfileId === viewer)?.remoteId ?? null;
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
  return { bookings, now: sm8Wall(wall), day, tenantId, viewer };
}

type JobRow = {
  uuid: string;
  generated_job_id: string | null;
  job_address: string | null;
  geo_city: string | null;
  geo_state: string | null;
  geo_postcode?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};
type Profile = NameParts & { id: string; phone: string | null };
const PROFILE = "id, first_name, last_name, full_name, preferred_name, phone";

/** The job's latest SWMS: its version and its Emergency table, with the first aider's number when the name is
    one person's on the version. */
async function swmsOf(
  orgId: string,
  jobUuid: string
): Promise<{ versionId: string; aider: string | null; phone: string | null; hospital: string | null; extinguisher: string | null } | null> {
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
      const { data: profiles } = await supabaseAdmin.from("staff_profiles").select(PROFILE).eq("org_id", orgId).in("id", staffIds);
      const matches = ((profiles ?? []) as Profile[]).filter((p) => displayNameOf(p) === aider);
      /* two people of one name: no guessing which to ring */
      phone = matches.length === 1 ? callable(matches[0].phone) : null;
    }
  }
  return { versionId: v.id, aider, phone, hospital: namedOrNull(e?.hospital), extinguisher: namedOrNull(e?.extinguisher) };
}

/** Someone else booked on the job today with a current first aid ticket on their staff card. */
async function bookedAider(orgId: string, jobUuid: string, today: Today): Promise<{ name: string; phone: string | null } | null> {
  const { data: acts } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("staff_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .in("job_uuid", spell(jobUuid))
    .gte("start_date", `${today.day} 00:00:00`)
    .lte("start_date", `${today.day} 23:59:59`);
  const uuids = new Set(((acts ?? []) as { staff_uuid: string | null }[]).map((a) => a.staff_uuid?.toLowerCase()).filter((x): x is string => !!x));
  if (!uuids.size) return null;
  const links = await listSm8StaffLinks(orgId, today.tenantId).catch(() => []);
  const ids = [...new Set(links.filter((l) => uuids.has(l.remoteId.toLowerCase())).map((l) => l.staffProfileId))].filter((id) => id !== today.viewer);
  if (!ids.length) return null;
  const [{ data: profiles }, { data: licences }] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select(PROFILE).eq("org_id", orgId).eq("status", "Active").in("id", ids),
    supabaseAdmin.from("staff_licences").select("staff_profile_id, type_name, expiry_date").eq("org_id", orgId).in("staff_profile_id", ids),
  ]);
  const ticketed = new Set(
    ((licences ?? []) as { staff_profile_id: string; type_name: string | null; expiry_date: string | null }[])
      .filter((l) => l.type_name && isFirstAidTicket(l.type_name) && (!l.expiry_date || l.expiry_date >= today.day))
      .map((l) => l.staff_profile_id)
  );
  const people = ((profiles ?? []) as Profile[])
    .filter((p) => ticketed.has(p.id))
    .map((p) => ({ staffProfileId: p.id, name: displayNameOf(p), phone: callable(p.phone) }));
  const who = bookedFirstAider(people, today.viewer);
  return who ? { name: who.name, phone: who.phone } : null;
}

/** Today's job and who to call and where to go; `job: null` when you've no booking today. */
export async function readFirstAid(ctx: MobileCtx, now: number = Date.now()): Promise<FirstAidAnswer> {
  const today = await bookingsToday(ctx, now);
  const booking = today ? todaysBooking(today.bookings, today.now) : null;
  if (!today || !booking) return { job: null };

  const [{ data: jobRow }, swms] = await Promise.all([
    supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, job_address, geo_city, geo_state, geo_postcode, lat, lng")
      .eq("org_id", ctx.orgId)
      .in("uuid", spell(booking.jobUuid))
      .limit(1)
      .maybeSingle(),
    swmsOf(ctx.orgId, booking.jobUuid),
  ]);
  const j = jobRow as JobRow | null;
  const pin = j ? pinOf(j.lat, j.lng) : null;
  /* the site's area, so the maps look for a hospital the list doesn't place */
  const near = j ? [j.geo_city?.trim(), j.geo_state?.trim(), j.geo_postcode?.trim()].filter(Boolean).join(" ") || null : null;

  let hospital: FirstAidJob["hospital"] = null;
  if (swms?.hospital) {
    const listed = edNamed(swms.hospital, pin);
    hospital = { name: swms.hospital, km: listed?.km ?? null, lat: listed?.lat ?? null, lng: listed?.lng ?? null, near, from: "swms" };
  } else {
    const ed = nearestEmergency(pin, 1)[0];
    if (ed) hospital = { name: ed.name, km: ed.km, lat: ed.lat, lng: ed.lng, near, from: "nearest" };
  }

  const booked = swms?.aider ? null : await bookedAider(ctx.orgId, booking.jobUuid, today);
  const firstAider: FirstAidJob["firstAider"] = swms?.aider
    ? { name: swms.aider, phone: swms.phone, from: "swms" }
    : booked
      ? { ...booked, from: "booked" }
      : null;

  return {
    job: {
      jobUuid: j?.uuid ?? booking.jobUuid,
      number: j?.generated_job_id ?? null,
      where: j ? [streetLine(j.job_address), j.geo_city?.trim()].filter(Boolean).join(", ") : "",
      swmsVersionId: swms?.versionId ?? null,
      firstAider,
      hospital,
      extinguisher: swms?.extinguisher ?? null,
    },
  };
}
