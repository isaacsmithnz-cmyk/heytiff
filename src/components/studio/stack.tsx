"use client";

/* THE RIGHT COLUMN AS A NATIVE STACK (the next flow; the Clean layout page of
   the Studio rework mocks, after the phone app's components/List.tsx). Grouped
   white rows on the grey ground, a back button that names the screen behind,
   one action at the foot. Systems, a system, a room, the air and Edit system
   are all screens of this one column. */

import type { ReactNode } from "react";
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
}: {
  name: ReactNode;
  sub?: ReactNode;
  /** the name of the screen behind */
  back?: string;
  onBack?: () => void;
  /** one small action level with the title */
  action?: ReactNode;
}) {
  return (
    <header className="ds-stack-head">
      {back && onBack ? (
        <button type="button" className="ds-stack-back" onClick={onBack}>
          <Icon name="chevL" size={16} />
          {back}
        </button>
      ) : null}
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
  children,
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
  /** the row's own control, at its right: a tray or a field */
  children?: ReactNode;
}) {
  const inner = (
    <>
      {lead}
      <span className="ds-stack-row-l">
        <Fade className="ds-stack-row-t">{name}</Fade>
        {sub ? <Fade className="ds-stack-row-s">{sub}</Fade> : null}
        {more ? <Fade className="ds-stack-row-s">{more}</Fade> : null}
      </span>
      {value != null && value !== "" ? <span className={`ds-stack-row-v${tone ? ` ${tone === "good" ? "ok" : tone}` : ""}`}>{value}</span> : null}
      {children}
      {chevron ? (
        <span className="ds-stack-chev" aria-hidden="true">
          <Icon name="chevR" size={16} />
        </span>
      ) : null}
    </>
  );
  return onPress ? (
    <button type="button" className="ds-stack-row press" aria-label={label} onClick={onPress}>
      {inner}
    </button>
  ) : (
    <div className="ds-stack-row">{inner}</div>
  );
}

/** a system's colour, the only thing that leads its row */
export function StackDot({ colour }: { colour: string }) {
  return <span className="ds-stack-dot" style={{ background: colour }} aria-hidden="true" />;
}
