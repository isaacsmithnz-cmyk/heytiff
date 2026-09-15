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

import { clockLabel, type ScheduleBlock } from "@/lib/workboard/schedule";
import type { RemindKind } from "./reminders";

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

/** Air below the last hour, so the closing line is not the track's own edge.

    48px and not the 20 it was: the scroller wears a fade over its bottom 8%
    (~41px of a laptop's column), and now that the rail widens to reach the
    current hour, the now marker can sit in the last few minutes of the last
    band — where the fade would have swallowed it and the time on it. The tail
    has to be deeper than the fade it has to clear. */
export const RAIL_TAIL_PX = 48;

/** Midnight, as the schedule writes it. `layoutScheduleDay` clamps a booking
    that ends on a later day to this rather than wrapping it to a smaller
    number, so an end AT it means "runs past the day" — which is why two of the
    labels below have to treat it differently from every other end. */
const DAY_MIN = 24 * 60;

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
  /** Whether `atMin` is when to DO it or when it must be DONE.

      The rail draws the two differently because they are opposite
      instructions at the same coordinate: an `at` row is a thing to be doing
      then, and a `by` row is the moment you have run out — which is why it
      wears the warning colour and says the word. See `remindKindOf`. */
  kind: RemindKind;
  /** The clock has gone past `atMin` and the task is still open. For a `by`
      row that means the deadline was MISSED, which is a stronger statement
      than an `at` row being late — but it is the same arithmetic, and the
      difference is said by `kind` rather than by a second flag. */
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
    seven or runs past five must be ON the rail, not clipped off its ends.

    NOW COUNTS AS SOMETHING TO FIT (walked on prod, 2026-09-01, 6:07pm). The
    bounds widened for ITEMS only, so a day with nothing on it was always
    7-to-5 — and past five the marker fell outside them, `showNow` went false,
    and the rail drew five hundred pixels of blank column with no sign of
    where the present was. A rail that does not contain now cannot answer the
    one question it exists for.

    Passing `null` keeps the item-only bounds, which is what a caller drawing
    a day that is not today wants. */
export function railBounds(
  items: readonly RailItem[],
  nowMin: number | null = null,
): RailBounds {
  let start = RAIL_DEFAULT_START;
  let end = RAIL_DEFAULT_END;
  for (const it of items) {
    start = Math.min(start, Math.floor(it.startMin / 60) * 60);
    end = Math.max(end, Math.ceil(it.endMin / 60) * 60);
  }
  /* The same whole-hour treatment the items get, so the marker lands inside
     the band it belongs to rather than exactly on a boundary line. */
  if (nowMin !== null) {
    start = Math.min(start, Math.floor(nowMin / 60) * 60);
    end = Math.max(end, Math.ceil(nowMin / 60) * 60);
  }
  return { startMin: start, endMin: Math.max(end, start + 60) };
}

/** "7–3pm" · "8–10am" · "9:15–2:45pm" — a booking's span, written on the card
    because the card does not draw it.

    EVERY ROW ON THIS RAIL IS THE SAME HEIGHT (see RAIL_ROW_PX), which is what
    keeps a day readable as a sequence instead of a column of tall empty
    boxes — but it means a job from seven to three looks exactly like a
    half-hour call, and the length was only ever in the row's hover title,
    which a phone does not have and a glance does not wait for.
    Isaac, 2026-09-01: *"just have the card at seven AM and just write down
    seven to three PM on the card"*. So the card says it.

    THE MERIDIEM IS SPOKEN ONCE, AT THE END — his own example is "seven till
    three PM", which is how the span is said out loud, and "7am–3pm" is how a
    form asks for it. It stays unambiguous because a booking runs forwards and
    inside one day: "7–3pm" cannot mean seven in the evening without running
    backwards. A span of twelve hours or more is the case where that stops
    being true, so it keeps both halves.

    MIDNIGHT IS THE OTHER CASE, and it is the one the "inside one day" argument
    does not cover. An end of 12am is the only end whose half is EARLIER than
    every start that can reach it, so the trailing meridiem carries backwards
    as a lie rather than as the answer: a callout booked at one in the
    afternoon and running past twelve came out "1–12am", which reads as one in
    the MORNING and is the same booking twelve hours wrong. It is not a corner
    case either — `layoutScheduleDay` clamps every booking that ends on a later
    day to midnight, so any after-lunch job that runs over lands here, and the
    twelve-hour rule above cannot catch it because those spans are short.
    Midnight keeps both halves and says "1pm–12am". */
export function railSpanLabel(startMin: number, endMin: number): string {
  const from = clockLabel(startMin);
  /* Nothing to span. The board clamps a zero or reversed booking to thirty
     minutes before it ever reaches here, so this is belt and braces. */
  if (endMin <= startMin) return from;
  const to = clockLabel(endMin);
  if (endMin - startMin >= 12 * 60 || endMin >= DAY_MIN) return `${from}–${to}`;
  return `${from.replace(/[ap]m$/, "")}–${to}`;
}

/** What the rail is missing, when it is missing something. Bookings arrive
    through ServiceM8 and the workboard; timed tasks do not, so a rail can be
    complete or short of one layer. `null` is the complete day. */
export type RailMissing = "workboard" | "link" | null;

/** Does the rail get to say the day is clear?

    ONLY WHEN IT HAS EVERYTHING. Short of a layer, an empty column is a fact
    about what could be read rather than a fact about the day, and "you are
    free until Tuesday" is the one wrong answer that looks exactly like a
    right one.

    IT IS A FUNCTION BECAUSE TWO PLACES ASK IT and they went out of step. The
    "nothing on your day" line renders on it, and the rail's open-on-now
    effect skips on it — the line sits at the TOP of the track, so opening
    three hours down would hide it. The effect had the condition written out a
    second time as `placed.length === 0`, which is the same thing only while a
    layer is present; walked on prod at 6:45pm, a rail short of ServiceM8 drew
    no line, had nothing to protect, and STILL held at the top with the now
    marker 405px below the fold. One predicate, asked twice. */
export function railSaysEmpty(itemCount: number, missing: RailMissing): boolean {
  return itemCount === 0 && missing === null;
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
    middle doesn't need to.

    HOUR 24 IS MIDNIGHT, NOT NOON. The rail reaches it whenever a booking is
    clamped to the end of the day, and `hour < 12` is false up there — so the
    closing line of a rail running into the night read "12 pm", naming the one
    hour furthest from where it sits. The clock face is already taken modulo
    twelve; the half has to be taken modulo twenty-four for the same reason. */
export function railHourLabel(hour: number, bounds: RailBounds): string {
  const first = bounds.startMin / 60;
  const last = bounds.endMin / 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  if (hour === first || hour === last) return `${h12} ${hour % 24 < 12 ? "am" : "pm"}`;
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

  const cols = packColumns(placed.map((p) => ({ start: p.top, size: p.height })));
  placed.forEach((p, i) => {
    p.col = cols[i].col;
    p.cols = cols[i].cols;
  });
  return placed;
}

/** Greedy columns over things laid along one axis — the rail's rows, or the
    band's pills. `start` and `size` are in whatever the caller DRAWS in, which
    is pixels, because what has to move apart is what would otherwise be
    painted on top of something else.

    One cluster is a run of items that overlap something already in it —
    transitively, so A/B and B/C put all three in one cluster and each gets
    its own column even though A and C never touch. Inside a cluster the
    leftmost column whose last item has finished takes the next one, so
    left-to-right order follows the clock. Items arrive in start order. */
export function packColumns(
  items: readonly { start: number; size: number }[],
): { col: number; cols: number }[] {
  const out = items.map(() => ({ col: 0, cols: 1 }));
  let cluster: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const close = () => {
    if (cluster.length === 0) return;
    const ends: number[] = [];
    for (const i of cluster) {
      let col = ends.findIndex((end) => end <= items[i].start);
      if (col < 0) {
        col = ends.length;
        ends.push(0);
      }
      ends[col] = items[i].start + items[i].size;
      out[i].col = col;
    }
    for (const i of cluster) out[i].cols = ends.length;
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };
  items.forEach((it, i) => {
    if (cluster.length > 0 && it.start >= clusterEnd) close();
    cluster.push(i);
    clusterEnd = Math.max(clusterEnd, it.start + it.size);
  });
  close();
  return out;
}

/* ── THE BAND: the same day, laid ACROSS the top of Home ─────────────────

   The rail above draws the day down a column at a fixed 64px an hour. The
   band draws it along a row whose width is whatever the card has, so the
   scale is the band's own: `ribbonScale` divides the width by the hours.
   That is the Schedule tab's own 110px an hour on a 1440 window, which is
   not a coincidence worth losing — one booking should be the same length
   on the two screens that draw it.

   A PILL IS NEVER NARROWER THAN ITS WORDS. A one-hour booking is 110px of
   axis and "3271 Richard Ferns 12:30–1:30pm" is more than that, so the pill
   grows past its hour rather than clipping the one fact a glance is after.
   The packer has to know the drawn width, not the hours, or two pills that
   overlap on screen would be told they do not; the component measures the
   words and hands them in. Before anything is measured a guess does. */

export type PlacedRibbonItem = {
  item: RailItem;
  /** Left edge, in pixels along the band. */
  x: number;
  /** Drawn width: the hours, or the words, whichever is wider. */
  w: number;
  lane: number;
  lanes: number;
};

/** Pixels per hour for a band `width` wide. */
export function ribbonScale(bounds: RailBounds, width: number): number {
  return width / ((bounds.endMin - bounds.startMin) / 60);
}

/** Where a minute sits along the band. */
export function ribbonX(min: number, bounds: RailBounds, pxPerHour: number): number {
  return ((min - bounds.startMin) / 60) * pxPerHour;
}

/** Lay the day out along the band.

    `wordsWidth` is what each pill's words come to, measured or guessed. A
    pill that would run off the band's end hugs the end instead: its start is
    still said by the span on it, and a pill hanging off the card said less.
    Pass no `width` to leave pills where their minutes put them. */
export function placeRibbon(
  items: readonly RailItem[],
  bounds: RailBounds,
  pxPerHour: number,
  wordsWidth: (item: RailItem) => number,
  width?: number,
): PlacedRibbonItem[] {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key),
  );
  const placed: PlacedRibbonItem[] = sorted.map((item) => {
    const x = ribbonX(item.startMin, bounds, pxPerHour);
    /* A task is a moment: its width is its words, never a span it did not
       claim — the same rule that keeps it from pushing a booking sideways
       on the rail. */
    const hours = item.kind === "job" ? ribbonX(item.endMin, bounds, pxPerHour) - x : 0;
    const w = Math.max(hours, wordsWidth(item));
    const left = width === undefined ? x : Math.max(0, Math.min(x, width - w));
    return { item, x: left, w, lane: 0, lanes: 1 };
  });
  const cols = packColumns(placed.map((p) => ({ start: p.x, size: p.w })));
  placed.forEach((p, i) => {
    p.lane = cols[i].col;
    p.lanes = cols[i].cols;
  });
  return placed;
}

/** How many rows the band needs — the deepest lane anything landed in. */
export function ribbonLanes(placed: readonly PlacedRibbonItem[]): number {
  return placed.reduce((n, p) => Math.max(n, p.lane + 1), 1);
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
    remindKind?: RemindKind;
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
      kind: t.remindKind ?? "at",
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
