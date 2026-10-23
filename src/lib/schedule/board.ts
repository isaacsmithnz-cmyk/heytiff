/* THE SCHEDULE'S PURE HALF (v2, step 5, 18 October: "build this and I'll
   test"; docs/plans/layout-2026-10/6-revisions.md). A row per person, time
   across, for a day or a working week, laid out from the same day payloads
   the Workboard's Schedule tab reads (schedule-query), and the questions the
   board asks while a job is held over it: is this person free for these
   hours, and for which of these days.

   TIME IS TEXT, as everywhere on the diary: days are 'YYYY-MM-DD' and times
   are minutes past midnight on the account's own clock. The one Date here
   reads a DAY, never a time, so no zone can move it. */

import { layoutScheduleDay, type ScheduleBlock } from "@/lib/workboard/schedule";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import { jobHue } from "@/lib/workboard/job-hue";
import type { Hue } from "@/components/parts/state";

export type ScheduleView = "day" | "week" | "weeks" | "month";

/** The 4 weeks view: how many weeks, from the Monday of the week asked for. */
export const WEEKS_SHOWN = 4;

/** The strip: 7 am to 5 pm. A booking outside it still widens it. */
export const STRIP_START = 7 * 60;
export const STRIP_END = 17 * 60;
/** The working day the board shades after, and a week's day is booked as. */
export const WORK_START = 7 * 60;
export const WORK_END = 15 * 60 + 30;
/** A day of a multi-day job: 7:00 to 3:00, eight hours, a length Book in takes. */
export const DAY_JOB_MINUTES = 480;
/** How many days a job can be dropped as, in the week. */
export const MAX_DAYS = 5;
export const SNAP_MIN = 15;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isDay = (d: unknown): d is string => typeof d === "string" && DAY.test(d);

function dateOf(day: string): Date {
  const m = DAY.exec(day)!;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  const d = dateOf(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** 0 Sunday … 6 Saturday. */
export const weekdayOf = (day: string) => dateOf(day).getUTCDay();
export const isWeekend = (day: string) => weekdayOf(day) === 0 || weekdayOf(day) === 6;

/** The Monday to Friday of the week `day` is in (a weekend day reads as the
    week before it ends: Saturday and Sunday belong to the week just gone). */
export function weekOf(day: string): string[] {
  const wd = weekdayOf(day);
  const monday = addDays(day, wd === 0 ? -6 : 1 - wd);
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

/** The days the board shows: the 4 weeks view's are its weekdays, Monday on. */
export function daysFor(view: ScheduleView, day: string): string[] {
  if (view === "month") return monthDays(day);
  if (view === "weeks") {
    const monday = weekOf(day)[0];
    return Array.from({ length: WEEKS_SHOWN }, (_, w) => weekOf(addDays(monday, 7 * w))).flat();
  }
  return view === "week" ? weekOf(day) : [day];
}

/** Earlier and Later: a weekday at a time, or a week. */
export function stepDay(view: ScheduleView, day: string, dir: 1 | -1): string {
  if (view === "month") {
    const y = Number(day.slice(0, 4));
    const m = Number(day.slice(5, 7)) - 1 + dir;
    return iso(new Date(Date.UTC(y, m, 1)));
  }
  if (view === "weeks") return addDays(weekOf(day)[0], 7 * WEEKS_SHOWN * dir);
  if (view === "week") return addDays(weekOf(day)[0], 7 * dir);
  let d = addDays(day, dir);
  while (isWeekend(d)) d = addDays(d, dir);
  return d;
}

/** `count` working days from `start` on (Saturday and Sunday skipped):
    a job of three days dropped on a Friday runs Friday, Monday, Tuesday. */
export function workingDaysFrom(start: string, count: number): string[] {
  const out: string[] = [];
  let d = start;
  while (out.length < count) {
    if (!isWeekend(d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** 540 → "9", 570 → "9:30", 780 → "1"; with `ampm`, "9 am", "1 pm". */
export function clockWord(mins: number, ampm = false): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const t = m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, "0")}`;
  return ampm ? `${t} ${h < 12 ? "am" : "pm"}` : t;
}
export const spanWord = (a: number, b: number) => `${clockWord(a)} to ${clockWord(b)}`;
export const toHHMM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** "2 h", "1 h 30", "30 min" */
export function lengthWord(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

export const snap = (mins: number, step = SNAP_MIN) => Math.round(mins / step) * step;

/** One booking on a person's day. */
export type DayBlock = {
  key: string;
  jobUuid: string;
  number: string | null;
  client: string | null;
  suburb: string | null;
  hue: Hue;
  startMin: number;
  endMin: number;
  /** the others on the same job that day, by name */
  with: string[];
  /** ServiceM8's category, its own words ("Install"), or null */
  kind: string | null;
  /** where the booking is up to, said on the card: on site now, done, the
      job marked complete while this day is still on the run, or a job that
      didn't go ahead; null while it is just booked */
  state: "onsite" | "done" | "stale" | "unsuccessful" | null;
};

export type DayAway = { key: string; word: string; startMin: number; endMin: number; whole: boolean };

export type PersonRow = {
  staffUuid: string;
  name: string;
  /** by day, in the board's day order */
  days: { day: string; blocks: DayBlock[]; away: DayAway[] }[];
};

export type Board = {
  days: string[];
  people: PersonRow[];
  /** the strip's bounds, widened by whole hours to fit what is booked */
  stripStart: number;
  stripEnd: number;
};

const low = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** Every person ServiceM8 names, A to Z, with their bookings and time off on
    each day. The unassigned lane ("Nobody named") isn't a person and isn't
    drawn: a booking with no one on it can't be made here. */
export function boardOf(payloads: readonly SchedulePayload[]): Board {
  const staff = new Map<string, string>();
  for (const p of payloads) for (const s of p.staff) if (!staff.has(low(s.uuid))) staff.set(low(s.uuid), s.uuid);
  const names = new Map<string, string>();
  for (const p of payloads) for (const s of p.staff) names.set(low(s.uuid), s.name);

  let stripStart = STRIP_START;
  let stripEnd = STRIP_END;
  const perDay = payloads.map((p) => {
    const laid = layoutScheduleDay({
      activities: p.activities,
      staff: p.staff,
      jobs: p.jobs,
      away: p.away ? { dayISO: p.dayISO, rows: p.away } : undefined,
    });
    stripStart = Math.min(stripStart, laid.railStart);
    stripEnd = Math.max(stripEnd, laid.railEnd);
    const byJob = new Map<string, string[]>();
    for (const lane of laid.lanes) {
      if (!lane.staffUuid) continue;
      for (const b of lane.blocks) byJob.set(b.remoteId, [...(byJob.get(b.remoteId) ?? []), lane.name]);
    }
    const lanes = new Map(laid.lanes.filter((l) => l.staffUuid).map((l) => [low(l.staffUuid), l]));
    return { day: p.dayISO, lanes, byJob };
  });

  const block = (b: ScheduleBlock, me: string, byJob: Map<string, string[]>): DayBlock => ({
    key: b.key,
    jobUuid: b.remoteId,
    number: b.jobNumber,
    client: b.clientName,
    suburb: b.suburb,
    /* red follows the Unsuccessful status, never the category (rule 18) */
    hue: jobHue(b.categoryColour, b.status === "Unsuccessful"),
    startMin: b.startMin,
    endMin: b.endMin,
    with: [...new Set((byJob.get(b.remoteId) ?? []).filter((n) => n !== me))],
    kind: b.categoryName?.trim() || null,
    state:
      b.status === "Unsuccessful" ? "unsuccessful"
      : b.closure === "stale" ? "stale"
      : b.closure === "done" ? "done"
      : b.onSite ? "onsite"
      : null,
  });


  const people: PersonRow[] = [...staff.entries()]
    .map(([key, uuid]) => {
      const name = names.get(key) ?? "";
      return {
        staffUuid: uuid,
        name,
        days: perDay.map((d) => {
          const lane = d.lanes.get(key);
          return {
            day: d.day,
            blocks: (lane?.blocks ?? []).map((b) => block(b, name, d.byJob)),
            away: (lane?.away ?? []).map((a) => ({ key: a.key, word: a.word, startMin: a.startMin, endMin: a.endMin, whole: a.whole })),
          };
        }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { days: payloads.map((p) => p.dayISO), people, stripStart, stripEnd };
}

/** TWO AT ONCE (Isaac, 23 October, the mock "Schedule card colour"): a
    person's bookings that overlap stack, each on a line of its own in the
    lane, so nothing is drawn over anything. Each booking takes the first
    line it fits on; `clash` holds the ones that overlap another. */
export function stackDay(blocks: readonly DayBlock[]): { line: Map<string, number>; lines: number; clash: Set<string> } {
  const line = new Map<string, number>();
  const ends: number[] = [];
  const clash = new Set<string>();
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  for (const b of sorted) {
    let i = ends.findIndex((end) => end <= b.startMin);
    if (i < 0) i = ends.push(0) - 1;
    ends[i] = b.endMin;
    line.set(b.key, i);
  }
  for (const a of sorted)
    for (const b of sorted) if (a !== b && a.startMin < b.endMin && b.startMin < a.endMin) clash.add(a.key);
  return { line, lines: Math.max(1, ends.length), clash };
}

/** A person against some hours on one day. */
export type Fit =
  | { kind: "free" }
  /** free for part of it: from a time, till a time, or a gap inside */
  | { kind: "part"; from: number; to: number }
  | { kind: "busy"; what: string }
  | { kind: "away"; word: string };

const jobWord = (b: DayBlock) => (b.number ? `job ${b.number}` : b.client ?? "another job");

/** Is this person free from `start` to `end` on that day? Time off wins (it
    is said in the business's own word); then a booking that covers all of it;
    then the largest free stretch inside, an hour or more, as part free. */
export function fitOf(d: { blocks: DayBlock[]; away: DayAway[] }, start: number, end: number): Fit {
  const off = d.away.find((a) => a.startMin < end && a.endMin > start);
  if (off) return { kind: "away", word: off.word };
  const over = d.blocks.filter((b) => b.startMin < end && b.endMin > start).sort((a, b) => a.startMin - b.startMin);
  if (over.length === 0) return { kind: "free" };
  let t = start;
  let best: { from: number; to: number } | null = null;
  for (const b of over) {
    if (b.startMin > t && (!best || b.startMin - t > best.to - best.from)) best = { from: t, to: b.startMin };
    t = Math.max(t, b.endMin);
  }
  if (end > t && (!best || end - t > best.to - best.from)) best = { from: t, to: end };
  if (best && best.to - best.from >= 60) return { kind: "part", ...best };
  return { kind: "busy", what: jobWord(over[0]) };
}

/** What a Fit says on the person's row. */
export function fitWord(f: Fit, start: number, end: number): string {
  if (f.kind === "free") return `Free ${spanWord(start, end)}`;
  if (f.kind === "away") return f.word;
  if (f.kind === "busy") return `On ${f.what}`;
  if (f.from === start) return `Free till ${clockWord(f.to)}`;
  if (f.to === end) return `Free from ${clockWord(f.from)}`;
  return `Free ${spanWord(f.from, f.to)}`;
}

/** A person's working day: whole days' booked, part days and away, as a
    line under their name ("Free all day", "Free 6.5 h", "Leave"). Free time
    under an hour says nothing (Isaac, 22 October: "Free 0.5 h" was under
    nine names), so the people with room stand out. */
export function dayLine(d: { blocks: DayBlock[]; away: DayAway[] }): string {
  const whole = d.away.find((a) => a.whole);
  if (whole) return whole.word;
  const busy = [...d.blocks, ...d.away]
    .map((x) => [Math.max(x.startMin, WORK_START), Math.min(x.endMin, WORK_END)] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let t = WORK_START;
  let free = 0;
  for (const [a, b] of busy) {
    if (a > t) free += a - t;
    t = Math.max(t, b);
  }
  if (WORK_END > t) free += WORK_END - t;
  if (free >= WORK_END - WORK_START) return "Free all day";
  if (free < 60) return "";
  return `Free ${Math.round((free / 60) * 2) / 2} h`;
}

/** A week's line: how many of its days have nothing booked and no time off. */
export function weekLine(row: PersonRow): string {
  const free = row.days.filter((d) => d.blocks.length === 0 && d.away.length === 0).length;
  if (free === row.days.length) return "Free all week";
  if (free === 0) return "Booked all week";
  return `${free} day${free === 1 ? "" : "s"} free`;
}

/** A multi-day drop against one person: which of the days they're free for
    the working day, and why not on the others. Days off the board (a job
    running into next week) are unknown, and are booked as free: the drop's
    question is about what the board can see. */
export function daysFit(row: PersonRow, days: readonly string[]): { free: string[]; not: { day: string; why: string }[] } {
  const free: string[] = [];
  const not: { day: string; why: string }[] = [];
  for (const day of days) {
    const d = row.days.find((x) => x.day === day);
    if (!d) {
      free.push(day);
      continue;
    }
    const f = fitOf(d, WORK_START, WORK_START + DAY_JOB_MINUTES);
    if (f.kind === "free") free.push(day);
    else not.push({ day, why: f.kind === "away" ? f.word : f.kind === "busy" ? `on ${f.what}` : fitWord(f, WORK_START, WORK_START + DAY_JOB_MINUTES).toLowerCase() });
  }
  return { free, not };
}

/** "Monday", "Tue 27" */
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayWord = (day: string) => WD[weekdayOf(day)];
export const dayHead = (day: string) => `${WD[weekdayOf(day)].slice(0, 3)} ${Number(day.slice(8, 10))}`;

/** "Monday and Tuesday", "Monday, Tuesday and Thursday" */
export function listDays(days: readonly string[]): string {
  const w = days.map(weekdayWord);
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}

/** How full a day is, as a word (the 4 weeks board): Room under 85%, Full to
    100%, Over past it. No crew hours, no word. */
export function fillWord(fillPct: number | null, over: boolean): "Room" | "Full" | "Over" | null {
  if (fillPct === null) return null;
  if (over) return "Over";
  return fillPct >= 85 ? "Full" : "Room";
}

/** "18 h", "7.5 h" */
export const hoursWord = (minutes: number) => `${Math.round((minutes / 60) * 2) / 2} h`;

/** The weekdays of the month a day is in. */
export function monthDays(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
}
