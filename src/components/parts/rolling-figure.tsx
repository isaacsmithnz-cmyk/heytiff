"use client";

import { useEffect, useRef } from "react";

/* A FIGURE THAT ROLLS (Isaac, 30 October 2026: "the money should roll up and
   down like a slot machine sort of thing"): its digits turn to their new
   values, keyed from the right so the cents stay the cents as the figure
   grows. The figure stands whole in the markup; the columns are the sheet's,
   so nothing reads them. Only figures: words lose their kerning in columns. */
export function RollingFigure({ value }: { value: string }) {
  const root = useRef<HTMLSpanElement | null>(null);
  /* a digit that arrives with the figure, $207 going to $3,347, rolls in; none
     does as the page opens */
  useEffect(() => {
    const el = root.current;
    /* two frames: the digits' first style must be behind them */
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => el?.setAttribute("data-live", ""));
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const chars = [...value];
  return (
    <span className="rf" ref={root}>
      <span className="rf-text">{value}</span>
      <span className="rf-roll" aria-hidden="true">
        {chars.map((c, i) => {
          const key = chars.length - i;
          return /\d/.test(c) ? (
            <span key={key} className="rf-d" style={{ "--d": Number(c) } as React.CSSProperties} />
          ) : (
            <span key={key} className="rf-c" data-c={c} />
          );
        })}
      </span>
    </span>
  );
}
