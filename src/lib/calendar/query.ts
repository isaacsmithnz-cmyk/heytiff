import { supabaseAdmin } from "@/lib/supabase-server";
import { holidaysInSpan, stateFor } from "@/lib/timepay/leave-query";
import { ensureHolidays } from "@/lib/timepay/holiday-sync";
import { listVehicleExpiries } from "@/lib/fleet/query";
import { asNoticeKind } from "@/lib/dashboard/notices";
import type { Capability } from "@/lib/permissions";
import type { ExpiryWindow } from "@/lib/expiry";
import type { OrgCredential } from "@/lib/org/credentials";
import {
  companyItems,
  companyWindow,
  type CalendarEventRow,
  type CompanyCalendar,
  type HolidayRow,
  type NoticeEventRow,
  type SchoolHolidayRow,
  type VehicleExpiryRow,
} from "./items";

/* THE HOME CALENDAR'S READS — one call.

   `loadCompanyCalendar` is what Home's loader (`loadDesk`,
   lib/dashboard/desk-data) runs for the Calendar tab. It takes the loader's
   context as it is, and uses the two things that context has already read
   for the whole page, the expiry window and the org's credentials, rather
   than asking for them again.

   Six sources, each read over the calendar's twelve months:
   - public holidays: the org's own table, topped up by `ensureHolidays`
     (the lazy fill Time & Pay already runs; Home never did, so a workspace
     that had never opened Time & Pay would show none), whose guard is read
     beside them and which is read again only after a fill;
   - school holidays: the department's dates, a reference table the same for
     every workspace (docs/migrations/school_holidays.sql);
   - company events and shutdowns (docs/migrations/calendar_events.sql);
   - the noticeboard's events, read-only;
   - the fleet's renewal days, for `assets_all` only, as the register is;
   - the business's licences and cover, for the owner only, as the
     Organisation screen is.

   THE TWO NEW TABLES MAY NOT EXIST YET. The migrations go in before the
   merge, but a read that fails (a missing table, a blip) is an empty
   source, never a broken Home: the calendar draws what it has.

   ONE DAY FOR THE WHOLE NEW HOME: the workspace's (`railDay`, the ServiceM8
   account's zone, Sydney without one). It is the day the "Your day" bar
   draws above the calendar, and the day the list places its rows on with
   the same `expiryDue`, so a rego the list calls Today is not overdue here.
   It is NOT the loader's `today` (Sydney's, the bell's): late on a Perth
   evening Sydney is already on tomorrow, and the calendar's Today would sit
   a day ahead of the bar over it. The context below does not carry `today` at all, so
   nothing here can count on it by mistake. */

/** What the calendar needs from the new Home's loader context. The loader's
    own context (`DeskContext`) carries all of this, so it passes as it is. */
export type CompanyCalendarContext = {
  orgId: string;
  caps: ReadonlySet<Capability>;
  isOwner: boolean;
  /** The workspace's day: the calendar's Today, its window, and the day an
      admin date is counted late on (see the header). */
  railDay: string;
  /** Staff id → display name, for "Added" on an event. */
  names?: ReadonlyMap<string, string>;
  /** Read once for the whole page (lib/dashboard/desk-data `readHomeShared`). */
  shared: { expiry: ExpiryWindow; orgCredentials: readonly OrgCredential[] };
};

/* ── school holidays ── */

export type SchoolDivision = "all" | "eastern" | "western";

/** NSW splits its schools in two; the rest of the country is one calendar.
    Western NSW (the late-start schools) is not selectable yet: a workspace in
    NSW reads the Eastern division until it can say otherwise. */
export function schoolDivisionOf(state: string): SchoolDivision {
  return state === "NSW" ? "eastern" : "all";
}

/** The breaks that overlap a span, oldest first. Empty for a state with no
    rows, and when the table is not there yet. */
export async function schoolHolidaysInSpan(
  state: string,
  division: SchoolDivision,
  spanStart: string,
  spanEnd: string,
): Promise<SchoolHolidayRow[]> {
  const { data, error } = await supabaseAdmin
    .from("school_holidays")
    .select("season, starts_on, ends_on, students_back")
    .eq("state", state)
    .eq("division", division)
    .lte("starts_on", spanEnd)
    .gte("ends_on", spanStart)
    .order("starts_on");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    season: String(r.season ?? ""),
    startsOn: String(r.starts_on ?? "").slice(0, 10),
    endsOn: String(r.ends_on ?? "").slice(0, 10),
    studentsBack: r.students_back ? String(r.students_back).slice(0, 10) : null,
  }));
}

/* ── company events ── */

/** The org's events that overlap a span: a shutdown that began last month
    and runs into this one is on. Empty when the table is not there yet. */
export async function calendarEventsInSpan(
  orgId: string,
  spanStart: string,
  spanEnd: string,
): Promise<CalendarEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select(
      "id, kind, title, starts_on, ends_on, starts_at, ends_at, location, audience, note, series_id, repeat, created_by, created_at",
    )
    .eq("org_id", orgId)
    .lte("starts_on", spanEnd)
    .gte("ends_on", spanStart)
    .order("starts_on");
  if (error || !data) return [];
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return (data as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    kind: r.kind === "shutdown" ? "shutdown" : "event",
    title: String(r.title ?? ""),
    startsOn: String(r.starts_on ?? "").slice(0, 10),
    endsOn: String(r.ends_on ?? "").slice(0, 10),
    startsAt: text(r.starts_at),
    endsAt: text(r.ends_at),
    location: text(r.location),
    audience: text(r.audience),
    note: text(r.note),
    seriesId: text(r.series_id),
    repeat: r.repeat ?? null,
    createdBy: text(r.created_by),
    createdAt: text(r.created_at),
  }));
}

/* ── the noticeboard's events ── */

/** Event notices dated inside a span and still on the board (a post someone
    archived is off it). The board owns them: date, time, place and RSVPs. */
export async function noticeEventsInSpan(
  orgId: string,
  spanStart: string,
  spanEnd: string,
): Promise<NoticeEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("notices")
    .select("id, title, kind, event_date, event_time, event_location")
    .eq("org_id", orgId)
    .eq("kind", "event")
    .is("archived_at", null)
    .gte("event_date", spanStart)
    .lte("event_date", spanEnd)
    .order("event_date");
  if (error || !data) return [];
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  return (data as Record<string, unknown>[])
    .filter((r) => asNoticeKind(r.kind) === "event" && r.event_date)
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      date: String(r.event_date).slice(0, 10),
      time: text(r.event_time),
      location: text(r.event_location),
    }));
}

/* ── the calendar ── */

const none = <T>(): Promise<T[]> => Promise.resolve([]);

/** Everything the Home calendar draws, for one viewer. */
export async function loadCompanyCalendar(ctx: CompanyCalendarContext): Promise<CompanyCalendar> {
  const warnDays = ctx.shared.expiry.warnDays;
  const canAdd = ctx.caps.has("team");
  /* The calendar's day, and the only one it counts on (see the header). */
  const day = ctx.railDay;
  const win = companyWindow(day);
  /* `railDay` is the loader's own day, so this is a malformed context, not a
     state a person can reach: draw nothing rather than guess a window. */
  if (!win) {
    const empty = { windowStart: day, windowEnd: day, stateName: "", items: [] };
    return { today: day, ...empty, warnDays, canAdd, hasSchool: false };
  }
  const { windowStart, windowEnd } = win;

  /* The workspace's state decides whose holidays these are. It is one read,
     and the two holiday sources wait on it; nothing else does. */
  const state = stateFor(ctx.orgId, "").catch(() => null);

  const [holidays, school, events, notices, vehicles] = await Promise.all([
    state.then(async (s): Promise<HolidayRow[]> => {
      if (!s) return [];
      /* The top-up's guard and the read go out together, rather than one
         after the other: the fill writes only when coverage runs short
         (about twice a year), and only then is the read taken again, after
         it — so a workspace that has never opened Time & Pay still has its
         holidays on its first Home, and every other load waits one round
         trip less. A fill that fails must not cost the page the holidays it
         has. */
      const read = () => holidaysInSpan(ctx.orgId, s, windowStart, windowEnd);
      const [wrote, rows] = await Promise.all([ensureHolidays(ctx.orgId, s, day).catch(() => false), read()]);
      return wrote ? read() : rows;
    }),
    state.then((s) => (s ? schoolHolidaysInSpan(s, schoolDivisionOf(s), windowStart, windowEnd) : none<SchoolHolidayRow>())),
    calendarEventsInSpan(ctx.orgId, windowStart, windowEnd),
    noticeEventsInSpan(ctx.orgId, windowStart, windowEnd),
    /* The register's gate: without `assets_all` the fleet is not read at all. */
    ctx.caps.has("assets_all") ? listVehicleExpiries(ctx.orgId) : none<VehicleExpiryRow>(),
  ]);

  const items = companyItems(
    {
      holidays,
      school,
      events,
      notices,
      vehicles,
      /* The Organisation screen's gate. The shared read is already empty for
         anyone else; this says so again where the items are made. */
      credentials: ctx.isOwner ? ctx.shared.orgCredentials : [],
    },
    { today: day, windowEnd, warnDays, names: ctx.names },
  );

  return {
    today: day,
    windowStart,
    windowEnd,
    stateName: (await state) ?? "",
    items,
    warnDays,
    canAdd,
    hasSchool: school.length > 0,
  };
}
