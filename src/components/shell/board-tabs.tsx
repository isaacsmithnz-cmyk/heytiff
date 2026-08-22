"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

/* The board's tab row, as one object.

   Tabs that sit ON the white card holding the screen, rather than a pill group
   floating above it: the card is the surface you're working on and the tabs are
   its dividers. The maintenance and projects boards established it; Time & Pay
   and My time now use the same thing.

   IT LIVES HERE BECAUSE IT KEPT DRIFTING. There were three segmented controls
   in this app doing one job — `.wb2-vt` on the boards, `.wb2-seg` on the board
   switcher and `.segsw` on My time — and the comment above `.segsw` claimed it
   was shared with the Workboard's when the two had never been the same code.
   A shared class is not a shared control; a shared component is.

   The white shape behind the live tab is MEASURED off that tab rather than
   drawn per tab, so the curved joins into the card are defined once, in CSS,
   and a label change can't leave the shape the wrong width. The boards animate
   it, because their tab swaps in place. These tabs are real routes, so it
   simply arrives in position — same shape, nothing to travel. */

/* label is a node, not a string: the tax year tabs append their quiet
   "so far" tag to the current year, and a type that only takes words would
   force that back into a second control. */
export type BoardTab = { key: string; href: string; label: React.ReactNode };

export function BoardTabs({
  tabs,
  active,
  label,
}: {
  tabs: readonly BoardTab[];
  /** the key of the tab this screen IS — no match parks the shape off-screen */
  active: string;
  /** what this row navigates, for assistive tech */
  label: string;
}) {
  const rowRef = useRef<HTMLElement>(null);
  const [slide, setSlide] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current;
      const on = row?.querySelector<HTMLElement>(`[data-vt="${active}"]`);
      if (!row || !on) return;
      setSlide({ x: on.offsetLeft, w: on.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  return (
    <nav className="wb2-vtabs" ref={rowRef} aria-label={label}>
      {slide && (
        <span
          className="wb2-vslide"
          style={{ transform: `translateX(${slide.x}px)`, width: slide.w }}
          aria-hidden="true"
        />
      )}
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          data-vt={t.key}
          className={`wb2-vt${active === t.key ? " on" : ""}`}
          aria-current={active === t.key ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
