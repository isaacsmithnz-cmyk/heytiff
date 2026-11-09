/* HOME › TODAY (v2, docs/design.md rule 39) — the pure half.

   The viewer's own day: their bookings from the board's own lane (the
   loader's `rail.blocks`, already narrowed to them) and their tasks that
   named an hour (`rail.tasks`), in time order, one row each. A row is a
   time, the job's colour dot or a tick for a task, the name in bold with a
   grey line under it, and a state word on the right when there is one.

   It replaces the old Home's day bar ("Your day"), and reads the same
   rail: nothing here is a new read. The clock is the page's own minute
   (`rail.nowMin`, built on the server in the workspace's zone), so the
   words are dated with the data and the server and the browser agree. */

import type { Hue } from "@/components/parts/state";
import { jobHue } from "@/lib/workboard/job-hue";
import { jobPageHref } from "@/lib/shell/links";
import type { DayExtras } from "./event-mobile";
import type { RsvpAnswer } from "./events";
import type { HomeRail } from "./page-data";

export type TodayState = { tone: "good" | "look" | "wrong" | "info"; word: string };

export type TodayRow = {
  key: string;
  kind: "job" | "task" | "event";
  /** "7:30 to 8:30", a task's "12:30" / "By 12:30", an event's "6:30" or "All day". */
  time: string;
  /** The job's colour (rule 18); null for a task, which leads with a tick. */
  hue: Hue | null;
  name: string;
  line: string;
  state: TodayState | null;
  /** Where the row opens: the job's own page, or an event's notice on
      Team's noticeboard. Null for a task. */
  href: string | null;
  /** The task a tick completes. Null for a job. */
  taskId: string | null;
};

/** "7:30", "12:45": a day reads in order, so no am or pm, as the board draws it. */
export function clock(min: number): string {
  const whole = Math.round(min);
  const h = Math.floor(whole / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(whole % 60).padStart(2, "0")}`;
}

/** "Lyle", "Lyle and Callum", "Lyle, Callum and Dan". */
export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const own = <V>(rec: Readonly<Record<string, V>>, key: string): V | undefined =>
  Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;

/* AN EVENT ON TODAY (Isaac, 6 November 2026, the events and birthdays mock,
   https://claude.ai/artifact/L2p2fNKwDBzWJymNtwpXja, as the phone's Today
   draws it: heytiff-mobile's EventCard). The noticeboard's event on its
   day: a calendar where a task's tick goes, the title, where, and your
   answer on the right; not answered yet, it asks, in orange. An event with
   no time is the whole day's, and reads first. */
const SAID: Record<RsvpAnswer, string> = {
  plus_one: "You and your partner",
  yes: "You’re going",
  maybe: "Maybe",
  no: "Can’t make it",
};

/** Your answer to an event, as Today says it. */
export function eventState(answer: RsvpAnswer | null): TodayState {
  return answer ? { tone: "info", word: SAID[answer] } : { tone: "look", word: "Are you coming?" };
}

/** An event's notice on Team's noticeboard, where it is answered. */
export const eventHref = (id: string) => `/dashboard/team?view=notices#notice-${id}`;

const minOf = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Under Today: whose birthday it is, one line each, from those who share
    it, in the phone's words. */
export function birthdayLines(list: DayExtras["birthdays"]): string[] {
  return list.map((b) => (b.age != null ? `${b.name} turns ${b.age} today` : `It’s ${b.name}’s birthday`));
}

/** The rows, in time order: the day's bookings, its timed tasks and its events. */
export function todayRows(
  rail: Pick<HomeRail, "blocks" | "tasks" | "crew" | "nowMin">,
  events: DayExtras["events"] = [],
): TodayRow[] {
  const now = rail.nowMin;
  const rows: (TodayRow & { at: number })[] = [];
  for (const e of events) {
    const at = e.time ? minOf(e.time) : null;
    rows.push({
      at: at ?? -1,
      key: `event:${e.id}`,
      kind: "event",
      time: at === null ? "All day" : clock(at),
      hue: null,
      name: e.title,
      line: e.location ?? "",
      state: eventState(e.answer),
      href: eventHref(e.id),
      taskId: null,
    });
  }
  for (const b of rail.blocks) {
    const number = b.jobNumber?.trim() || null;
    const place = b.suburb?.trim() || b.clientName?.trim() || null;
    const name = number ? (place ? `${place}, Job ${number}` : `Job ${number}`) : (place ?? "Unnamed client");
    const crew = own(rail.crew, b.remoteId) ?? [];
    const kind = b.categoryName?.trim() || b.tracked?.label?.trim() || "Visit";
    const line = crew.length > 0 ? `${kind}, with ${andList(crew)}` : `${kind}, you`;
    const done = b.closure === "done" || (now !== null && now >= b.endMin);
    const state: TodayState | null = done
      ? { tone: "good", word: "Done" }
      : b.closure === "stale"
        ? { tone: "look", word: "Job closed" }
        : now !== null && now >= b.startMin
          ? { tone: "good", word: "On now" }
          : null;
    rows.push({
      at: b.startMin,
      key: `job:${b.key}`,
      kind: "job",
      time: b.endMin > b.startMin ? `${clock(b.startMin)} to ${clock(b.endMin)}` : clock(b.startMin),
      hue: jobHue(b.categoryColour, b.status),
      name,
      line,
      state,
      href: jobPageHref(b.remoteId),
      taskId: null,
    });
  }
  for (const t of rail.tasks) {
    rows.push({
      at: t.atMin,
      key: `task:${t.id}`,
      kind: "task",
      time: t.kind === "by" ? `By ${clock(t.atMin)}` : clock(t.atMin),
      hue: null,
      name: t.title,
      line: "Task",
      state: t.overdue ? { tone: "wrong", word: "Late" } : null,
      href: null,
      taskId: t.id,
    });
  }
  return rows
    .sort((a, b) => a.at - b.at || a.key.localeCompare(b.key))
    .map(({ at: _at, ...row }) => row);
}

const counted = (n: number, one: string, many: string): string =>
  n === 0 ? "" : n === 1 ? `a ${one}` : `${n} ${many}`;

/** The grey line beside Today: "4 jobs and a task". A job booked twice
    today is one job. */
export function todaySummary(rows: readonly TodayRow[], blocks: readonly { remoteId: string }[]): string {
  const jobs = new Set(blocks.map((b) => b.remoteId)).size;
  const tasks = rows.filter((r) => r.kind === "task").length;
  const parts = [counted(jobs, "job", "jobs"), counted(tasks, "task", "tasks")].filter(Boolean);
  const said = parts.join(" and ");
  return said ? said.charAt(0).toUpperCase() + said.slice(1) : "Nothing booked";
}

/** What Home's Today draws. */
export type TodayView = {
  rows: TodayRow[];
  summary: string;
  /** What Today says when it has no rows. */
  empty: { what: string; line: string | null; action: { label: string; href: string } | null };
  /** The Workboard's day, for whoever may see it. */
  schedule: boolean;
  /** Under the head: whose birthday it is, from those who share it. */
  birthdays?: string[];
};
