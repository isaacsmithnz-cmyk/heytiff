/* THE HOME CALENDAR'S MODEL: the maths behind 4 weeks, Month and Year.

   A port of the prototype's view maths (his handoff "Calendar", built out in
   proto/calendar.mjs) into pure functions: items in, rows, cells and words
   out. No database, no clock, no DOM. The page keeps the state (view, anchor,
   filters, the one selection) and draws what these return.

   The calendar is company-wide: public and school holidays, company events
   (a shutdown is an event with a range) and admin due dates (rego, insurance,
   green slip, the business's own cover). No job bookings, nobody's leave.

   Dates are plain ISO days in the org's zone. `today` comes from the server
   in the frame, read on the org's clock, so a render never reads a clock and
   the server and the browser draw the same page. Ranges are inclusive: an
   item's `end` is its last day, the same as `start` for one day. */

import { DAYS_PER_MONTH } from "@/lib/format/duration";
import {
  DASH,
  MONTH_NAMES,
  MONTH_NAMES_LONG,
  columnOf,
  dateOf,
  datesLabel,
  dayLabel,
  dayName,
  dayRangeLabel,
  fromDay,
  isWeekend,
  minutesOf,
  monthEnd,
  monthKey,
  monthLongLabel,
  monthOf,
  monthStartOfKey,
  monthYearLabel,
  monthsOn,
  timeLabel,
  timeRangeLabel,
  toDay,
  yearOf,
} from "./days";

/* ── the item ── */

export type CalCat = "hol" | "school" | "event" | "admin";

/** What an admin row's button, or the panel's first action, opens. */
export type CalAction = { label: string; href: string } | "edit";

/** One thing on the calendar. The loader (items.ts) builds these from the
    public holidays, school terms, calendar events, notice events, Assets and
    Admin; the model reads the fields below and passes everything else through,
    so a richer item type flows out the other side unchanged. */
export type CalItem = {
  /** Namespaced by source: ph:, sch:, ev:, nt:, veh:<id>:rego, cred:. */
  id: string;
  cat: CalCat;
  /** ISO yyyy-mm-dd, inclusive. */
  start: string;
  /** ISO yyyy-mm-dd, inclusive: the last day, the same as `start` for one day. */
  end: string;
  title: string;
  /** The shorter title a month cell has room for: "Trailer rego". */
  monthTitle?: string | null;
  /** The month cell's second line for admin: the plate. Defaults to "Due". */
  monthMeta?: string | null;
  /** Wall-clock start and end, "06:45" (a Postgres time) or "6:45 am". */
  time?: string | null;
  timeEnd?: string | null;
  /** The agenda and rail line under the title: "From Assets.", "The yard." */
  sub?: string | null;
  /** The panel's sentence: "The rego on TC22BJ runs out on Tue 20 Oct." */
  description?: string | null;
  facts?: ReadonlyArray<readonly [string, string]>;
  action?: CalAction | null;
  /** Admin only: past its date. Set by the loader from the same expiry state
      the bell uses, so the calendar and the bell can never disagree. */
  overdue?: boolean;
  /** An event that closes the business for its range. */
  shutdown?: boolean;
  /** School holidays: the day students go back (ISO), and the season. */
  back?: string | null;
  season?: string | null;
};

/** The things a render needs besides the items: today and the window, all on
    the org's clock, and the state whose holidays these are ("NSW"). The
    loader's CompanyCalendar carries the same fields, so it passes as it is. */
export type CalFrame = {
  today: string;
  windowStart: string;
  windowEnd: string;
  stateName: string;
};

export type CalView = "4w" | "month" | "year";
export type DayRange = { start: string; end: string };
/** The filters: a category set true is switched off. */
export type CalOff = Partial<Record<CalCat, boolean>>;

/* Within a day: public holiday, school holidays, events by time, then admin. */
const RANK = { hol: 0, school: 1, event: 2, admin: 3 } as const satisfies Record<CalCat, number>;

/** The chips' order, which is also the legend's. */
export const CHIP_ORDER: readonly CalCat[] = ["hol", "event", "admin", "school"];
const CHIP_LABEL = {
  hol: "Public holidays",
  event: "Events",
  admin: "Admin",
  school: "School holidays",
} as const satisfies Record<CalCat, string>;

/* ── the ISO face of the day formats, for the views and the loader ── */

const must = (iso: string, what: string): number => {
  const n = toDay(iso);
  if (Number.isNaN(n)) throw new Error(`calendar: ${what} is not an ISO day: ${JSON.stringify(iso)}`);
  return n;
};

/** "Mon 5 Oct". */
export const fmtDay = (iso: string): string => dayLabel(must(iso, "day"));
/** "Mon 5 Oct", "Mon 5 – Fri 9 Oct", "Mon 28 Sept – Fri 9 Oct". */
export const fmtDayRange = (a: string, b: string): string => dayRangeLabel(must(a, "start"), must(b, "end"));
/** "5 Oct", "5 – 11 Oct", "28 Sept – 2 Oct". */
export const fmtDates = (a: string, b: string): string => datesLabel(must(a, "start"), must(b, "end"));
/** "6:45 am" from "06:45", "06:45:00" or "6:45 am". */
export const fmtTime = timeLabel;
/** "6:45 – 7:15 am". */
export const fmtTimeRange = timeRangeLabel;

/* ── internals: an item with its days as numbers, read once per call ── */

type Span<T extends CalItem> = { x: T; s: number; e: number };

/* An item whose start is not a day is dropped rather than drawn on the wrong
   day or thrown over the whole page; an end before its start (or no end at
   all) is a one-day item. */
function spansOf<T extends CalItem>(items: readonly T[]): Span<T>[] {
  const out: Span<T>[] = [];
  for (const x of items) {
    const s = toDay(x.start);
    if (Number.isNaN(s)) continue;
    const e = toDay(x.end);
    out.push({ x, s, e: Number.isNaN(e) || e < s ? s : e });
  }
  return out;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const mins = (x: CalItem): number => minutesOf(x.time) ?? -1;

function byOrder<T extends CalItem>(p: Span<T>, r: Span<T>): number {
  return RANK[p.x.cat] - RANK[r.x.cat] || mins(p.x) - mins(r.x) || cmpStr(p.x.title, r.x.title) || cmpStr(p.x.id, r.x.id);
}

type Frame = { t: number; w0: number; w1: number; state: string };
function frameOf(f: CalFrame): Frame {
  return { t: must(f.today, "today"), w0: must(f.windowStart, "windowStart"), w1: must(f.windowEnd, "windowEnd"), state: f.stateName };
}

const covers = (p: { s: number; e: number }, n: number): boolean => p.s <= n && p.e >= n;
const isShutdown = (x: CalItem): boolean => x.cat === "event" && !!x.shutdown;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ── the window and the views ── */

/** The frame for a render: the window runs from the 1st of this month to the
    last day of the 11th month after it, twelve months in all. */
export function calFrame(today: string, stateName: string): CalFrame {
  const t = must(today, "today");
  return {
    today,
    windowStart: fromDay(monthsOn(t, 0)),
    windowEnd: fromDay(monthsOn(t, 12) - 1),
    stateName,
  };
}

/* Year pages in twelve-month windows counted from this month, whichever holds the anchor. */
function yearStart(a: number, t: number): number {
  const k = monthKey(t) + 12 * Math.floor((monthKey(a) - monthKey(t)) / 12);
  return monthStartOfKey(k);
}

function rangeOf(view: CalView, a: number, f: Frame): [number, number] {
  if (view === "4w") return [a, a + 27];
  if (view === "month") {
    const first = monthsOn(a, 0);
    const last = monthEnd(a);
    return [first - columnOf(first), last + (6 - columnOf(last))];
  }
  const first = yearStart(a, f.t);
  return [first, monthsOn(first, 12) - 1];
}

/** The days a view shows: 4 weeks is the anchor plus 27 days; Month is whole
    Monday-first weeks around the anchor's month; Year is twelve months. */
export function viewRange(view: CalView, anchor: string, frame: CalFrame): DayRange {
  const [s, e] = rangeOf(view, must(anchor, "anchor"), frameOf(frame));
  return { start: fromDay(s), end: fromDay(e) };
}

/** "24 Sept – 21 Oct", "October 2026", "Sept 2026 – Aug 2027". */
export function rangeTitle(view: CalView, anchor: string, frame: CalFrame): string {
  const a = must(anchor, "anchor");
  const [s, e] = rangeOf(view, a, frameOf(frame));
  if (view === "4w") return datesLabel(s, e);
  if (view === "month") return monthLongLabel(a);
  return `${monthYearLabel(s)}${DASH}${monthYearLabel(e)}`;
}

/** Whether today's range is the one in view, so Today rests: the four weeks
    from today, this month, the twelve months from this one. */
export function isHome(view: CalView, anchor: string, frame: CalFrame): boolean {
  const a = must(anchor, "anchor");
  const t = must(frame.today, "today");
  if (view === "4w") return a === t;
  if (view === "month") return monthKey(a) === monthKey(t);
  return yearStart(a, t) === yearStart(t, t);
}

function clampTo(view: CalView, a: number, f: Frame): number {
  const hi = view === "4w" ? f.w1 - 27 : f.w1;
  return Math.min(Math.max(a, f.w0), hi);
}

/** An anchor moved inside the window for a view: four weeks stop at its first
    and last days, Month and Year at its edges. */
export function clampAnchor(view: CalView, anchor: string, frame: CalFrame): string {
  return fromDay(clampTo(view, must(anchor, "anchor"), frameOf(frame)));
}

/** Where ‹ or › goes: four weeks, a month or twelve months on, kept inside the
    window, where there is nothing true to show. Null when the arrow rests. */
export function stepAnchor(view: CalView, anchor: string, dir: -1 | 1, frame: CalFrame): string | null {
  const a = must(anchor, "anchor");
  const f = frameOf(frame);
  if (view === "4w") {
    const n = clampTo("4w", a + 28 * dir, f);
    return n === a ? null : fromDay(n);
  }
  if (view === "month") {
    const n = monthsOn(a, dir);
    return monthKey(n) < monthKey(f.w0) || monthKey(n) > monthKey(f.w1) ? null : fromDay(n);
  }
  const n = monthsOn(yearStart(a, f.t), 12 * dir);
  return n < f.w0 || monthsOn(n, 12) - 1 > f.w1 ? null : fromDay(n);
}

/** The page's place: the view, the anchor its range is built from, and where
    4 weeks last stood, so going back to it returns there. */
export type CalNav = { view: CalView; anchor: string; a4: string };

export function startNav(frame: CalFrame): CalNav {
  return { view: "4w", anchor: frame.today, a4: frame.today };
}

/** A view change keeps one anchor, set right for the view: four weeks come
    back to where they were if the month is the same, to today in this month,
    or to the 1st of the month Month or Year was on. */
export function switchView(nav: CalNav, to: CalView, frame: CalFrame): CalNav {
  if (to === nav.view) return nav;
  const f = frameOf(frame);
  const a = must(nav.anchor, "anchor");
  const a4 = nav.view === "4w" ? a : must(nav.a4, "a4");
  let anchor = a;
  if (to === "4w") {
    const back = monthKey(a) === monthKey(a4) ? a4 : monthKey(a) === monthKey(f.t) ? f.t : monthsOn(a, 0);
    anchor = clampTo("4w", back, f);
  }
  return { view: to, anchor: fromDay(anchor), a4: fromDay(a4) };
}

/** Brings a day into view, for something just added: four weeks stay on
    today when the day is inside them, otherwise the view moves to the day. */
export function revealDay(nav: CalNav, day: string, frame: CalFrame): CalNav {
  const f = frameOf(frame);
  const n = must(day, "day");
  const [s, e] = rangeOf(nav.view, must(nav.anchor, "anchor"), f);
  if (n >= s && n <= e) return nav;
  const target = nav.view === "4w" && n >= f.t && n - f.t < 28 ? f.t : n;
  return { ...nav, anchor: fromDay(clampTo(nav.view, target, f)) };
}

/* ── filters, chips and the selection ── */

export function visibleItems<T extends CalItem>(items: readonly T[], off: CalOff): T[] {
  return items.filter((x) => !off[x.cat]);
}

export type CalChip = { cat: CalCat; label: string; count: number | null };

/** The chips, which are also the legend: each counts what touches the visible
    range, over every item, so turning one off never changes a count. School
    holidays carry no count. Admin is absent without admin data (the viewer
    cannot see Assets or Admin), School holidays where the state has no rows. */
export function chipCounts<T extends CalItem>(
  items: readonly T[],
  range: DayRange,
  present: { admin: boolean; school: boolean },
): CalChip[] {
  const s = must(range.start, "range start");
  const e = must(range.end, "range end");
  const P = spansOf(items);
  return CHIP_ORDER.filter((c) => (c === "admin" ? present.admin : c === "school" ? present.school : true)).map((cat) => ({
    cat,
    label: CHIP_LABEL[cat],
    count: cat === "school" ? null : P.filter((p) => p.x.cat === cat && p.s <= e && p.e >= s).length,
  }));
}

/** What the panel shows before anything is clicked, so it is never empty: the
    first thing from today that is not already late. */
export function firstSelection<T extends CalItem>(vis: readonly T[], frame: CalFrame): string | null {
  const t = must(frame.today, "today");
  const next = spansOf(vis)
    .filter((p) => p.e >= t && !p.x.overdue)
    .sort((p, r) => p.s - r.s || byOrder(p, r));
  return next[0]?.x.id ?? vis[0]?.id ?? null;
}

/** The selection after a filter changed: kept while it is still shown,
    otherwise the first thing from today. With nothing shown it stays. */
export function settleSelection<T extends CalItem>(sel: string | null, vis: readonly T[], frame: CalFrame): string | null {
  if (sel && (vis.some((x) => x.id === sel) || vis.length === 0)) return sel;
  return firstSelection(vis, frame) ?? sel;
}

/* ── long weekends ── */

function holidayDays<T extends CalItem>(P: readonly Span<T>[]): Set<number> {
  const out = new Set<number>();
  for (const p of P) if (p.x.cat === "hol") for (let n = p.s; n <= p.e; n++) out.add(n);
  return out;
}

/* A day off (a weekend or a public holiday) that joins others to make three or
   more in a row. Only a day that is itself off can be in one. */
function longWeekendOf(n: number, hols: ReadonlySet<number>): [number, number] | null {
  const off = (d: number) => isWeekend(d) || hols.has(d);
  if (!off(n)) return null;
  let a = n;
  let b = n;
  while (off(a - 1)) a--;
  while (off(b + 1)) b++;
  return b - a >= 2 ? [a, b] : null;
}

/** The long weekend a day belongs to, from the public holidays among the
    items: Labour Day, Mon 5 Oct 2026, makes Sat 3 – Mon 5 Oct. */
export function longWeekend<T extends CalItem>(day: string, items: readonly T[]): DayRange | null {
  const lw = longWeekendOf(must(day, "day"), holidayDays(spansOf(items)));
  return lw ? { start: fromDay(lw[0]), end: fromDay(lw[1]) } : null;
}

/* ── 4 weeks: the agenda ── */

/** A week header's tag for something over days: "School holidays all week",
    "Shutdown from Wed", "Daikin course until Tue 13" (an event by its title). */
export type SpanTag<T extends CalItem> = { item: T; kind: "school" | "shutdown" | "event"; label: string };
export type AgendaWeek<T extends CalItem> = {
  kind: "week";
  key: string;
  start: string;
  end: string;
  /** "This week", "Next week", "In 2 weeks". */
  label: string;
  /** "28 Sept – 4 Oct". */
  range: string;
  tags: SpanTag<T>[];
};
export type AgendaLine<T extends CalItem> = {
  item: T;
  title: string;
  sub: string | null;
  /** An event's time, "6:45 am". */
  time: string | null;
};
export type AgendaDay<T extends CalItem> = {
  kind: "day";
  key: string;
  day: string;
  /** "Thu". */
  weekday: string;
  date: number;
  today: boolean;
  /** A weekend day that is not a public holiday: its number is quiet. */
  weekend: boolean;
  /** A public holiday starts today: the row is tinted. */
  holiday: boolean;
  /** Empty only on today, which always has a row ("Nothing on today."). */
  lines: AgendaLine<T>[];
};
export type AgendaQuiet = {
  kind: "quiet";
  key: string;
  start: string;
  end: string;
  /** "25 – 27", or "2" for one day. */
  dates: string;
  /** "Fri – Sun, nothing on", "Sat – Sun, long weekend". */
  text: string;
  longWeekend: boolean;
};
export type AgendaRow<T extends CalItem> = AgendaWeek<T> | AgendaDay<T> | AgendaQuiet;

/** "This week", "Next week", "In 2 weeks"; back past today, "Last week" and
    "2 weeks ago". Counted in Monday-first weeks from today's week. */
export function weekLabel(k: number): string {
  if (k === 0) return "This week";
  if (k === 1) return "Next week";
  if (k === -1) return "Last week";
  return k < 0 ? `${-k} weeks ago` : `In ${k} weeks`;
}

/* "School holidays all week", "… from Mon", "… until Fri 9". A span that both
   starts and ends inside the week says both, "Shutdown from Tue until Thu 8",
   where the prototype said only "from Tue" and read as though it ran on. */
function tagLabel(base: string, s: number, e: number, from: number, to: number): string {
  const starts = s > from ? ` from ${dayName(s)}` : "";
  const ends = e < to ? ` until ${dayName(e)} ${dateOf(e)}` : "";
  return base + (starts || ends ? starts + ends : " all week");
}

function agendaLine<T extends CalItem>(p: Span<T>, hols: ReadonlySet<number>, state: string): AgendaLine<T> {
  const x = p.x;
  if (x.cat === "school") {
    return { item: x, title: "School holidays start", sub: `${state} public schools, until ${dayLabel(p.e)}.`, time: null };
  }
  if (x.cat === "hol") {
    const lw = longWeekendOf(p.s, hols);
    const sub = `Public holiday in ${state}.` + (lw ? ` Long weekend, ${dayRangeLabel(lw[0], lw[1])}.` : "");
    return { item: x, title: x.title, sub, time: null };
  }
  return { item: x, title: x.title, sub: x.sub ?? null, time: x.cat === "event" ? timeLabel(x.time) : null };
}

/** The rolling four weeks from the anchor: a week header before the first day
    and on every Monday, a row only for a day with something starting on it
    (and today, always), and each run of empty days inside one week and one
    month folded to a quiet line. The days of a run that belong to a long
    weekend read as one; the working days before or after them in the same run
    keep their own quiet line. Anything that runs over days is tagged on the
    header of every week it touches, so an event already under way at the
    anchor still shows. */
export function agendaRows<T extends CalItem>(vis: readonly T[], anchor: string, frame: CalFrame): AgendaRow<T>[] {
  const f = frameOf(frame);
  const a0 = must(anchor, "anchor");
  const a1 = a0 + 27;
  const mon0 = f.t - columnOf(f.t);
  const P = spansOf(vis);
  const hols = holidayDays(P);
  /* School holidays, shutdowns and any other event over days (a two-day
     course): a row marks only the day a thing starts, so without its tag an
     event begun before the anchor would not show at all. */
  const tagged = P.filter((p) => p.e > p.s && (p.x.cat === "school" || p.x.cat === "event"));
  const starting = new Map<number, Span<T>[]>();
  for (const p of P) {
    if (p.s < a0 || p.s > a1) continue;
    const list = starting.get(p.s);
    if (list) list.push(p);
    else starting.set(p.s, [p]);
  }

  const rows: AgendaRow<T>[] = [];
  const quiet = (a: number, b: number, lw: boolean) =>
    rows.push({
      kind: "quiet",
      key: `q:${fromDay(a)}`,
      start: fromDay(a),
      end: fromDay(b),
      dates: a === b ? String(dateOf(a)) : `${dateOf(a)}${DASH}${dateOf(b)}`,
      text: (a === b ? dayName(a) : `${dayName(a)}${DASH}${dayName(b)}`) + (lw ? ", long weekend" : ", nothing on"),
      longWeekend: lw,
    });
  /* A quiet day is a long weekend's by the one rule the holiday's own line
     and the panel use (three or more days off in a row), so no two rows on
     the screen disagree: the prototype asked only whether the run touched a
     holiday, and called the Sunday after a Saturday Anzac Day long. The run
     splits wherever that answer changes. */
  const lwDay = (n: number) => longWeekendOf(n, hols) !== null;
  let run: { a: number; b: number } | null = null;
  const flush = () => {
    if (!run) return;
    const { a, b } = run;
    run = null;
    let from = a;
    for (let n = a; n <= b; n++) {
      if (n === b || lwDay(n + 1) !== lwDay(n)) {
        quiet(from, n, lwDay(n));
        from = n + 1;
      }
    }
  };

  for (let n = a0; n <= a1; n++) {
    if (n === a0 || columnOf(n) === 0) {
      flush();
      const end = Math.min(n + 6 - columnOf(n), a1);
      const tags = tagged
        .filter((p) => p.s <= end && p.e >= n)
        .sort(byOrder)
        .map((p): SpanTag<T> => {
          const kind = p.x.cat === "school" ? "school" : isShutdown(p.x) ? "shutdown" : "event";
          const base = kind === "school" ? "School holidays" : kind === "shutdown" ? "Shutdown" : p.x.title;
          return { item: p.x, kind, label: tagLabel(base, p.s, p.e, n, end) };
        });
      rows.push({
        kind: "week",
        key: `wk:${fromDay(n)}`,
        start: fromDay(n),
        end: fromDay(end),
        label: weekLabel(Math.floor((n - mon0) / 7)),
        range: datesLabel(n, end),
        tags,
      });
    }
    const its = (starting.get(n) ?? []).slice().sort(byOrder);
    const today = n === f.t;
    if (its.length || today) {
      flush();
      const holiday = its.some((p) => p.x.cat === "hol");
      rows.push({
        kind: "day",
        key: `day:${fromDay(n)}`,
        day: fromDay(n),
        weekday: dayName(n),
        date: dateOf(n),
        today,
        weekend: isWeekend(n) && !holiday,
        holiday,
        lines: its.map((p) => agendaLine(p, hols, f.state)),
      });
    } else if (run && monthKey(run.a) === monthKey(n)) {
      run.b = n;
    } else {
      flush();
      run = { a: n, b: n };
    }
  }
  flush();
  return rows;
}

/* ── the rail: Due, and the holidays ahead ── */

export type RailRow<T extends CalItem> = {
  item: T;
  title: string;
  /** "Ran out Thu 17 Sept.", "Due Tue 20 Oct.", "Wed 23 Dec – Fri 8 Jan". */
  sub: string;
  late: boolean;
  /** The right side: "Today", "22 days", or the month past 60 days; null when
      late, or for an item due whose date is already behind this today. */
  away: string | null;
};
export type RailLists<T extends CalItem> = { due: RailRow<T>[]; holidays: RailRow<T>[] };

function awayLabel(s: number, t: number): string {
  const d = s - t;
  if (d === 0) return "Today";
  return d < 60 ? plural(d, "day", "days") : MONTH_NAMES[monthOf(s)];
}

/** Due: admin that is overdue, first, then admin due inside the org's warning
    window (`warnDays`, orgExpiryWindow's number, the same window the bell
    warns in; never defaulted, so a caller cannot quietly get someone else's
    30), by date. Holidays ahead: the next 6 public holidays and shutdowns
    from today.

    Late is the item's flag, set from the bell's own rule, never the date: an
    item not flagged late is still due however its date reads against this
    frame's today, so it cannot drop out of Due while the bell warns on it. */
export function railLists<T extends CalItem>(vis: readonly T[], frame: CalFrame, warnDays: number): RailLists<T> {
  const t = must(frame.today, "today");
  if (!Number.isInteger(warnDays) || warnDays < 0) {
    throw new Error(`calendar: warnDays is not a number of days: ${JSON.stringify(warnDays)}`);
  }
  const P = spansOf(vis);
  const due = P.filter((p) => p.x.cat === "admin" && (p.x.overdue || p.s <= t + warnDays))
    .sort((p, r) => Number(!!r.x.overdue) - Number(!!p.x.overdue) || p.s - r.s || byOrder(p, r))
    .map((p) => ({
      item: p.x,
      title: p.x.title,
      sub: p.x.overdue ? `Ran out ${dayLabel(p.s)}.` : `Due ${dayLabel(p.s)}.`,
      late: !!p.x.overdue,
      away: p.x.overdue || p.s < t ? null : awayLabel(p.s, t),
    }));
  const holidays = P.filter((p) => (p.x.cat === "hol" || isShutdown(p.x)) && p.s >= t)
    .sort((p, r) => p.s - r.s || byOrder(p, r))
    .slice(0, 6)
    .map((p) => ({ item: p.x, title: p.x.title, sub: dayRangeLabel(p.s, p.e), late: false, away: awayLabel(p.s, t) }));
  return { due, holidays };
}

/* ── Month ── */

/** Column weights, Monday first: the weekend columns are narrower. */
export const MONTH_WEIGHTS: readonly number[] = [1, 1, 1, 1, 1, 0.55, 0.55];
/** A span bar's top in its week row, and the step between lanes. */
export const BAR_TOP = 32;
export const BAR_PITCH = 26;
export const barTop = (lane: number): number => BAR_TOP + lane * BAR_PITCH;
/** The height a week's cells keep free under the date row for its bars. */
export const laneReserve = (lanes: number): number => (lanes ? lanes * BAR_PITCH + 2 : 0);

export type MonthBar<T extends CalItem> = {
  item: T;
  kind: "school" | "shutdown" | "event";
  lane: number;
  /** Columns 0 (Monday) to 6 (Sunday) the bar covers in this week. */
  from: number;
  to: number;
  /** The bar carries on from last week or into next: that side's corner is square. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Percent of the week row, from the column weights. */
  left: number;
  width: number;
};
export type MonthItem<T extends CalItem> = { item: T; title: string; meta: string | null; overdue: boolean };
export type MonthCell<T extends CalItem> = {
  day: string;
  date: number;
  column: number;
  inMonth: boolean;
  weekend: boolean;
  today: boolean;
  holiday: T | null;
  /** Beside the number: the holiday's name, "Today", or the short month on the 1st and the first cell. */
  label: string | null;
  labelKind: "holiday" | "today" | "month" | null;
  items: MonthItem<T>[];
};
export type MonthWeek<T extends CalItem> = {
  key: string;
  start: string;
  end: string;
  lanes: number;
  bars: MonthBar<T>[];
  cells: MonthCell<T>[];
};

/* A bar is anything that spans days (school holidays even for one), never a
   public holiday: a holiday's name sits in its date row instead. */
const isBar = (p: { x: CalItem; s: number; e: number }): boolean => p.x.cat !== "hol" && (p.x.cat === "school" || p.e > p.s);

function monthMeta(x: CalItem): string | null {
  if (x.cat === "event") return timeLabel(x.time);
  return x.overdue ? "Overdue" : x.monthMeta || "Due";
}

/** The anchor's month, Monday first, in whole weeks. Each week's bars take
    lanes greedily, school holidays first; single-day events and admin sit in
    their day. */
export function monthWeeks<T extends CalItem>(
  vis: readonly T[],
  anchor: string,
  frame: CalFrame,
  weights: readonly number[] = MONTH_WEIGHTS,
): MonthWeek<T>[] {
  const f = frameOf(frame);
  const a = must(anchor, "anchor");
  const [g0, g1] = rangeOf("month", a, f);
  const P = spansOf(vis).filter((p) => p.s <= g1 && p.e >= g0);
  const total = weights.reduce((q, w) => q + w, 0);
  const sum = (i: number, j: number) => weights.slice(i, j).reduce((q, w) => q + w, 0);
  const weeks: MonthWeek<T>[] = [];

  for (let w0 = g0; w0 <= g1; w0 += 7) {
    const w1 = w0 + 6;
    const ends: number[] = [];
    const bars = P.filter((p) => isBar(p) && p.s <= w1 && p.e >= w0)
      .sort((p, r) => RANK[p.x.cat] - RANK[r.x.cat] || p.s - r.s || byOrder(p, r))
      .map((p): MonthBar<T> => {
        const i = Math.max(p.s, w0) - w0;
        const j = Math.min(p.e, w1) - w0;
        let lane = 0;
        while (ends[lane] != null && ends[lane] >= i) lane++;
        ends[lane] = j;
        return {
          item: p.x,
          kind: p.x.cat === "school" ? "school" : p.x.shutdown ? "shutdown" : "event",
          lane,
          from: i,
          to: j,
          continuesBefore: p.s < w0,
          continuesAfter: p.e > w1,
          left: (sum(0, i) / total) * 100,
          width: (sum(i, j + 1) / total) * 100,
        };
      });

    const cells: MonthCell<T>[] = [];
    for (let i = 0; i < 7; i++) {
      const n = w0 + i;
      const holiday = P.filter((p) => p.x.cat === "hol" && covers(p, n)).sort(byOrder)[0]?.x ?? null;
      const today = n === f.t;
      const monthLabel = dateOf(n) === 1 || n === g0 ? MONTH_NAMES[monthOf(n)] : null;
      cells.push({
        day: fromDay(n),
        date: dateOf(n),
        column: i,
        inMonth: monthKey(n) === monthKey(a),
        weekend: isWeekend(n),
        today,
        holiday,
        label: holiday ? holiday.title : today ? "Today" : monthLabel,
        labelKind: holiday ? "holiday" : today ? "today" : monthLabel ? "month" : null,
        items: P.filter((p) => !isBar(p) && p.x.cat !== "hol" && p.s === n)
          .sort(byOrder)
          .map((p) => ({ item: p.x, title: p.x.monthTitle || p.x.title, meta: monthMeta(p.x), overdue: !!p.x.overdue })),
      });
    }
    weeks.push({ key: `mw:${fromDay(w0)}`, start: fromDay(w0), end: fromDay(w1), lanes: ends.length, bars, cells });
  }
  return weeks;
}

/* ── Year ── */

export type YearCell<T extends CalItem> = {
  day: string;
  date: number;
  past: boolean;
  weekend: boolean;
  today: boolean;
  fill: "holiday" | "shutdown" | "school" | null;
  dot: "event" | "admin" | "late" | null;
  /** What a click on the cell selects; null for an empty day, which is not a button. */
  top: T | null;
  /** The id whose selection rings this cell: a one-day item, or a span's first day. */
  ring: string | null;
  /** "Mon 5 Oct: Labour Day, School holidays". */
  tip: string | null;
};
export type YearMonth<T extends CalItem> = {
  key: string;
  /** "September"; January carries its year, "January 2027". */
  title: string;
  past: boolean;
  holidays: number;
  /** "1 holiday", "3 holidays", or null. */
  note: string | null;
  /** Empty cells before the 1st, Monday first. */
  lead: number;
  cells: YearCell<T>[];
};

/* A dot is a one-day event or admin item, or an event that runs over days
   without closing the business (a two-day course): the Year has no bar to
   draw it with, so each of its days carries the event's dot. */
const isDot = (x: CalItem): boolean => x.cat === "admin" || (x.cat === "event" && !x.shutdown);

/** Twelve months from the page the anchor is on. A marked day selects, in
    order: its public holiday, then an event or admin item, then a shutdown,
    then school holidays. A holiday hides the dot; an overdue dot is late. */
export function yearMonths<T extends CalItem>(vis: readonly T[], anchor: string, frame: CalFrame): YearMonth<T>[] {
  const f = frameOf(frame);
  const first = yearStart(must(anchor, "anchor"), f.t);
  const all = spansOf(vis);
  const months: YearMonth<T>[] = [];
  for (let k = 0; k < 12; k++) {
    const m0 = monthsOn(first, k);
    const m1 = monthEnd(m0);
    const P = all.filter((p) => p.s <= m1 && p.e >= m0).sort(byOrder);
    const cells: YearCell<T>[] = [];
    let holidays = 0;
    for (let n = m0; n <= m1; n++) {
      const on = P.filter((p) => covers(p, n));
      const hol = on.find((p) => p.x.cat === "hol");
      const shut = on.find((p) => isShutdown(p.x));
      const school = on.find((p) => p.x.cat === "school");
      const pt = on.find((p) => isDot(p.x));
      if (hol) holidays++;
      const top = hol ?? pt ?? shut ?? school ?? null;
      const titles = on.map((p) => p.x.title).filter((t, i, arr) => arr.indexOf(t) === i);
      cells.push({
        day: fromDay(n),
        date: dateOf(n),
        past: n < f.t,
        weekend: isWeekend(n),
        today: n === f.t,
        fill: hol ? "holiday" : shut ? "shutdown" : school ? "school" : null,
        dot: pt && !hol ? (pt.x.overdue ? "late" : pt.x.cat === "admin" ? "admin" : "event") : null,
        top: top?.x ?? null,
        ring: top && (top.s === top.e || n === top.s) ? top.x.id : null,
        tip: top ? `${dayLabel(n)}: ${titles.join(", ")}` : null,
      });
    }
    months.push({
      key: fromDay(m0).slice(0, 7),
      title: MONTH_NAMES_LONG[monthOf(m0)] + (monthOf(m0) === 0 ? ` ${yearOf(m0)}` : ""),
      past: m1 < f.t,
      holidays,
      note: holidays ? plural(holidays, "holiday", "holidays") : null,
      lead: columnOf(m0),
      cells,
    });
  }
  return months;
}

/* ── the panel ── */

export type StatusTone = "due" | "late" | "cat" | "school";
export type CalDetail = {
  /** "Public holiday", "Event", "Admin", "Admin, overdue", "School holidays". */
  kicker: string;
  /** "Thu 1 Oct, 6:45 – 7:15 am", "Mon 28 Sept – Fri 9 Oct". */
  when: string;
  status: { text: string; tone: StatusTone };
  description: string | null;
  facts: [string, string][];
};

/* Days up to 60, then months. Months floor, as every countdown in the app does
   (lib/format/duration.ts): 85 days is "2 months", never a third it does not
   have. The prototype rounded; this is the one place the port departs. */
function inDays(d: number): string {
  return d <= 60 ? plural(d, "day", "days") : `${Math.floor(d / DAYS_PER_MONTH)} months`;
}

function statusOf(p: Span<CalItem>, t: number): { text: string; tone: StatusTone } {
  const x = p.x;
  const d = p.s - t;
  if (x.cat === "admin") {
    /* The flag says late and the date is not behind today (the flag's clock
       ran ahead): no "0 days late", no "-1 days late". */
    if (x.overdue) return { text: d < 0 ? `${inDays(-d)} late` : "Overdue", tone: "late" };
    const text = d < 0 ? `Was due ${inDays(-d)} ago` : d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${inDays(d)}`;
    return { text, tone: "due" };
  }
  if (x.cat === "school") {
    return { text: d > 0 ? `Starts in ${inDays(d)}` : p.e >= t ? "On now" : "Over", tone: "school" };
  }
  const text =
    d === 0 ? "Today" : d === 1 ? "Tomorrow" : d > 1 ? `In ${inDays(d)}` : p.e >= t ? "On now" : `${inDays(-d)} ago`;
  return { text, tone: "cat" };
}

const KICKER = {
  hol: "Public holiday",
  event: "Event",
  admin: "Admin",
  school: "School holidays",
} as const satisfies Record<CalCat, string>;

/** The panel for one item: its kicker, when, the status chip, and, for the
    holidays the calendar itself knows about, the sentence and the facts.
    `items` are what the long weekend is read from. Null for an item whose
    start is not a day. */
export function detail<T extends CalItem>(x: T, items: readonly T[], frame: CalFrame): CalDetail | null {
  const f = frameOf(frame);
  const p = spansOf([x])[0];
  if (!p) return null;
  const time = timeRangeLabel(x.time, x.timeEnd);
  const base = {
    kicker: x.cat === "admin" && x.overdue ? "Admin, overdue" : KICKER[x.cat],
    when: dayRangeLabel(p.s, p.e) + (time ? `, ${time}` : ""),
    status: statusOf(p, f.t),
  };
  if (x.cat === "hol") {
    const lw = longWeekendOf(p.s, holidayDays(spansOf(items)));
    const facts: [string, string][] = [["Where", `All of ${f.state}`]];
    if (lw) facts.push(["Long weekend", dayRangeLabel(lw[0], lw[1])]);
    facts.push(["From", `${f.state} public holidays`]);
    return { ...base, description: `Public holiday in ${f.state}.`, facts };
  }
  if (x.cat === "school") {
    const back = toDay(x.back);
    const facts: [string, string][] = Number.isNaN(back) ? [] : [["Students back", dayLabel(back)]];
    facts.push(["From", `${f.state} school terms`]);
    return { ...base, description: `${f.state} public schools${x.season ? `, ${x.season} break` : ""}.`, facts };
  }
  return {
    ...base,
    description: x.description ?? x.sub ?? null,
    facts: (x.facts ?? []).map(([k, v]): [string, string] => [k, v]),
  };
}
