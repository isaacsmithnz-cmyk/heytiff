/* THE DAY RAIL — one column, everything with a clock time on it.

   Home's left side answers "where should I be", and the honest answer is not
   just ServiceM8's bookings: the Hilux going in for its 60,000km service at
   7:30 owns that morning exactly as much as a job does. So the rail carries
   two kinds of thing on one timeline — bookings from the mirror, and the
   viewer's own tasks that name an hour.

   WHAT EARNS A PLACE. A booking always. A task only when it has a clock time
   — `tasks.remind_at`, which by construction shares its `due_date` (see
   docs/migrations/task_reminders.sql). A task merely due *today* stays in the
   Tasks tab: a due date is a day, not an hour, and dropping every loose to-do
   onto 5pm would say something the data never said.

   WHY THE GEOMETRY LIVES HERE and not in the component: it is the part with
   answers that can be wrong. Two bookings at once must not hide each other,
   a 15-minute call must still be readable, and a day that starts at 6am must
   not draw above its own rail. Those are decisions, so they are tested.

   Pixels, not percentages, and deliberately: the rail is a fixed column on a
   fixed-height card, the hour lines are drawn from the same constant, and a
   block that agrees with the hour beside it is the whole point of the view. */

import type { ScheduleBlock } from "@/lib/workboard/schedule";

/** The zone every ServiceM8 stamp is already written in. Matches
    `todayInZone`'s fallback so an account with no vendor row still lands
    somewhere sane rather than on the server's clock. */
const FALLBACK_TZ = "Australia/Sydney";

/** One hour of the day, in pixels. The Schedule tab's horizontal rail uses
    110px per hour across a whole screen; this is a 352px column beside a
    card, so it reads vertically at a little over half that. */
export const RAIL_PX_PER_HOUR = 64;

/** EVERY ITEM IS ONE ROW HIGH, and that is a decision rather than a
    limitation (Isaac, 2026-08-30 — the agreed design, restored).

    The first cut drew each booking at the height of its own hours, on the
    reasoning that a diary should show duration. What that produced was a
    column of big empty boxes: a 2½-hour install is 160px of mostly nothing
    with its name in the top-left corner, and the day stopped reading as a
    sequence you can scan. The rail answers "where should I be", which is a
    list of moments in order — the START time is the fact, and the block sits
    at it. Duration lives on the job card, where there is room to say it. */
export const RAIL_MIN_BLOCK_PX = 30;

/** One row, whatever the work. */
export const RAIL_ROW_PX = 30;

/** A task is a moment, not a span — it has a time, never a duration. */
export const RAIL_TASK_PX = 30;

/** The day the rail draws when nothing argues otherwise: a trade day, 7 to 5.
    Real work widens it (see `railBounds`); nothing narrows it, so an empty
    day still looks like a day rather than a blank strip. */
export const RAIL_DEFAULT_START = 7 * 60;
export const RAIL_DEFAULT_END = 17 * 60;

/** A task that named an hour, already resolved into the workspace's zone. */
export type RailTask = {
  id: string;
  title: string;
  /** Minutes past midnight, in the workspace's zone. */
  atMin: number;
  overdue: boolean;
};

export type RailItem =
  | { kind: "job"; key: string; startMin: number; endMin: number; job: ScheduleBlock }
  | { kind: "task"; key: string; startMin: number; endMin: number; task: RailTask };

/** An item with its place on the rail decided. `col`/`cols` are how a clash
    is resolved: two things at once each take half the width, three take a
    third — the calendar answer, so nothing is ever hidden behind anything. */
export type PlacedRailItem = {
  item: RailItem;
  top: number;
  height: number;
  col: number;
  cols: number;
};

export type RailBounds = { startMin: number; endMin: number };

/** Both parts of a timestamp as the workspace reads them. One formatter call
    answers "which day" and "what time", which is the only way to ask that is
    correct across a DST boundary — the two questions must agree. */
export function zonedParts(
  iso: string | null | undefined,
  tz: string | null | undefined,
): { day: string; min: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || FALLBACK_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const at = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const hour = at("hour");
    if (!hour) return null;
    /* en-CA renders midnight as "24" in some ICU versions and "00" in others.
       Both mean the same instant; only one of them is a number of hours. */
    const h = Number(hour) % 24;
    return { day: `${at("year")}-${at("month")}-${at("day")}`, min: h * 60 + Number(at("minute")) };
  } catch {
    return null;
  }
}

/** Minutes past midnight right now, in the workspace's zone. */
export function nowMinInZone(tz: string | null | undefined, now: Date = new Date()): number | null {
  return zonedParts(now.toISOString(), tz)?.min ?? null;
}

/** The hours the rail draws. Whole hours only — a rail whose first line is
    6:43 reads as a mistake — and it only ever widens: work that starts before
    seven or runs past five must be ON the rail, not clipped off its ends. */
export function railBounds(items: readonly RailItem[]): RailBounds {
  let start = RAIL_DEFAULT_START;
  let end = RAIL_DEFAULT_END;
  for (const it of items) {
    start = Math.min(start, Math.floor(it.startMin / 60) * 60);
    end = Math.max(end, Math.ceil(it.endMin / 60) * 60);
  }
  return { startMin: start, endMin: Math.max(end, start + 60) };
}

/** Where the top of a minute sits, in pixels down the rail. */
export function railTop(min: number, bounds: RailBounds): number {
  return ((min - bounds.startMin) / 60) * RAIL_PX_PER_HOUR;
}

/** The rail's own height, so the column and the hour lines agree. */
export function railHeight(bounds: RailBounds): number {
  return ((bounds.endMin - bounds.startMin) / 60) * RAIL_PX_PER_HOUR;
}

/** Every whole hour the rail should label. */
export function railHours(bounds: RailBounds): number[] {
  const hours: number[] = [];
  for (let m = bounds.startMin; m <= bounds.endMin; m += 60) hours.push(m / 60);
  return hours;
}

/** "7 am" · "12" · "5 pm" — the ends say which half of the day they are, the
    middle doesn't need to. */
export function railHourLabel(hour: number, bounds: RailBounds): string {
  const first = bounds.startMin / 60;
  const last = bounds.endMin / 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (hour === first || hour === last) return `${h12} ${hour < 12 ? "am" : "pm"}`;
  return String(h12);
}

/** Lay the day out.

    Clustering is done on PIXELS, not on minutes, and that is the whole trick:
    what has to move apart is what would otherwise be drawn on top of
    something else. A 15-minute job that draws at its 30px floor overlaps the
    booking starting twenty minutes later even though their times don't, and
    the reader can only see the drawing. Items that merely touch keep the full
    width — a 7:30 service and an 8:00 job read cleanly side by side only when
    they are NOT side by side. */
export function placeRail(items: readonly RailItem[], bounds: RailBounds): PlacedRailItem[] {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key),
  );

  const placed: PlacedRailItem[] = sorted.map((item) => ({
    item,
    top: railTop(item.startMin, bounds),
    /* One row for a booking and one for a task alike — see RAIL_ROW_PX. */
    height: RAIL_ROW_PX,
    col: 0,
    cols: 1,
  }));

  /* One cluster is a run of items that overlap something already in it —
     transitively, so A/B and B/C put all three in one cluster and each gets
     its own column even though A and C never touch. */
  let cluster: PlacedRailItem[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const groups: PlacedRailItem[][] = [];
  for (const p of placed) {
    if (cluster.length > 0 && p.top >= clusterEnd) {
      groups.push(cluster);
      cluster = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  if (cluster.length > 0) groups.push(cluster);

  for (const group of groups) {
    /* Greedy: take the leftmost column whose last item has finished by the
       time this one starts. Left-to-right order therefore follows the clock,
       which is what makes a two-column stretch readable. */
    const ends: number[] = [];
    for (const p of group) {
      let col = ends.findIndex((end) => end <= p.top);
      if (col < 0) {
        col = ends.length;
        ends.push(0);
      }
      ends[col] = p.top + p.height;
      p.col = col;
    }
    for (const p of group) p.cols = ends.length;
  }

  return placed;
}

/** Today's tasks that named an hour, in the workspace's zone.

    `remindAt` is the only time-bearing column on a task, and its day is
    `due_date` by construction — so a task is on the rail when its reminder
    lands on the rail's day, and where the reminder points is where it goes. */
export function railTasksOf(
  tasks: readonly {
    id: string;
    title: string;
    remindAt: string | null;
    dueDate: string | null;
    status: string;
  }[],
  dayISO: string,
  tz: string | null | undefined,
  nowMin: number | null,
): RailTask[] {
  const out: RailTask[] = [];
  for (const t of tasks) {
    if (t.status !== "open") continue;
    const at = zonedParts(t.remindAt, tz);
    if (!at || at.day !== dayISO) continue;
    out.push({
      id: t.id,
      title: t.title,
      atMin: at.min,
      overdue: nowMin !== null && at.min < nowMin,
    });
  }
  return out.sort((a, b) => a.atMin - b.atMin || a.id.localeCompare(b.id));
}

/** Bookings and timed tasks, as one list for the rail. */
export function railItems(
  blocks: readonly ScheduleBlock[],
  tasks: readonly RailTask[],
): RailItem[] {
  const items: RailItem[] = blocks.map((job) => ({
    kind: "job" as const,
    key: `job:${job.key}`,
    startMin: job.startMin,
    endMin: job.endMin,
    job,
  }));
  for (const task of tasks) {
    items.push({
      kind: "task",
      key: `task:${task.id}`,
      startMin: task.atMin,
      /* A moment, drawn at the task floor. Giving it a fake half-hour span
         would push real bookings sideways for time nobody claimed. */
      endMin: task.atMin,
      task,
    });
  }
  return items;
}
