/* YOUR DAY — the slanted bar at the top of the new Home, as arithmetic.

   Isaac's handoff ("Home - Diagonal day", 2026-09-24) draws one person's day
   as a row of 45° cards that butt together: a job to come filled in its
   Workboard colour with white words, the job on now darkening as it runs,
   finished work gone pale with a tick. The prototype (`build2.mjs`: `ydFit`,
   `ydShort`, `ydRender`) worked the widths out in the browser as it drew.
   This file is that working, pure, so the parts that can be WRONG are held
   still by tests: which card is on now when two overlap, when finished work
   folds into one block, what a crowded bar gives up first, and whether white
   can be read on every colour ServiceM8 can hand us.

   NOTHING HERE READS A CLOCK OR THE PAGE. `nowMin` is an argument (the
   loader's on first paint, the browser's after — see use-now-min), and text
   is measured by a function the caller hands in: canvas on the client, a
   deliberately generous guess on the server, which cannot see a font.

   WHAT A CROWDED BAR GIVES UP, in the handoff's order (§2.5), and only as
   far as it has to:
     1. finished runs of two or more fold into one 64px block;
     2. the finished cards left over shrink to 48px slivers;
     3. labels go compact — the start time alone, the name at 14px;
     4. everything but the selected card and the folded ones shrinks by one
        factor, so the bar fits exactly.
   The fold is decided on the bar as it would be drawn WHOLE, and a selected
   or hovered card is never folded — the hover would otherwise pull a card
   out from under the pointer, re-fold it and flicker. */

import { blockPaint } from "@/lib/workboard/focus";
import { NO_CATEGORY_PAINT, rgbOf, whiteLabelFill } from "@/lib/workboard/schedule-colour";
import { clockLabel, type ScheduleBlock } from "@/lib/workboard/schedule";
import { railSpanLabel, type RailTask } from "./day-rail";

/** The bar's height. The cards lean 45°, so it is also how far a slanted
    edge travels across — which is why the width sums below add it back. */
export const DAY_H = 88;
/** The gap between cards. The prototype's 6, snapped to the spacing scale. */
export const DAY_GAP = 4;
/** The grow on selection (a FLIP in the component). Isaac's number, and
    longer than law 18's `--t-move`: a named exemption, not a token. */
export const DAY_GROW_MS = 350;

/** The first and last cards lose their outer slant to the bar's clipped
    ends, so their words need this much more room… */
export const DAY_END_EXTRA = 80;
/** …and they start from this much before growing. */
export const DAY_END_BASIS = 44;
/** The selected card's extra room, and how much harder it grows. */
export const DAY_SEL_EXTRA = 60;
export const DAY_SEL_GROW = 2.4;
/** How much each booked hour adds to a card's share of the spare width. */
export const DAY_GROW_PER_HOUR = 0.35;
/** A folded run of finished work, and a finished card on its own. */
export const DAY_GROUP_W = 64;
export const DAY_SLIVER_W = 48;
/** What a place name may take before it is shortened. */
export const DAY_PLACE_CAP = 150;
export const DAY_PLACE_CAP_SELECTED = 220;
/** The slant's clearance around the words, and the tag's own padding. */
const LABEL_PAD = 50;
const TAG_PAD = 16;

/** A face at a size — the caller builds the real font string (the hashed
    next/font family is only known to the page). */
export type DayFont = { px: number; weight: number };

/** The bar's three kinds of words. His design's type: every size is on the
    scale, and no weight is over 700. */
export const DAY_FONTS = {
  name: { px: 16, weight: 700 },
  nameCompact: { px: 14, weight: 700 },
  tag: { px: 12, weight: 600 },
  time: { px: 13, weight: 600 },
} as const satisfies Record<string, DayFont>;

/** The bar's width before it has measured itself. The server cannot
    measure, and the browser's first render has to draw what the server
    drew, so both lay the bar out at this width and the browser corrects it
    once it has looked. His width: the bar on a 1440 window — less the
    rail's 224, the frame's 16 and the day's 24 each side — so the first
    paint at his desk is already the right one. */
export const DAY_NOMINAL_W = 1152;

/** How wide `text` is in `font`, in CSS pixels. */
export type DayMeasure = (text: string, font: DayFont) => number;

/** The server's measure, and the client's until the font has loaded.

    SET TO OVER-ESTIMATE. Measured against Plus Jakarta Sans, lower case and
    figures run 0.52–0.60em and capitals 0.68em; a space is a quarter. A
    guess that runs long can only fold a little early, and the canvas measure
    corrects it on the first effect — one change, in the safe direction. */
export const guessMeasure: DayMeasure = (text, font) => {
  let em = 0;
  for (const ch of text) em += ch === " " ? 0.3 : ch >= "A" && ch <= "Z" ? 0.72 : 0.62;
  return em * font.px;
};

/* ── the day, as items ───────────────────────────────────────────────── */

/** One thing on the bar: a booking, or a task that named an hour. */
export type DayItem = {
  /** `job:<activity uuid>` or `task:<id>` — the rail's own keys. */
  key: string;
  kind: "job" | "task";
  /** Minutes past midnight. A task is a moment: its end IS its start. */
  startMin: number;
  endMin: number;
  /** The suburb, which is the card's tag and the panel's title. */
  place: string | null;
  /** "Job 3342"; a job with no number goes by its client, or "Unnamed
      client"; a task by its title. */
  name: string;
  /** The ServiceM8 number, when the job has one — a number is never
      shortened, a client's name may be. */
  jobNumber: string | null;
  /** The job the card opens; null for a task. */
  remoteId: string | null;
  /** Has the viewer clocked on to this booking today. */
  onSite: boolean;
  /** The board's reading of the booking against the job being closed. */
  closure: ScheduleBlock["closure"] | null;
  /** The category's strong colour, as a ground white words clear 4.5:1 on;
      null for a task, which is not a category. */
  paint: string | null;
  /** The site's street line, for the panel's Where. */
  where: string | null;
  /** Everyone else on this job today, by first name. */
  crew: string[];
  /** The job's description, one line. */
  summary: string | null;
  taskId: string | null;
  /** A `by` task names when it must be DONE, not when to do it. */
  by: boolean;
};

/** What `dayItems` reads off the loader's rail. */
export type DayRailInput = {
  blocks: readonly ScheduleBlock[];
  tasks: readonly RailTask[];
  jobs: readonly { remoteId: string; description: string | null }[];
  where: Readonly<Record<string, string>>;
  crew: Readonly<Record<string, readonly string[]>>;
};

const own = <V>(rec: Readonly<Record<string, V>>, key: string): V | undefined =>
  Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;

/** Bookings and timed tasks, as one list in start order. */
export function dayItems(rail: DayRailInput): DayItem[] {
  const summary = new Map(rail.jobs.map((j) => [j.remoteId, j.description]));
  const items: DayItem[] = rail.blocks.map((b) => {
    const number = b.jobNumber?.trim() || null;
    return {
      key: `job:${b.key}`,
      kind: "job",
      startMin: b.startMin,
      endMin: b.endMin,
      place: b.suburb?.trim() || null,
      name: number ? `Job ${number}` : b.clientName?.trim() || "Unnamed client",
      jobNumber: number,
      remoteId: b.remoteId,
      onSite: b.onSite,
      closure: b.closure,
      /* The Workboard's key colour — the cap — darkened only where white
         on it would fall under 4.5:1. The wash is the board's ground for
         ink; this bar writes in white, so it takes the strong colour. */
      paint: whiteLabelFill(blockPaint(b).bar),
      where: own(rail.where, b.remoteId) ?? null,
      crew: [...(own(rail.crew, b.remoteId) ?? [])],
      summary: summary.get(b.remoteId) ?? null,
      taskId: null,
      by: false,
    };
  });
  for (const t of rail.tasks) {
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      startMin: t.atMin,
      endMin: t.atMin,
      place: null,
      name: t.title,
      jobNumber: null,
      remoteId: null,
      onSite: false,
      closure: null,
      paint: null,
      where: null,
      crew: [],
      summary: null,
      taskId: t.id,
      by: t.kind === "by",
    });
  }
  return items.sort((a, b) => a.startMin - b.startMin || a.key.localeCompare(b.key));
}

/* ── the clock's reading of an item ──────────────────────────────────── */

/** How far through an item the day is, 0 to 1.

    A booking the board reads as DONE is finished whatever the clock says —
    the job was closed on or after this visit. A task is never finished:
    only open tasks reach the bar, and one past its hour is late, not done,
    so it never wears the tick. */
export function dayProgress(item: DayItem, nowMin: number | null): number {
  if (item.kind === "task") return 0;
  if (item.closure === "done") return 1;
  if (nowMin === null) return 0;
  if (nowMin >= item.endMin) return 1;
  if (nowMin <= item.startMin) return 0;
  return (nowMin - item.startMin) / (item.endMin - item.startMin);
}

export type DayState = "todo" | "live" | "done" | "late";

export function dayState(item: DayItem, nowMin: number | null): DayState {
  if (item.kind === "task") return nowMin !== null && nowMin > item.startMin ? "late" : "todo";
  if (dayProgress(item, nowMin) >= 1) return "done";
  return nowMin !== null && nowMin >= item.startMin ? "live" : "todo";
}

/** The state in words — the panel's, and the card's name read aloud.
    A comma, not a middot (law 21). */
export function dayStateWord(item: DayItem, nowMin: number | null): string {
  switch (dayState(item, nowMin)) {
    case "done":
      return "Finished";
    case "live":
      return `On now, ${Math.round(dayProgress(item, nowMin) * 100)}%`;
    case "late":
      return "Late";
    default:
      return "To come";
  }
}

/** THE job on now — the one the panel opens on and the Trace runs round.

    Two bookings can be on at once (his real Thursday: 3342 until 5:45 and
    3315 from 5:00). The one the viewer has clocked on to is where they are;
    failing that, the later start is the one they have moved on to. A
    booking already closed is not on, and a task is a moment, never on. */
export function dayLiveKey(items: readonly DayItem[], nowMin: number | null): string | null {
  if (nowMin === null) return null;
  let best: DayItem | null = null;
  for (const it of items) {
    if (it.kind !== "job" || it.closure === "done") continue;
    if (nowMin < it.startMin || nowMin >= it.endMin) continue;
    if (
      !best ||
      (it.onSite !== best.onSite
        ? it.onSite
        : it.startMin !== best.startMin
          ? it.startMin > best.startMin
          : it.key > best.key)
    ) {
      best = it;
    }
  }
  return best?.key ?? null;
}

/* ── words ───────────────────────────────────────────────────────────── */

/** "4:45" — the bar's clock has no am/pm: a day reads left to right, and
    the panel says the meridiem once (railSpanLabel). Midnight, where a
    booking running past the day is clamped, is 12:00, never 0:00. */
function clock12(min: number): string {
  const whole = Math.round(min);
  const h = Math.floor(whole / 60) % 24;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(whole % 60).padStart(2, "0")}`;
}

/** "4:45–5:45", or "4:45" when the bar is compact. A task says its moment,
    "7:00", or "By 7:00" when that moment is a deadline. */
export function dayTimeLabel(item: DayItem, compact: boolean): string {
  const from = clock12(item.startMin);
  if (item.kind === "task") return item.by ? `By ${from}` : from;
  return compact ? from : `${from}–${clock12(item.endMin)}`;
}

const SHORTER: [RegExp, string][] = [
  [/\bNorth\b/gi, "Nth"],
  [/\bSouth\b/gi, "Sth"],
  [/\bEast\b/gi, "E"],
  [/\bWest\b/gi, "W"],
  [/\bMount\b/gi, "Mt"],
  [/\bSaint\b/gi, "St"],
  [/\bPoint\b/gi, "Pt"],
  [/\bHeights\b/gi, "Hts"],
  [/\bStreet\b/gi, "St"],
  [/\bRoad\b/gi, "Rd"],
];

/** A name that fits `capPx`: whole if it fits; else with the words a
    Sydney street directory shortens ("Willoughby East" → "Willoughby E");
    else cut, with "…". Never below three letters. */
export function shortPlace(name: string, capPx: number, width: (text: string) => number): string {
  if (width(name) <= capPx) return name;
  let s = name;
  for (const [re, short] of SHORTER) s = s.replace(re, short);
  if (width(s) <= capPx) return s;
  while (s.length > 3 && width(`${s}…`) > capPx) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** A folded run's accessible name — its title is "3 finished". */
export function dayGroupLabel(count: number): string {
  return `Show ${count} finished jobs`;
}

/** "Luke", "Luke and Callum", "Luke, Callum and Leo". */
function andList(names: readonly string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the panel under the bar says about the card that is open. */
export type DayPanelFacts = {
  /** The place, big: "Sydney". A booking with no suburb is titled by its
      name, and a task by its own title. */
  title: string;
  /** Beside the title: "Job 3342" (a client, when the job has no number),
      "Task" for a task; null when the title is already the name. */
  number: string | null;
  summary: string | null;
  /** "4:45–5:45pm", with the meridiem said once (railSpanLabel). A task
      says its moment, "7:00am", and a deadline "by 7:00am". */
  time: string;
  /** The street line; the suburb when the mirror had no street. */
  where: string | null;
  /** Everyone else booked on the job today; null when you are on it alone,
      so the panel leaves "With" out rather than saying "Solo". */
  with: string | null;
};

export function dayPanelFacts(item: DayItem): DayPanelFacts {
  if (item.kind === "task") {
    const at = clockLabel(item.startMin);
    return { title: item.name, number: "Task", summary: null, time: item.by ? `by ${at}` : at, where: null, with: null };
  }
  return {
    title: item.place ?? item.name,
    number: item.place ? item.name : null,
    summary: item.summary?.trim() || null,
    time: railSpanLabel(item.startMin, item.endMin),
    where: item.where?.trim() || item.place,
    with: item.crew.length > 0 ? andList(item.crew) : null,
  };
}

/** A card's name, read aloud: everything the card shows, whole and never
    shortened, and the state its colour shows — "Sydney, Job 3342,
    4:45–5:45pm, On now, 17%". A folded run is named for what pressing it
    does. */
export function dayCardLabel(slot: DaySlot, nowMin: number | null): string {
  if (slot.kind === "group") return dayGroupLabel(slot.items.length);
  const it = slot.items[0];
  return [it.kind === "task" ? "Task" : it.place, it.name, dayPanelFacts(it).time, dayStateWord(it, nowMin)]
    .filter(Boolean)
    .join(", ");
}

/** The card's tooltip, only where the card could not say it all: a folded
    run's "3 finished", a sliver that shows only its tick, and a card whose
    place or name had to be shortened ("The full name always shows in the
    card's tooltip and in the summary panel", handoff §2.5). */
export function dayCardTip(slot: DaySlot): string | null {
  if (slot.kind === "group") return slot.name;
  const it = slot.items[0];
  const whole = slot.tag === (it.kind === "task" ? "Task" : (it.place ?? "")) && slot.name === it.name;
  if (whole && !slot.collapsed) return null;
  return [it.kind === "task" ? null : it.place, it.name, dayTimeLabel(it, false)].filter(Boolean).join(", ");
}

/* ── the fit ─────────────────────────────────────────────────────────── */

export type DaySlotKind = "job" | "task" | "group";

/** One card as the bar draws it: its flex values, its words, its state. */
export type DaySlot = {
  /** The item's key, or `group:<first member's key>` for a folded run. */
  key: string;
  kind: DaySlotKind;
  /** The item — or, for a group, every finished item folded into it. */
  items: DayItem[];
  startMin: number;
  endMin: number;
  p: number;
  paint: string | null;
  selected: boolean;
  hovered: boolean;
  /** The one card the Trace runs round (`dayLiveKey`). */
  live: boolean;
  /** First or last on the bar. */
  end: boolean;
  /** Folded or a sliver: a fixed width, no words, only the tick. */
  collapsed: boolean;
  grow: number;
  shrink: 0 | 1;
  basis: number;
  minWidth: number;
  tag: string;
  name: string;
  time: string;
};

export type DayFit = {
  slots: DaySlot[];
  /** Would the bar, drawn whole, overflow? */
  crowded: boolean;
  /** Did finished work fold? */
  merged: boolean;
  /** Are the labels compact (start time only, name at 14px)? */
  compact: boolean;
  /** The last step's factor on every card but the selected and the folded
      ones: 1 when nothing had to shrink. */
  scale: number;
};

export type DayFitInput = {
  items: readonly DayItem[];
  nowMin: number | null;
  /** The bar's inner width. */
  barWidth: number;
  selectedKey: string | null;
  hoverKey: string | null;
  /** The folded block was pressed: draw every finished card. */
  showFinished: boolean;
  measure: DayMeasure;
  /** The gap between cards; the prototype's own 6 exists only to check the
      port against it. */
  gap?: number;
};

type Card = {
  key: string;
  kind: DaySlotKind;
  items: DayItem[];
  startMin: number;
  endMin: number;
  p: number;
  paint: string | null;
};

/** Fold every run of two or more finished cards into one. A selected or
    hovered card breaks a run; one finished card on its own stays itself. */
function foldFinished(cards: readonly Card[], selectedKey: string | null, hoverKey: string | null): Card[] {
  const out: Card[] = [];
  let run: Card[] = [];
  const close = () => {
    if (run.length >= 2) {
      out.push({
        key: `group:${run[0].key}`,
        kind: "group",
        items: run.flatMap((c) => c.items),
        startMin: run[0].startMin,
        endMin: Math.max(...run.map((c) => c.endMin)),
        p: 1,
        paint: null,
      });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const c of cards) {
    if (c.p >= 1 && c.key !== selectedKey && c.key !== hoverKey) run.push(c);
    else {
      close();
      out.push(c);
    }
  }
  close();
  return out;
}

/** The cards' words, before any width is decided. */
function cardWords(c: Card, compact: boolean, selected: boolean, measure: DayMeasure) {
  if (c.kind === "group") return { tag: "", name: `${c.items.length} finished`, time: "" };
  const it = c.items[0];
  const cap = selected ? DAY_PLACE_CAP_SELECTED : DAY_PLACE_CAP;
  const nameFont = compact ? DAY_FONTS.nameCompact : DAY_FONTS.name;
  return {
    tag: it.kind === "task" ? "Task" : shortPlace(it.place ?? "", cap, (s) => measure(s, DAY_FONTS.tag)),
    name: it.jobNumber ? it.name : shortPlace(it.name, cap, (s) => measure(s, nameFont)),
    time: dayTimeLabel(it, compact),
  };
}

function lay(cards: readonly Card[], input: DayFitInput, liveKey: string | null) {
  const { measure, selectedKey, hoverKey } = input;
  const n = cards.length;
  const gap = input.gap ?? DAY_GAP;
  /* The bar's width plus the two half-slants its clipped ends hide. */
  const avail = input.barWidth + DAY_H - gap * Math.max(0, n - 1);
  const isEnd = (i: number) => i === 0 || i === n - 1;
  const endExtra = (i: number) => (isEnd(i) ? DAY_END_EXTRA : 0);
  const selected = cards.map((c) => c.kind !== "group" && c.key === selectedKey);
  const hovered = cards.map((c) => c.kind !== "group" && c.key === hoverKey);
  const finished = cards.map((c, i) => c.p >= 1 && !selected[i] && !hovered[i]);

  type Laid = { tag: string; name: string; time: string; w: number; collapsed: boolean };
  const label = (compact: boolean): Laid[] =>
    cards.map((c, i) => {
      const words = cardWords(c, compact, selected[i], measure);
      const nameFont = compact ? DAY_FONTS.nameCompact : DAY_FONTS.name;
      const need = Math.ceil(
        Math.max(
          measure(words.name, nameFont),
          measure(words.tag, DAY_FONTS.tag) + TAG_PAD,
          measure(words.time, DAY_FONTS.time)
        )
      );
      return { ...words, w: need + LABEL_PAD + endExtra(i) + (selected[i] ? DAY_SEL_EXTRA : 0), collapsed: false };
    });
  /* A group is ALWAYS folded; `slivers` adds the finished cards left over. */
  const fold = (laid: Laid[], slivers: boolean): Laid[] =>
    laid.map((x, i) => {
      if (cards[i].kind === "group") return { ...x, w: DAY_GROUP_W + endExtra(i), collapsed: true };
      if (slivers && finished[i]) return { ...x, w: DAY_SLIVER_W + endExtra(i), collapsed: true };
      return x;
    });
  const total = (laid: Laid[]) => laid.reduce((a, x) => a + x.w, 0);

  let compact = false;
  let laid = label(false);
  const crowded = total(laid) > avail;
  laid = fold(laid, false);
  if (total(laid) > avail) laid = fold(laid, true);
  if (total(laid) > avail) {
    compact = true;
    laid = fold(label(true), true);
  }
  const sum = total(laid);
  const kept = (i: number) => selected[i] || laid[i].collapsed;
  const fixed = laid.reduce((a, x, i) => a + (kept(i) ? x.w : 0), 0);
  const k = sum > avail ? Math.max(0, avail - fixed) / Math.max(1, sum - fixed) : 1;

  const slots: DaySlot[] = cards.map((c, i) => {
    const x = laid[i];
    const hours = (c.endMin - c.startMin) / 60;
    return {
      key: c.key,
      kind: c.kind,
      items: c.items,
      startMin: c.startMin,
      endMin: c.endMin,
      p: c.p,
      paint: c.paint,
      selected: selected[i],
      hovered: hovered[i],
      live: c.kind !== "group" && c.key === liveKey,
      end: isEnd(i),
      collapsed: x.collapsed,
      grow: x.collapsed ? 0 : (1 + hours * DAY_GROW_PER_HOUR) * (selected[i] ? DAY_SEL_GROW : 1),
      shrink: x.collapsed ? 0 : 1,
      basis: x.collapsed ? x.w : isEnd(i) ? DAY_END_BASIS : 0,
      minWidth: kept(i) ? x.w : Math.floor(x.w * k),
      tag: x.tag,
      name: x.name,
      time: x.time,
    };
  });
  return { slots, crowded, compact, scale: k };
}

/** Lay the bar out: which cards fold, how wide each may get, what it says. */
export function fitDay(input: DayFitInput): DayFit {
  const liveKey = dayLiveKey(input.items, input.nowMin);
  const cards: Card[] = input.items.map((it) => ({
    key: it.key,
    kind: it.kind,
    items: [it],
    startMin: it.startMin,
    endMin: it.endMin,
    p: dayProgress(it, input.nowMin),
    paint: it.paint,
  }));
  const whole = lay(cards, input, liveKey);
  if (!whole.crowded || input.showFinished) return { ...whole, merged: false };
  const folded = foldFinished(cards, input.selectedKey, input.hoverKey);
  if (folded.length === cards.length) return { ...whole, merged: false };
  return { ...lay(folded, input, liveKey), crowded: true, merged: true };
}

/* ── paint ───────────────────────────────────────────────────────────── */

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
/** His hexes, as channels: the task card, its ink, the folded block, the
    quiet words on finished work, and the panel's heading ink. */
const TASK_BG: Rgb = [238, 240, 243]; // #eef0f3
const TASK_INK: Rgb = [57, 70, 90]; // #39465a
const GROUP_BG: Rgb = [227, 231, 238]; // #e3e7ee
const QUIET: Rgb = [91, 100, 114]; // #5b6472
const HEAD_INK: Rgb = [21, 26, 36]; // #151a24
/** Unreachable for a job (`dayItems` always paints one); kept so a card
    with no readable paint still draws in the no-category grey's fill. */
const FALLBACK_FILL = whiteLabelFill(NO_CATEGORY_PAINT.bar);

/** `color-mix(in srgb, a t, b)`: channel by channel, in the encoded space the
    browser mixes in, so what is measured here is what is drawn. */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const at = (i: number) => Math.round(a[i] * t + b[i] * (1 - t));
  return [at(0), at(1), at(2)];
}
const css = (c: Rgb) => `rgb(${c.join(", ")})`;

/** Every colour one card needs, and its panel when it is the selected one. */
export type DayPaint = {
  /** The card's ground — and the panel's, when this card is selected. */
  bg: string;
  /** The progress fill that darkens a job as it runs. */
  fill: string;
  /** The card's words. */
  text: string;
  /** The panel's heading words (place and name). */
  title: string;
  /** The panel's quieter words: the number, Time, Where, With. */
  sub: string;
  /** The panel's swatch. */
  swatch: string;
};

/**
 * How one card is painted — the prototype's `ydRender`, with every
 * `color-mix` done here so each pair can be measured:
 *
 *   to come   the category's fill, white words
 *   on now    the same, with `deep` (fill 62% with black) as the progress
 *   finished  `pale` (tint 50% with white) and the quiet grey; selected or
 *             hovered, the `tint` (fill 28% with white) with deep words
 *   task      #eef0f3 with #39465a
 *   group     #e3e7ee, gone pale like any finished card
 *
 * The panel of a filled card is the card: white on the fill. The panel of
 * anything else is its ground with the heading ink.
 */
export function dayCardPaint(
  card: { kind: DaySlotKind; paint: string | null },
  p: number,
  { selected = false, hovered = false }: { selected?: boolean; hovered?: boolean } = {}
): DayPaint {
  const finished = p >= 1;
  const quiet = finished && !selected && !hovered;
  if (card.kind === "job") {
    const fill = rgbOf(card.paint ?? "") ?? rgbOf(FALLBACK_FILL)!;
    const deep = mix(fill, BLACK, 0.62);
    if (!finished) {
      return { bg: css(fill), fill: css(deep), text: css(WHITE), title: css(WHITE), sub: css(WHITE), swatch: css(WHITE) };
    }
    const tint = mix(fill, WHITE, 0.28);
    return {
      bg: css(quiet ? mix(tint, WHITE, 0.5) : tint),
      fill: css(deep),
      text: css(quiet ? QUIET : deep),
      title: css(HEAD_INK),
      sub: css(TASK_INK),
      swatch: css(fill),
    };
  }
  const ground = card.kind === "group" ? GROUP_BG : TASK_BG;
  return {
    bg: css(quiet ? mix(ground, WHITE, 0.5) : ground),
    fill: css(card.kind === "group" ? QUIET : TASK_INK),
    text: css(quiet ? QUIET : TASK_INK),
    title: css(HEAD_INK),
    sub: css(TASK_INK),
    swatch: css(card.kind === "group" ? QUIET : TASK_INK),
  };
}
