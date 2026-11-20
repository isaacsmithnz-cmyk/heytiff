/* THE DIARY, READ FOR TIFF — server only (Isaac, 20 November 2026, on the
   phone: "What's booked on Monday?", and she said she had no tool for what's
   booked and opened the Schedule).

   A day, or a short run of them, as the Schedule reads it: the same
   `loadScheduleDay(orgId, day, { away: true })` the phone's /api/mobile/schedule
   and the web's scheduleDay make, with the team's regular days off laid in as
   the Schedule page lays them (TAFE, RDOs), and Schedule capacity's people
   with nothing booked as the phone says who's free (lib/mobile/schedule-crew).

   WHAT THE VIEWER MAY SEE is what the Schedule shows them: anyone holding
   `workboard` sees everyone's bookings and who's off on the Schedule, so
   every booking comes back here too. What the Schedule keeps to managers is
   people's actual hours (the phone's `actual`), and none of that is read.

   Times are the mirror's own naive text, which is the business's clock:
   "07:30" is half past seven where the business is. Nothing here makes a
   Date of a time. */

import { loadScheduleDay, readActiveStaff, type SchedulePayload } from "@/lib/workboard/schedule-query";
import { plusDays } from "@/lib/workboard/dates";
import { crewNotBooked } from "@/lib/mobile/schedule-crew";
import { awayOnDay, withRegular, isoWeekday, WEEKDAY_NAMES } from "@/lib/team/regular-days-off";
import { readRegularDaysOff, sm8StaffByProfile } from "@/lib/team/regular-days-off-query";
import type { ScheduleAway, ScheduleClosed } from "@/lib/workboard/away";

/** The most days one read covers. */
export const MAX_DIARY_DAYS = 7;

export type DiaryBooking = {
  /** For job_history: kind "job" and this id. */
  id: string;
  job: string | null;
  client: string | null;
  suburb: string | null;
  street: string | null;
  what: string | null;
  status: string | null;
  /** "HH:MM" on the business's clock. */
  start: string;
  /** "HH:MM", or "YYYY-MM-DD HH:MM" where it ends on a later day; null where it has no end. */
  end: string | null;
  who: string[];
};

export type DiaryAway = {
  who: string;
  /** What the business called it ("Annual Leave", "TAFE"); null where it typed nothing. */
  what: string | null;
  all_day: boolean;
  from?: string;
  to?: string;
  /** The last day it covers, where it runs past this one. */
  until?: string;
  where?: string;
};

export type DiaryClosed = { kind: ScheduleClosed["kind"]; name: string | null; all_day: boolean; from?: string; to?: string };

export type DiaryDay = {
  date: string;
  weekday: string;
  closed?: DiaryClosed[];
  bookings: DiaryBooking[];
  away: DiaryAway[];
  /** Schedule capacity's people with nothing booked and not off. */
  free?: string[];
  /** …and those booked for part of it, with room after their last booking ends. */
  free_after?: { who: string; after: string }[];
};

export type DiaryRead =
  | { found: false; said: string; people?: string[] }
  | { found: true; zone: string | null; person?: { asked: string; matched: string[] }; note?: string; days: DiaryDay[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** A real calendar day, as YYYY-MM-DD text. */
export const isDiaryDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && plusDays(v, 0) === v;

/** "YYYY-MM-DD HH:MM:SS" → "HH:MM". */
const hhmm = (stamp: string) => stamp.slice(11, 16);

/** The days from first to last inclusive, at most MAX_DIARY_DAYS. */
export function diaryDays(from: string, to: string): { days: string[]; capped: boolean } {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < MAX_DIARY_DAYS; d = plusDays(d, 1)) days.push(d);
  return { days, capped: days.length === MAX_DIARY_DAYS && days[days.length - 1] < to };
}

/** Does a name answer to what was asked? Each word asked starts a word of
    the name: "luke" is Luke Smith, "luke s" too, "smith" too. */
export function nameAnswers(name: string, asked: string): boolean {
  const words = low(name).split(/\s+/).filter(Boolean);
  const want = low(asked).split(/\s+/).filter(Boolean);
  return want.length > 0 && want.every((w) => words.some((n) => n.startsWith(w)));
}

function awayLine(a: ScheduleAway, day: string, who: string): DiaryAway {
  const floor = `${day} 00:00:00`;
  const next = `${plusDays(day, 1)} 00:00:00`;
  /* a regular day off is laid as the whole day to 23:59:59 */
  const allDay = a.start <= floor && (a.end >= next || a.end >= `${day} 23:59:59`);
  const runsOn = a.end > next;
  /* an end at midnight is the day before's last moment */
  const lastDay = a.end.slice(11) === "00:00:00" ? plusDays(a.end.slice(0, 10), -1) : a.end.slice(0, 10);
  return {
    who,
    what: a.name,
    all_day: allDay || runsOn,
    ...(allDay || runsOn ? {} : { from: a.start < floor ? "00:00" : hhmm(a.start), to: hhmm(a.end) }),
    ...(runsOn && lastDay > day ? { until: lastDay } : {}),
    ...(a.where ? { where: a.where } : {}),
  };
}

function closedLine(c: ScheduleClosed, day: string): DiaryClosed {
  const allDay = c.start <= `${day} 00:00:00` && c.end >= `${plusDays(day, 1)} 00:00:00`;
  return { kind: c.kind, name: c.name, all_day: allDay, ...(allDay ? {} : { from: hhmm(c.start), to: hhmm(c.end) }) };
}

/** One day's payload, shaped for the model: a booking per job and time,
    with everyone on it; who's off; and, where `only` is given, only what
    touches those people (lower-case ServiceM8 uuids). Pure. */
export function shapeDiaryDay(
  payload: SchedulePayload,
  names: ReadonlyMap<string, string>,
  only: ReadonlySet<string> | null,
  crew?: { free: { uuid: string; name: string }[]; later: { uuid: string; name: string; after: string }[] }
): DiaryDay {
  const day = payload.dayISO;
  const nameOf = (uuid: string | null) => (uuid ? names.get(low(uuid)) ?? null : null);
  const jobOf = new Map(payload.jobs.map((j) => [low(j.remoteId), j]));

  /* a booking per job and time: the people on the same job at the same
     times are one booking with all of them on it */
  const byKey = new Map<string, { jobUuid: string; start: string; end: string | null; who: string[]; uuids: string[] }>();
  for (const a of payload.activities) {
    if (a.wasScheduled !== 1 || !a.jobUuid) continue;
    const key = `${low(a.jobUuid)}|${a.start}|${a.end ?? ""}`;
    const got = byKey.get(key) ?? byKey.set(key, { jobUuid: a.jobUuid, start: a.start, end: a.end, who: [], uuids: [] }).get(key)!;
    const name = nameOf(a.staffUuid);
    if (name && !got.who.includes(name)) got.who.push(name);
    if (a.staffUuid) got.uuids.push(low(a.staffUuid));
  }
  const bookings: DiaryBooking[] = [...byKey.values()]
    .filter((b) => !only || b.uuids.some((u) => only.has(u)))
    .sort((x, y) => x.start.localeCompare(y.start) || (x.end ?? "").localeCompare(y.end ?? ""))
    .map((b) => {
      const j = jobOf.get(low(b.jobUuid));
      return {
        id: b.jobUuid,
        job: j?.jobNumber ?? null,
        client: j?.clientName ?? null,
        suburb: j?.suburb ?? null,
        street: payload.addresses[j?.remoteId ?? b.jobUuid] ?? null,
        what: j?.description ? (j.description.length > 100 ? `${j.description.slice(0, 99)}…` : j.description) : null,
        status: j?.status ?? null,
        start: hhmm(b.start),
        end: b.end === null ? null : b.end.slice(0, 10) === day ? hhmm(b.end) : b.end.slice(0, 16),
        who: [...b.who].sort((x, y) => x.localeCompare(y)),
      };
    });

  const away = (payload.away ?? [])
    .filter((a) => !only || only.has(low(a.staffUuid)))
    .flatMap((a) => {
      const who = nameOf(a.staffUuid);
      return who ? [awayLine(a, day, who)] : [];
    })
    .sort((x, y) => x.who.localeCompare(y.who));

  const closed = (payload.closed ?? []).map((c) => closedLine(c, day));
  const free = crew?.free.filter((p) => !only || only.has(low(p.uuid))).map((p) => p.name);
  const later = crew?.later.filter((p) => !only || only.has(low(p.uuid))).map((p) => ({ who: p.name, after: hhmm(p.after) }));

  return {
    date: day,
    weekday: WEEKDAY_NAMES[isoWeekday(day) - 1],
    ...(closed.length ? { closed } : {}),
    bookings,
    away,
    ...(free?.length ? { free } : {}),
    ...(later?.length ? { free_after: later } : {}),
  };
}

/** The diary over `from`…`to` (inclusive, capped at MAX_DIARY_DAYS), for one
    org, narrowed to a person where one is asked for. The org is the
    viewer's: nothing here takes one from the model. */
export async function readDiary(
  orgId: string,
  tz: string | null,
  ask: { from: string; to: string; person: string | null }
): Promise<DiaryRead> {
  if (!isDiaryDay(ask.from) || !isDiaryDay(ask.to)) return { found: false, said: "Give the days as YYYY-MM-DD." };
  if (ask.to < ask.from) return { found: false, said: "The last day is before the first." };
  const { days, capped } = diaryDays(ask.from, ask.to);

  const [everyone, rules, links, read] = await Promise.all([
    readActiveStaff(orgId),
    readRegularDaysOff(orgId).catch(() => []),
    sm8StaffByProfile(orgId).catch(() => new Map<string, string>()),
    Promise.all(days.map((d) => loadScheduleDay(orgId, d, { away: true }))),
  ]);

  /* names from everyone active, then the day's own (someone booked or off
     who has since left ServiceM8's active list) */
  const names = new Map<string, string>();
  for (const p of read.flatMap((r) => r.staff)) names.set(low(p.uuid), p.name);
  for (const p of everyone) names.set(low(p.uuid), p.name);

  let only: Set<string> | null = null;
  let person: { asked: string; matched: string[] } | undefined;
  const asked = ask.person?.trim().slice(0, 80) ?? "";
  if (asked) {
    const hits = [...names.entries()].filter(([, n]) => nameAnswers(n, asked));
    if (hits.length === 0) {
      return {
        found: false,
        said: `No one on the diary answers to "${asked}".`,
        people: [...new Set(everyone.map((p) => p.name))].sort((x, y) => x.localeCompare(y)),
      };
    }
    only = new Set(hits.map(([u]) => u));
    person = { asked, matched: [...new Set(hits.map(([, n]) => n))].sort((x, y) => x.localeCompare(y)) };
  }

  const out = await Promise.all(
    read.map(async (p) => {
      /* regular days off laid over ServiceM8's own, as the Schedule page does */
      const payload: SchedulePayload = { ...p, away: withRegular(p.away ?? [], awayOnDay(rules, p.dayISO, links)) };
      const crew = await crewNotBooked(orgId, payload, async () => null).catch(() => undefined);
      return shapeDiaryDay(payload, names, only, crew);
    })
  );

  return {
    found: true,
    zone: tz,
    ...(person ? { person } : {}),
    ...(capped ? { note: `Only ${MAX_DIARY_DAYS} days are read at once; ask again from ${plusDays(days[days.length - 1], 1)} for the rest.` } : {}),
    days: out,
  };
}
