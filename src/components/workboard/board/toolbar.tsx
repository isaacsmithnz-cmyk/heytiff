"use client";

import type { ReactNode } from "react";
import { ToolbarSync } from "./sm8-chip";

/* THE BOARD'S ONE TOOLBAR — the 48px row every tab on all three sides opens
   on (`.wb2-tbar`, dressed in shell.css under "THE SCHEDULE'S ONE TOOLBAR").

   It replaced a head each tab drew for itself: an icon in a tinted square,
   the tab's own name a second time, a caption explaining the section, and a
   chip or two of counts beside it. The tab above names the list, so the row
   says only what the reader came for — and where a count is a question
   somebody asks of the list, it is the FILTER that answers it. A count that
   narrows nothing is a sentence, not a chip (law 26: a chip is for something
   you tap).

   Nothing here is layout the tabs cannot see: a tab composes the row from
   these pieces and its own controls, in reading order. The row always ends
   on the mirror's freshness, which the board provides (`Sm8HealthContext`). */

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div className="wb2-tbar">
      {children}
      <ToolbarSync />
    </div>
  );
}

/** Pushes what follows it to the far end of the row: the tab's one action. */
export function ToolbarEnd({ children }: { children: ReactNode }) {
  return <div className="wb2-tbend">{children}</div>;
}

export type FilterOption<K extends string> = {
  key: K;
  label: string;
  n: number;
  /** The figure's state colour, when the count IS a state (money out, a late trip). */
  tone?: "warn" | "dan";
};

/* The chips: what a person taps keeps a chip's form — a hairline and the
   control radius, the chosen one in ink — and the count rides inside as a
   figure. The space before it is for the accessible name ("Overdue 3", not
   "Overdue3"); a whitespace-only text node in a flex row draws nothing. */
export function FilterChips<K extends string>({
  options,
  value,
  onChange,
  label = "Show",
}: {
  options: FilterOption<K>[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
}) {
  return (
    <div className="wb2-fchips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={"wb2-fchip" + (o.key === value ? " on" : "")}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
        >
          {o.label}{" "}
          <i className={o.tone}>{o.n}</i>
        </button>
      ))}
    </div>
  );
}
