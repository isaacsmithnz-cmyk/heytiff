"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* TEXT THAT DOESN'T FIT FADES OUT AT ITS END (rule 50), never cut with a
   "…". The fade is a mask, so it reads on any ground, and it is only put on
   while the text really overflows: a name that fits is drawn plain, end to
   end. The whole text stays in the page as real text, so a screen reader
   and a copy get all of it; there is no tooltip (law 25).

   `lines={2}` lets it wrap once and fades the end of the second line. No
   `line-clamp`: Chrome draws its own ellipsis there. */
export function Fade({
  children,
  lines = 1,
  className,
}: {
  children: ReactNode;
  lines?: 1 | 2;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setOver(lines === 1 ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lines, children]);

  const cls = ["pt-fade", lines === 2 ? "pt-fade--2" : null, over ? "pt-fade--on" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span ref={ref} className={cls}>
      {children}
    </span>
  );
}
