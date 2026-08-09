"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icon";

/* THE VIEW TABS — the maintenance board's row, as one component.

   `.wb2-vtabs / .wb2-vt / .wb2-vslide` were already being reused by the staff
   card rather than copied, and the comment there says why: the thumb that IS
   the card's top edge for the width of the active tab, and the 36px offset
   that keeps the first tab off the card's corner so all four corners stay
   round through a switch — "fixing either one twice was the alternative".

   Home is the third screen to want them, and reusing the CSS while copying the
   COMPONENT is the same mistake one level up. So the strip lives here now and
   the staff card is a thin adapter over it. Nothing about how it looks or
   behaves changed in the move. */

export type ViewTab = {
  key: string;
  label: string;
  /** Count badge. Absent or zero renders nothing — "checked, none" is what an
      empty tab already says, and a grey 0 on every tab is noise. */
  count?: number;
  /** Badge tint. Only for tabs whose count means SEVERITY; a tab that counts
      a place ("Noticeboard") takes the plain grey, because red and amber have
      to keep meaning "something is wrong". */
  tone?: "dan" | "warn";
  /** Trailing padlock, for sections gated above the viewer's role. */
  locked?: boolean;
  /** Appended to the accessible name so the badge is not a number alone. */
  countLabel?: (n: number) => string;
};

export function ViewTabs({
  items,
  active,
  onGo,
  ariaLabel,
  idPrefix,
  panelPrefix,
  children,
}: {
  items: readonly ViewTab[];
  active: string;
  onGo: (key: string) => void;
  ariaLabel: string;
  /** `${idPrefix}-${key}` — the tab's own id. */
  idPrefix: string;
  /** `${panelPrefix}-${key}` — what the tab controls. */
  panelPrefix: string;
  /** Docked at the row's right end, as the board docks its capture pill. */
  children?: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  /* The thumb is measured, not computed: label widths depend on the font, and
     the font arrives after first paint. Re-measuring on resize covers the
     scrolling case below the fit width too. */
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const on = row?.querySelector<HTMLButtonElement>(`[data-vtab="${active}"]`);
      if (!row || !on) return;
      setThumb({ x: on.offsetLeft, w: on.offsetWidth });
      /* Below the fit width the row scrolls; a tab you just chose from a
         keyboard walk must not stay off the end of it. Feature-checked: jsdom
         has no scrollIntoView, and this is a nicety, not the navigation. */
      on.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, items.length]);

  return (
    <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label={ariaLabel}>
      {thumb && (
        <span
          className="wb2-vslide"
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
          aria-hidden="true"
        />
      )}
      {items.map((t) => (
        <Tab
          key={t.key}
          tab={t}
          on={t.key === active}
          idPrefix={idPrefix}
          panelPrefix={panelPrefix}
          onGo={onGo}
        />
      ))}
      {children && <div className="wb2-vtcap">{children}</div>}
    </div>
  );
}

function Tab({
  tab,
  on,
  idPrefix,
  panelPrefix,
  onGo,
}: {
  tab: ViewTab;
  on: boolean;
  idPrefix: string;
  panelPrefix: string;
  onGo: (key: string) => void;
}) {
  const count = tab.count ?? 0;
  return (
    <button
      type="button"
      role="tab"
      id={`${idPrefix}-${tab.key}`}
      aria-selected={on}
      aria-controls={`${panelPrefix}-${tab.key}`}
      /* Only the selected tab is in the tab order; the arrow keys move between
         them, which is what a tablist is supposed to do. */
      tabIndex={on ? 0 : -1}
      className={"wb2-vt" + (on ? " on" : "")}
      data-vtab={tab.key}
      onClick={() => onGo(tab.key)}
      onKeyDown={moveFocus}
    >
      {tab.label}
      {tab.locked && (
        <span className="lock">
          <Icon name="lock" size={13} />
        </span>
      )}
      {count > 0 && (
        <>
          <i className={"wb2-vtn" + (tab.tone ? ` ${tab.tone}` : "")} aria-hidden="true">
            {count}
          </i>
          {tab.countLabel && <span className="sr-only"> — {tab.countLabel(count)}</span>}
        </>
      )}
    </button>
  );
}

/** Left/right (and Home/End) walk the strip, as a tablist should. */
function moveFocus(e: React.KeyboardEvent<HTMLButtonElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const strip = e.currentTarget.closest(".wb2-vtabs");
  if (!strip) return;
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(e.currentTarget);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
}
