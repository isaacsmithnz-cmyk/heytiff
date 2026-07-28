"use client";

import {
  type DayClass,
  type DayEntry,
  type Settings,
  type WeekCtx,
  dayClass,
  dowOf,
  isWeekendRate,
  fmt,
  initials,
  nameHue,
} from "./logic";

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

/** The hours line — the same words the mini tile puts in its tooltip. */
function tileHours(d: DayEntry, cls: DayClass): string {
  return cls === "empty" ? "—"
    : cls === "miss" ? "Missing"
    : cls === "leave" ? "Leave"
    : cls === "sick" ? "Sick"
    : cls === "ph" ? "Pub hol"
    : fmt((d as { h: number }).h) + "h";
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
    cls === "empty" ? "No entry"
    : cls === "miss" ? "Missing entry"
    : cls === "leave" ? "Leave"
    : cls === "sick" ? "Sick"
    : cls === "ph" ? "Public holiday"
    : fmt((d as { h: number }).h) +
      "h" +
      (weekendRate
        ? " · weekend rates"
        : cls === "std" ? " · standard" : cls === "over" ? " · overtime" : " · under standard");
  return (
    <span
      className={`mt ${cls}${i === ctx.today ? " today" : ""}`}
      title={`${ctx.week[i][0]} ${ctx.week[i][1]} — ${label}`}
    ></span>
  );
}

/** [class, caption] — the class is the same one dayClass() returns. */
export type LegendItem = readonly [DayClass, string];

/** What the admin screen reads: every colour a reviewed day can take. */
export const DAY_LEGEND: readonly LegendItem[] = [
  ["std", "Standard"],
  ["over", "Overtime"],
  ["under", "Under day"],
  ["leave", "Leave"],
  ["sick", "Sick"],
  ["ph", "Public hol"],
  ["empty", "No entry"],
];

/** Your own screen adds `miss`: on someone else's week it's a chase, on
    yours it's the thing to click. */
export const MY_DAY_LEGEND: readonly LegendItem[] = [...DAY_LEGEND, ["miss", "Missing"]];

export function DayLegend({
  items = DAY_LEGEND,
  label = "Day colour",
}: {
  items?: readonly LegendItem[];
  label?: string;
}) {
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
