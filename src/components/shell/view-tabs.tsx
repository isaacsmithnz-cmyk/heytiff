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
  /** A state with no number on it. The debrief is either done today or it
      isn't, and "1" would be a count of a conversation. */
  dot?: boolean;
  /** What the dot means, for anyone who cannot see it. */
  dotLabel?: string;
  /** Badge tint. Only for tabs whose count means SEVERITY; a tab that counts
      a place ("Noticeboard") takes the plain grey, because red and amber have
      to keep meaning "something is wrong". */
  tone?: "dan" | "warn";
  /** Trailing padlock, for sections gated above the viewer's role. */
  locked?: boolean;
  /** Appended to the accessible name so the badge is not a number alone. */
  countLabel?: (n: number) => string;
  /* Why the padlock needs words. It was a bare <svg> with no title, no
     aria-hidden and no label on the tab, so "Payroll 🔒" announced as
     "Payroll" — the gate existed only as a glyph. Same shape as `countLabel`:
     the icon goes aria-hidden and the meaning is said in text. */
  lockLabel?: string;
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
  /* Which sides have tabs hidden past the edge. The strip scrolls below its fit
     width and the stylesheet HIDES the scrollbar (scrollbar-width:none plus the
     webkit twin), so the one affordance it had was deliberately removed and
     nothing put back: nine tabs, 925px of them, inside 295px on a narrow
     window, with no sign that Payroll, Permissions and Notes exist. These drive
     an edge fade in CSS. Measured rather than assumed, for the same reason the
     thumb is — it depends on the font. */
  const [edges, setEdges] = useState({ l: false, r: false });

  /* The thumb is measured, not computed: label widths depend on the font, and
     the font arrives after first paint. Re-measuring on resize covers the
     scrolling case below the fit width too. */
  useLayoutEffect(() => {
    const row = rowRef.current;

    /* WHICH SIDES ARE CUT OFF. Cheap, and safe to run on every scroll frame —
       it only reads and sets state. */
    const readEdges = () => {
      if (!row) return;
      // 1px of slack: sub-pixel widths otherwise leave a fade on forever
      const max = row.scrollWidth - row.clientWidth;
      setEdges({ l: row.scrollLeft > 1, r: row.scrollLeft < max - 1 });
    };

    /* THE THUMB, AND REVEALING THE CHOSEN TAB. Separate from readEdges, and it
       must STAY separate: this calls scrollIntoView, so wiring it to the scroll
       event makes the strip drag itself back to the active tab the instant you
       scroll it by hand. That is exactly what happened when the edge-fade
       listener first shared this function — a scroll to the far end snapped
       back to 24px. Reveal on the things that should reveal (a new active tab,
       a resize), never on the user's own scrolling. */
    const measure = () => {
      if (!row) return;
      const on = row.querySelector<HTMLButtonElement>(`[data-vtab="${active}"]`);
      if (on) {
        setThumb({ x: on.offsetLeft, w: on.offsetWidth });
        /* Below the fit width the row scrolls; a tab you just chose from a
           keyboard walk must not stay off the end of it. Feature-checked: jsdom
           has no scrollIntoView, and this is a nicety, not the navigation. */
        on.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      readEdges();
    };

    measure();
    window.addEventListener("resize", measure);
    row?.addEventListener("scroll", readEdges, { passive: true });
    /* A window resize is not the only thing that changes this row's width — the
       card reflows under it, and on first paint the strip can be measured at
       zero before layout settles, which would leave the fades wrong with
       nothing to re-trigger them. Observing the row itself covers both.
       Feature-checked: jsdom has no ResizeObserver. */
    const ro =
      typeof ResizeObserver === "function" && row ? new ResizeObserver(readEdges) : null;
    if (row) ro?.observe(row);
    return () => {
      window.removeEventListener("resize", measure);
      row?.removeEventListener("scroll", readEdges);
      ro?.disconnect();
    };
  }, [active, items.length]);

  return (
    <div
      className="wb2-vtabs"
      ref={rowRef}
      role="tablist"
      aria-label={ariaLabel}
      data-ovl={edges.l ? "" : undefined}
      data-ovr={edges.r ? "" : undefined}
    >
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
        <>
          <span className="lock" aria-hidden="true">
            <Icon name="lock" size={13} />
          </span>
          <span className="sr-only"> — {tab.lockLabel ?? "restricted"}</span>
        </>
      )}
      {count > 0 && (
        <>
          <i className={"wb2-vtn" + (tab.tone ? ` ${tab.tone}` : "")} aria-hidden="true">
            {count}
          </i>
          {tab.countLabel && <span className="sr-only"> — {tab.countLabel(count)}</span>}
        </>
      )}
      {/* A DOT IS A STATE, NOT A COUNT. Some faces are either wanting you or
          not — the debrief is had or not had today — and the badge cannot say
          that with a number without inventing one. It reads as a word to a
          screen reader, where a dot is nothing at all. */}
      {count === 0 && tab.dot && (
        <>
          <i className="wb2-vtdot" aria-hidden="true" />
          <span className="sr-only"> — {tab.dotLabel ?? "not done yet"}</span>
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
