"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { SectionKey } from "./types";

export type NavItem = { key: SectionKey; label: string; admin?: boolean };

/* The section tabs — the maintenance board's row, on the staff card.

   It reuses `.wb2-vtabs / .wb2-vt / .wb2-vslide` rather than growing a second
   copy of them, which means it inherits the two things that row got right: the
   thumb that IS the card's top edge for the width of the active tab, and the
   36px offset that keeps the first tab off the card's corner so all four
   corners stay round through a switch. Fixing either one twice was the
   alternative.

   IT DOES NOT WRAP ANY MORE. The old strip wrapped onto three lines and put
   "Admin only" above the locked group, because that group landed on its own
   row anyway. One row of nine needs neither: the divider `.wb2-vt` already
   draws between any two inactive tabs separates them, and the lock on each
   says what it is. See the padding note in shell.css for why nine fit at all.

   The amber dot became a COUNT. A tab that owns missing fields says how many —
   "Personal 3" is the same sentence the deleted checklist spelled out in three
   rows, and it is the only thing left pointing at which section is short. */
export function ProfileTabs({
  items,
  active,
  attention,
  onGo,
  children,
}: {
  items: NavItem[];
  active: SectionKey;
  /** section → how many of its fields the checklist is still asking for */
  attention: ReadonlyMap<string, number>;
  onGo: (key: SectionKey) => void;
  /** docked at the row's right end, as the board docks its capture pill */
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
      const on = row?.querySelector<HTMLButtonElement>(`[data-psec="${active}"]`);
      if (!row || !on) return;
      setThumb({ x: on.offsetLeft, w: on.offsetWidth });
      // below the fit width the row scrolls; a tab you just chose from a
      // keyboard walk must not stay off the end of it. Feature-checked: jsdom
      // has no scrollIntoView, and this is a nicety, not the navigation.
      on.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active, items.length]);

  return (
    <div className="wb2-vtabs" ref={rowRef} role="tablist" aria-label="Profile sections">
      {thumb && (
        <span
          className="wb2-vslide"
          style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }}
          aria-hidden="true"
        />
      )}
      {items.map((n) => (
        <Tab key={n.key} item={n} active={active} count={attention.get(n.key) ?? 0} onGo={onGo} />
      ))}
      {children && <div className="wb2-vtcap">{children}</div>}
    </div>
  );
}

function Tab({
  item,
  active,
  count,
  onGo,
}: {
  item: NavItem;
  active: SectionKey;
  count: number;
  onGo: (key: SectionKey) => void;
}) {
  const on = item.key === active;
  return (
    <button
      type="button"
      role="tab"
      id={`pftab-${item.key}`}
      aria-selected={on}
      aria-controls={`psec-${item.key}`}
      // only the selected tab is in the tab order; the arrow keys move between
      // them, which is what a tablist is supposed to do
      tabIndex={on ? 0 : -1}
      className={"wb2-vt" + (on ? " on" : "")}
      data-psec={item.key}
      onClick={() => onGo(item.key)}
      onKeyDown={moveFocus}
    >
      {item.label}
      {item.admin && (
        <span className="lock">
          <Icon name="lock" size={13} />
        </span>
      )}
      {count > 0 && (
        <>
          <i className="wb2-vtn warn" aria-hidden="true">
            {count}
          </i>
          <span className="sr-only">
            {" "}
            — {count} detail{count === 1 ? "" : "s"} missing
          </span>
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
