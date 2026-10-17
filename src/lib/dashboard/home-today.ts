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
import type { HomeRail } from "./page-data";

export type TodayState = { tone: "good" | "look" | "wrong"; word: string };

export type TodayRow = {
  key: string;
  kind: "job" | "task";
  /** "7:30 to 8:30", or a task's "12:30" / "By 12:30". */
  time: string;
  /** The job's colour (rule 18); null for a task, which leads with a tick. */
  hue: Hue | null;
  name: string;
  line: string;
  state: TodayState | null;
  /** Where the row opens: the job's own page. Null for a task. */
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

/** The rows, in time order. */
export function todayRows(rail: Pick<HomeRail, "blocks" | "tasks" | "crew" | "nowMin">): TodayRow[] {
  const now = rail.nowMin;
  const rows: (TodayRow & { at: number })[] = [];
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
      hue: jobHue(b.categoryColour, (b.status ?? "").trim().toLowerCase() === "unsuccessful"),
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
};
