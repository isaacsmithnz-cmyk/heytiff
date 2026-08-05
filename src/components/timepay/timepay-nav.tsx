"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

/* The three faces of the team Time & Pay screen: timesheets, leave and
   expenses. Sibling routes rather than in-component tabs, so each is linkable
   and the server decides what each holds. All three sit under `timepay_all`;
   what you can DO inside each is gated separately (`approvals` to decide,
   `financials` to record a payment).

   THE BOARD'S TAB ROW (`.wb2-vtabs`), the same object the maintenance and
   projects boards use: tabs that sit ON the white card holding the screen,
   rather than a pill group floating above it. The card is the surface you're
   working on and the tabs are its file dividers — which is the whole reason
   the boards read as one place with several views instead of several pages.

   The white shape behind the active tab is measured, not drawn per-tab: it is
   one element positioned over whichever tab is current, so its curved joins
   into the card are defined once. On the boards it slides, because the tab
   swaps in place. Here each tab is a real route, so it simply arrives in the
   right position — same shape, no travel to animate. */

type Tab = "sheets" | "leave" | "expenses";

const TABS: { key: Tab; href: string; label: string }[] = [
  { key: "sheets", href: "/dashboard/timepay", label: "Timesheets" },
  { key: "leave", href: "/dashboard/timepay/leave", label: "Leave" },
  { key: "expenses", href: "/dashboard/timepay/expenses", label: "Expenses" },
];

export function TimepayNav({ active }: { active: Tab }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState<{ x: number; w: number } | null>(null);

  /* Measured from the live tab, so the shape tracks the label's real width —
     a hard-coded width drifts the moment a word changes or the font loads. */
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
    <nav className="wb2-vtabs" ref={rowRef} aria-label="Time and Pay">
      {slide && (
        <span
          className="wb2-vslide"
          style={{ transform: `translateX(${slide.x}px)`, width: slide.w }}
          aria-hidden="true"
        />
      )}
      {TABS.map((t) => (
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
