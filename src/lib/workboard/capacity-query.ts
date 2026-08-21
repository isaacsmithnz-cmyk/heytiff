/* One month of capacity — the Schedule month's read.

   THE DECISIONS LIVE IN capacity.ts (pure, tested); this file only fetches,
   joins the names, and hands over rows — the loadScheduleDay contract,
   repeated. Names are joined in app code, not SQL: the mirror has no foreign
   keys by doctrine.

   DATES ARE STRINGS. The month's bounds are naive local text compared
   lexicographically — `[first 00:00:00, first-of-next 00:00:00)` — never
   Dates, for the reason stamped on every file that touches this mirror.

   THE ALLOCATION LIST IS THE CREW, NOT THE MIRROR. Two things are read here
   and they are not the same list: `schedule_capacity_staff` says who counts
   toward a day, and `sm8_staff` says who exists. The screen needs both, because
   its whole job is letting somebody move people between them — so a staff
   member with no allocation row comes back with `included: false` and the
   default day rather than being left out, and an allocation row for somebody
   the mirror has since deactivated still comes back so their hours are visible
   and can be turned off on purpose.

   NO SESSION HERE — callers establish the right to ask, exactly as
   all-jobs-query.ts says. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { type CapacityAllocation } from "./capacity";
import { type ScheduleActivity } from "./schedule";

/** The default day for somebody who has never been set: eight hours. */
export const DEFAULT_DAILY_MINUTES = 480;

export type CapacityPayload = {
  /** Any day in the month this payload covers — the caller's own anchor,
      echoed back so a stale response can be told from a current one exactly as
      the day rail tells them apart. */
  anyDayISO: string;
  activities: ScheduleActivity[];
  allocation: CapacityAllocation[];
  /** staff uuid → name, for the people on a day. */
  staffNames: [string, string][];
};

export const EMPTY_CAPACITY: CapacityPayload = {
  anyDayISO: "",
  activities: [],
  allocation: [],
  staffNames: [],
};

/** '2026-08-20' → '2026-08-01' and '2026-09-01'. Sliced, never parsed. */
function monthBounds(anyDayISO: string): { floor: string; ceil: string } {
  const y = Number(anyDayISO.slice(0, 4));
  const m = Number(anyDayISO.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    floor: `${anyDayISO.slice(0, 7)}-01 00:00:00`,
    ceil: `${nextY}-${String(nextM).padStart(2, "0")}-01 00:00:00`,
  };
}

export async function loadCapacityMonth(
  orgId: string,
  anyDayISO: string
): Promise<CapacityPayload> {
  const { floor, ceil } = monthBounds(anyDayISO);

  const [{ data: actRows }, { data: staffRows }, { data: allocRows }] = await Promise.all([
    /* ONLY DISPATCHED BOOKINGS, the rail's single most important filter. The
       `= 0` rows are recorded time on site and OVERLAP the booked hour on the
       same job — summing both would report a day at roughly double its load,
       which on this screen is not a drawing error, it is a wrong number. */
    supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled")
      .eq("org_id", orgId)
      .eq("active", 1)
      .eq("activity_was_scheduled", 1)
      .gte("start_date", floor)
      .lt("start_date", ceil)
      .order("start_date", { ascending: true }),
    supabaseAdmin.from("sm8_staff").select("uuid, first, last, active").eq("org_id", orgId),
    supabaseAdmin
      .from("schedule_capacity_staff")
      .select("sm8_staff_uuid, included, daily_minutes")
      .eq("org_id", orgId),
  ]);

  const acts = (actRows ?? []) as {
    uuid: string;
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string | null;
    end_date: string | null;
    activity_was_scheduled: number | null;
  }[];

  const activities = acts
    .filter((a): a is typeof a & { start_date: string } => !!a.start_date)
    .map((a) => ({
      uuid: a.uuid,
      jobUuid: a.job_uuid,
      staffUuid: a.staff_uuid,
      start: a.start_date,
      end: a.end_date,
      wasScheduled: a.activity_was_scheduled,
    }));

  const staff = ((staffRows ?? []) as {
    uuid: string;
    first: string | null;
    last: string | null;
    active: number | null;
  }[])
    .map((s) => ({
      uuid: s.uuid,
      name: [s.first, s.last].filter(Boolean).join(" ").trim(),
      active: s.active === 1,
    }))
    .filter((s) => s.name !== "");

  const saved = new Map(
    ((allocRows ?? []) as {
      sm8_staff_uuid: string;
      included: boolean;
      daily_minutes: number;
    }[]).map((r) => [r.sm8_staff_uuid, r])
  );

  /* WHO APPEARS IN THE LIST. Everyone the mirror still calls active, plus
     anyone with a saved row (so a deactivated person's hours stay visible and
     can be switched off deliberately), plus anyone who actually has a booking
     this month — a person ServiceM8 deactivated mid-month is still consuming
     days, and leaving them out of the list would make the numerator
     unexplainable from the screen that shows it. */
  const booked = new Set(activities.map((a) => a.staffUuid).filter(Boolean) as string[]);
  const nameOf = new Map(staff.map((s) => [s.uuid, s.name]));
  const uuids = [
    ...new Set([
      ...staff.filter((s) => s.active).map((s) => s.uuid),
      ...saved.keys(),
      ...[...booked].filter((u) => nameOf.has(u)),
    ]),
  ];

  const allocation: CapacityAllocation[] = uuids
    .map((uuid) => {
      const row = saved.get(uuid);
      return {
        staffUuid: uuid,
        name: nameOf.get(uuid) ?? "",
        /* NEVER SET IS NOT THE SAME AS SET TO OFF, and the difference decides
           what a brand-new account sees. Defaulting to `true` would put
           `Pending Jobs` — a placeholder, not a person — into the denominator
           on first open and quietly understate every day in the month. An
           unset list scores nothing, and the screen says so. */
        included: row?.included ?? false,
        dailyMinutes: row?.daily_minutes ?? DEFAULT_DAILY_MINUTES,
      };
    })
    .filter((a) => a.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    anyDayISO,
    activities,
    allocation,
    staffNames: [...nameOf.entries()],
  };
}

/** Save the whole list in one go — it is edited as a list, so it is written as
    one, and a partial save would leave the denominator half-changed. */
export async function saveCapacityAllocation(
  orgId: string,
  userId: string,
  rows: { staffUuid: string; included: boolean; dailyMinutes: number }[]
): Promise<{ ok: boolean }> {
  if (rows.length === 0) return { ok: true };
  const { error } = await supabaseAdmin.from("schedule_capacity_staff").upsert(
    rows.map((r) => ({
      org_id: orgId,
      sm8_staff_uuid: r.staffUuid,
      included: r.included,
      /* clamped here as well as in the CHECK: a rejected write would surface
         as a bare 503 the UI cannot explain, and a slider is not worth that */
      daily_minutes: Math.max(0, Math.min(1440, Math.round(r.dailyMinutes))),
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })),
    { onConflict: "org_id,sm8_staff_uuid" }
  );
  return { ok: !error };
}
