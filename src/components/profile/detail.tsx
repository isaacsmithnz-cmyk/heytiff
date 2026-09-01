"use client";

import { isValidElement, type ReactNode } from "react";
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

/** The panel grid — two across on a wide card, one on a narrow one.

    `tight` is Summary's: the same panels at a glanceable density, small-caps
    labels on one line each rather than a form's worth of air per fact. Only
    the overview wants it — a section you are editing needs room for the
    control the value turns into. */
export function DetailPanels({ tight = false, children }: { tight?: boolean; children: ReactNode }) {
  return <div className={`pdlgrid${tight ? " tight" : ""}`}>{children}</div>;
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

/* ONE ROW, TWO RENDERINGS — and this is the point of the component.

   A section used to declare its read view and its edit view separately: three
   grouped panels of label/value rows, and a flat two-column form of 46px
   boxes. Nothing tied them together, so they drifted until they were different
   screens, and clicking Edit threw away the layout you were reading. Every
   label moved. That is what made "+ Add" feel like a trapdoor — the value's
   own place was not where you edited it — and what made the form look enormous
   next to the panel it replaced.

   So a row now declares BOTH: `value` is what it reads as, `control` is what
   it becomes. `editing` picks. The two cannot diverge, because there is one
   list and one set of labels; and nothing moves when the mode changes, because
   only the contents of `dd` do. */
export function Detail({
  label,
  /** the value, or an empty string / null when it isn't recorded */
  value,
  /** the control this row becomes in edit mode. A row with no `control` stays
      read-only in both — the sign-in email, a derived figure. */
  control,
  editing = false,
  /** the business is obliged to hold it — marked on the label, where the eye
      already is, rather than in a legend under the form */
  req = false,
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
  /** shown under the control while editing, when the last save rejected it */
  error,
  /** A control for a row whose value is PRESENT — the way `onAdd` serves a
      row whose value is missing. It exists for the sign-in email: a fact this
      card must show but must not edit as part of its nine-field save, because
      changing it moves an account rather than a detail. Read mode only; a row
      being edited already has its control. */
  action,
}: {
  label: string;
  value?: ReactNode;
  control?: ReactNode;
  editing?: boolean;
  req?: boolean;
  onAdd?: () => void;
  addLabel?: string;
  small?: boolean;
  sub?: ReactNode;
  error?: string | null;
  action?: ReactNode;
}) {
  const empty = value === null || value === undefined || value === "";
  const live = editing && control;

  /* THE ROW'S LABEL IS THE CONTROL'S LABEL, and this is the bit that is easy
     to drop on the way in. The old form wrapped every control in `Field`,
     which tied a real <label> to it by reading the control's own `name` — so
     clicking a label focused its box and a screen reader announced it. Rows
     have to do that job now, and they pick the name up the same way rather
     than making every call site repeat it.

     Only when there IS a name: `Seg` is a group of buttons with no single
     input to point at, and a <label for> aimed at nothing is worse than no
     label at all. */
  const controlName =
    isValidElement<{ name?: string }>(control) && typeof control.props.name === "string"
      ? control.props.name
      : undefined;

  const labelText = (
    <>
      {label}
      {req && live ? <span className="req">*</span> : null}
    </>
  );

  return (
    <div className={live ? "pdrow live" : "pdrow"}>
      <dt>
        {live && controlName ? <label htmlFor={controlName}>{labelText}</label> : labelText}
      </dt>
      <dd>
        {live ? (
          control
        ) : !empty ? (
          <>
            <span className={small ? "pdv sm" : "pdv"}>{value}</span>
            {action}
          </>
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
        {live && error ? <span className="pderr">{error}</span> : null}
      </dd>
    </div>
  );
}
