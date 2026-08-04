"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* Read mode's vocabulary: grouped panels of label/value pairs, and an empty
   value that is a BUTTON rather than a dash.

   Why this replaced the old read view. The card used to show its unset fields
   as an em dash or an italic "Not set" — true, but inert: you had to know that
   Edit at the top of the card was how you fixed the blank three rows down. An
   "+ Add" sitting in the value's own place says what is missing and opens the
   form in one move, so the checklist at the top of the screen and the card
   below it offer the same affordance.

   The markup is a real <dl>: the div-per-pair wrapper is valid inside one and
   is what lets each row be its own grid. */

/** The panel grid — two across on a wide card, one on a narrow one. */
export function DetailPanels({ children }: { children: ReactNode }) {
  return <div className="pdlgrid">{children}</div>;
}

export function DetailPanel({
  title,
  /** span both columns — for a group whose rows read better two-up */
  wide = false,
  /** lay the rows out two pairs to a line (only sensible when `wide`) */
  split = false,
  /** Content that ISN'T label/value pairs — a paragraph of notes, a row of
      qualification chips, the payroll donut. The body renders as a plain div
      rather than the <dl>, because prose and charts are not definition-list
      children and putting them in one is invalid markup, not just untidy. */
  plain = false,
  /** Summary only: open the tab this panel is the overview of. The panel's
      heading is that tab's name, so the jump belongs in the heading with it —
      and it is what lets a read-only tab still be the way you drive the card.
      Omitted, the heading is a heading, which is what every panel inside a
      section is. */
  onOpen,
  /** a quiet qualifier beside the heading — where facts came from when the
      panel isn't a tab, e.g. the vehicle's "from Fleet" */
  note,
  children,
}: {
  title: string;
  wide?: boolean;
  split?: boolean;
  plain?: boolean;
  onOpen?: () => void;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className={`pdlcard${wide ? " wide" : ""}`}>
      <div className={`pdlh${onOpen ? " jump" : ""}`}>
        <span>
          {title}
          {note ? <span className="pdlh-q">{note}</span> : null}
        </span>
        {onOpen && (
          <button type="button" className="jumpb" onClick={onOpen}>
            Open
            <span className="sr-only"> {title}</span>
            <Icon name="chevR" size={12} />
          </button>
        )}
      </div>
      {plain ? (
        <div className="pdlbody">{children}</div>
      ) : (
        <dl className={`pdl${split ? " split" : ""}`}>{children}</dl>
      )}
    </div>
  );
}

export function Detail({
  label,
  /** the value, or an empty string / null when it isn't recorded */
  value,
  /** opens the card's edit form. Omitted, an unset value reads "Not set"
      instead — which is right for a card with nothing to edit. */
  onAdd,
  /** the add button's verb: "Add" for a box you type in, "Select" for a list */
  addLabel = "Add",
  /** long values (an address, an email) that shouldn't sit at value size */
  small = false,
  /** a quiet qualifier under the value — where a rate came from, the multiplier
      behind it. Not a second value: it never carries information the row would
      be wrong without. */
  sub,
}: {
  label: string;
  value?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  small?: boolean;
  sub?: ReactNode;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="pdrow">
      <dt>{label}</dt>
      <dd>
        {!empty ? (
          <span className={small ? "pdv sm" : "pdv"}>{value}</span>
        ) : onAdd ? (
          <button type="button" className="padd" onClick={onAdd}>
            <span aria-hidden="true">+</span>
            {addLabel}
            <i className="sr-only"> {label}</i>
          </button>
        ) : (
          <span className="pdnone">Not set</span>
        )}
        {/* outside the branches on purpose: the qualifier is often ABOUT the
            blank — "Using the org default" is exactly what an unset override
            means, and it would never render if it only followed a value */}
        {sub ? <span className="pdsub">{sub}</span> : null}
      </dd>
    </div>
  );
}
