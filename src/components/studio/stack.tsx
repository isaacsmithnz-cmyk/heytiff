"use client";

/* THE RIGHT COLUMN AS A NATIVE STACK (the next flow; the Clean layout page of
   the Studio rework mocks, after the phone app's components/List.tsx). Grouped
   white rows on the grey ground, a back button that names the screen behind,
   one action at the foot. Systems, a system, a room, the air and Edit system
   are all screens of this one column. */

import type { DragEvent, ReactNode } from "react";
import { Fade } from "@/components/parts/fade";
import { Icon } from "@/components/shell/icon";

/** a screen of the column: what scrolls, and the one or two actions pinned under it */
export function StackScreen({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="ds-stack" aria-label={label}>
      <div className="ds-stack-scroll">{children}</div>
      {foot ? <div className="ds-stack-foot">{foot}</div> : null}
    </section>
  );
}

/** the screen's head: back to the one behind, by name, then its big title */
export function StackHead({
  name,
  sub,
  back,
  onBack,
  action,
  nav,
}: {
  name: ReactNode;
  sub?: ReactNode;
  /** the name of the screen behind */
  back?: string;
  onBack?: () => void;
  /** one small action level with the title */
  action?: ReactNode;
  /** the screen's one action, top right in blue words over the title, where a
      phone keeps it (Edit, Add system, Rename; the bar and panel mock, 21
      November 2026) */
  nav?: { label: string; onPress: () => void };
}) {
  const backButton =
    back && onBack ? (
      <button type="button" className="ds-stack-back" onClick={onBack}>
        <Icon name="chevL" size={16} />
        <Fade className="ds-stack-back-t">{back}</Fade>
      </button>
    ) : null;
  return (
    <header className="ds-stack-head">
      {nav ? (
        <div className="ds-stack-nav">
          {backButton ?? <span />}
          <button type="button" className="ds-stack-navact" onClick={nav.onPress}>
            {nav.label}
          </button>
        </div>
      ) : (
        backButton
      )}
      <div className="ds-stack-titlerow">
        <h2 className="ds-stack-title">{name}</h2>
        {action}
      </div>
      {sub ? <p className="ds-stack-sub">{sub}</p> : null}
    </header>
  );
}

export function StackSection({ children }: { children: ReactNode }) {
  return <h3 className="ds-stack-section">{children}</h3>;
}

export function StackGroup({ children }: { children: ReactNode }) {
  return <div className="ds-stack-group">{children}</div>;
}

/** a row: what leads, a name with a grey line under it, then a value and a chevron */
export function StackRow({
  lead,
  name,
  sub,
  more,
  value,
  tone,
  chevron,
  onPress,
  label,
  lit,
  children,
  blue,
  danger,
  strong,
  drag,
  held,
  wrap,
  clamp,
}: {
  lead?: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  /** a second grey line, for what a row can't say in one */
  more?: ReactNode;
  value?: ReactNode;
  /** a state's colour on the value */
  tone?: "good" | "look" | "bad";
  chevron?: boolean;
  onPress?: () => void;
  /** names a pressable row when its words alone would not */
  label?: string;
  /** picked on the plan: filled as a selection is (law 14) */
  lit?: boolean;
  /** the row's own control, at its right: a tray or a field */
  children?: ReactNode;
  /** an action row, its words in blue (Add zones, Add to the design) */
  blue?: boolean;
  /** a row that ends something, its words in red (Delete zone) or saying
      what's wrong (Not a valid combination) */
  danger?: boolean;
  /** the value in ink: a figure the row is for (Heat load) */
  strong?: boolean;
  /** a row picked up and dragged onto the plan: its handle at the row's end,
      where a phone keeps it */
  drag?: { onDragStart: (e: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  /** dragged out right now: the row stays, filled as a selection is */
  held?: boolean;
  /** the name and its grey lines wrap and are read whole, never faded: a
      system named by its quote, the zones on no system (Isaac, 22 November
      2026: "check the web Studio for cut off text") */
  wrap?: boolean;
  /** its grey line stops at two lines, the second fading: a list Zones
      shows whole (bug 72, 22 November 2026) */
  clamp?: boolean;
}) {
  const inner = (
    <>
      {lead}
      <span className="ds-stack-row-l">
        <Fade className="ds-stack-row-t">{name}</Fade>
        {sub ? <Fade className={`ds-stack-row-s${clamp ? " ds-stack-clamp" : ""}`}>{sub}</Fade> : null}
        {more ? <Fade className="ds-stack-row-s">{more}</Fade> : null}
      </span>
      {value != null && value !== "" ? (
        <span className={`ds-stack-row-v${tone ? ` ${tone === "good" ? "ok" : tone}` : strong ? " ink" : ""}`}>{value}</span>
      ) : null}
      {children}
      {drag ? (
        <span className="ds-stack-grip" aria-hidden="true">
          <Icon name="menu" size={16} />
        </span>
      ) : null}
      {chevron ? (
        <span className="ds-stack-chev" aria-hidden="true">
          <Icon name="chevR" size={16} />
        </span>
      ) : null}
    </>
  );
  const cls = `ds-stack-row${onPress ? " press" : ""}${lit || held ? " lit" : ""}${blue ? " blue" : ""}${danger ? " danger" : ""}${drag ? " drag" : ""}${wrap ? " ds-stack-row-wrap" : ""}`;
  const dragProps = drag ? { draggable: true, onDragStart: drag.onDragStart, onDragEnd: drag.onDragEnd } : {};
  return onPress ? (
    <button type="button" className={cls} aria-label={label} aria-current={lit || undefined} onClick={onPress} {...dragProps}>
      {inner}
    </button>
  ) : (
    <div className={cls} {...dragProps}>
      {inner}
    </div>
  );
}

/** a system's colour, the only thing that leads its row */
export function StackDot({ colour }: { colour: string }) {
  return <span className="ds-stack-dot" style={{ background: colour }} aria-hidden="true" />;
}
