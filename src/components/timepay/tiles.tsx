"use client";

import {
  type DayClass,
  type DayEntry,
  type Settings,
  type WeekCtx,
  DAY_WORD,
  dayClass,
  dowOf,
  isWeekendRate,
  fmt,
  initials,
  nameHue,
} from "./logic";

/* `DAY_WORD` lives in logic.ts — beside the `DayClass` it is keyed on, and
   reachable from the server, which this `"use client"` file is not. Re-exported
   here because the components that draw a day are what most callers want it
   from. */
export { DAY_WORD } from "./logic";

/* The Time & Pay day-language primitives, shared by the admin review screen
   and My timesheet so a colour can only ever mean one thing.

   Extracted from timepay.tsx unchanged. The only addition is Tile's
   interactive variant: pass `onClick` and it renders as a <button> with the
   same classes, so the staff screen can select a day without inventing a
   second visual vocabulary for the same seven squares. */

export function Avatar({ name }: { name: string }) {
  const h = nameHue(name);
  return (
    <span
      className="av"
      style={{ background: `linear-gradient(135deg,hsl(${h} 68% 52%),hsl(${(h + 38) % 360} 64% 44%))` }}
    >
      {initials(name)}
    </span>
  );
}

/** The hours line — hours when there are hours, the state's word when there
    aren't. A tile is 96px wide, so the long one gets its short form HERE
    rather than in `DAY_WORD`: the map is what a state is CALLED, and a square
    this size can't hold "Public holiday" whatever it is called. */
const TILE_SHORT: Partial<Record<DayClass, string>> = { ph: "Pub hol" };

function tileHours(d: DayEntry, cls: DayClass): string {
  if (cls === "empty") return "—";
  if (cls === "miss" || cls === "leave" || cls === "sick" || cls === "ph" || cls === "off")
    return TILE_SHORT[cls] ?? DAY_WORD[cls];
  return fmt((d as { h: number }).h) + "h";
}

export function Tile({
  d,
  i,
  settings,
  ctx,
  onClick,
  selected,
}: {
  d: DayEntry;
  i: number;
  settings: Settings;
  ctx: WeekCtx;
  /** present = this tile is a button that selects its day */
  onClick?: (i: number) => void;
  selected?: boolean;
}) {
  const w = ctx.week[i];
  const cls = dayClass(d, i, settings, ctx);
  const className =
    `tile ${cls}${i === ctx.today ? " today" : ""}${selected ? " sel" : ""}`;
  const inner = (
    <>
      <span className="wd">{w[0]}</span>
      <span className="dn">{w[1]}</span>
      <span className="hh">{tileHours(d, cls)}</span>
    </>
  );

  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button
      type="button"
      className={className}
      aria-pressed={!!selected}
      aria-label={`${w[0]} ${w[1]} ${w[2]}`}
      onClick={() => onClick(i)}
    >
      {inner}
    </button>
  );
}

export function MiniTile({
  d,
  i,
  settings,
  ctx,
}: {
  d: DayEntry;
  i: number;
  settings: Settings;
  ctx: WeekCtx;
}) {
  const cls = dayClass(d, i, settings, ctx);
  /* A worked weekend is `over` because every hour of it is at a premium, not
     because the day ran long — so it says WEEKEND, matching the pill the
     person sees on their own sheet. */
  const weekendRate = isWeekendRate(d, dowOf(ctx.week[i]), settings);
  const label =
    cls === "empty" || cls === "miss" || cls === "leave" || cls === "sick" || cls === "ph" || cls === "off"
      ? DAY_WORD[cls]
    : fmt((d as { h: number }).h) +
      "h" +
      (weekendRate
        ? " · weekend rates"
        : cls === "std" ? " · standard" : cls === "over" ? " · overtime" : " · under standard");
  /* THE DAY IT IS, ABOVE THE COLOUR RATHER THAN INSIDE IT.

     This rendered as a bare coloured span — seven unlabelled bars, readable
     only by hovering them one at a time, on the row an approver taps Approve
     from. The initial is the least that makes the strip readable.

     It sits OUTSIDE the fill because inside it there is no ink that works:
     white on `--red` (a sick day) measures 3.55:1, and the dark end that would
     clear 4.5 on that red is near-black. Above the bar it is quiet grey on the
     row's own white, the fills stay exactly the colours they are everywhere
     else on the screen, and the strip reads as the seven-day calendar it is. */
  return (
    <span className="mtc">
      <i className="mtd">{ctx.week[i][0].charAt(0)}</i>
      <span
        className={`mt ${cls}${i === ctx.today ? " today" : ""}`}
        title={`${ctx.week[i][0]} ${ctx.week[i][1]} — ${label}`}
      ></span>
    </span>
  );
}

/** [class, caption] — the class is the same one dayClass() returns. */
export type LegendItem = readonly [DayClass, string];

/* Every colour a day can take, in the order a week is read: the ordinary day
   first, then the ones that need a look.

   ONE legend, both screens. There used to be two — and `miss` was in neither
   the one that shipped: the admin list left it out, and the list that had it
   (`MY_DAY_LEGEND`) was imported by nothing but its own test while
   my-timesheet declared a third list inline. So a missing day drew a colour
   the key underneath didn't explain, on both screens at once.

   Derived from DAY_WORD rather than restating it, for the same reason the KB
   categories are: a hand-written list beside a map is a list that falls one
   entry behind it. */
const LEGEND_ORDER = ["std", "over", "under", "leave", "sick", "ph", "off", "miss", "empty"] as const;

export const DAY_LEGEND: readonly LegendItem[] = LEGEND_ORDER.map(
  (k) => [k, DAY_WORD[k]] as LegendItem,
);

/** The legend for a specific set of days — every colour that is actually
    drawn, in `LEGEND_ORDER`, and nothing else.

    A key is for reading what is on the screen. Listing all nine states over a
    week that used four of them put five swatches on both screens explaining
    colours nobody could see, which is the same failure as the one this list
    was built to fix (a colour on screen with no entry in the key) taken from
    the other end. Pass `classes` and the key follows the data; omit it and
    every state is listed, which is what a legend with no week to describe has
    to do. */
export function legendFor(classes: Iterable<DayClass>): readonly LegendItem[] {
  const present = new Set(classes);
  return DAY_LEGEND.filter(([k]) => present.has(k));
}

export function DayLegend({
  items = DAY_LEGEND,
  label = "Day colour",
}: {
  items?: readonly LegendItem[];
  label?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="legend">
      <span className="llbl">{label}</span>
      {items.map(([k, caption]) => (
        <span className="lg" key={k}>
          <i className={`sw ${k}`}></i>
          {caption}
        </span>
      ))}
    </div>
  );
}
