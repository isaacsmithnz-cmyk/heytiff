"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Dot } from "./state";

/* NOTHING THERE YET (rule 40, law 12): what is missing, in a few words,
   and the action that fills it. No picture and no caption explaining the
   screen (law 3). `action` is asked for every time, so a screen decides
   it; it is null only where the viewer can't make the thing. */
export function Empty({ what, line, action }: { what: ReactNode; line?: ReactNode; action: ReactNode }) {
  return (
    <div className="pt-empty">
      <p className="pt-empty-what">{what}</p>
      {line != null && <p className="pt-empty-line">{line}</p>}
      {action != null && <div className="pt-empty-act">{action}</div>}
    </div>
  );
}

const SHOW_AFTER = 500;

/* LOADING (rule 41, law 27): nothing for half a second, so a fast answer
   never flashes, then blocks shaped like what is coming. The blocks are
   still: a loop needs its row in docs/design.md, and a skeleton is state,
   not ambience. A screen reader hears what is loading, said once. */
export function Loading({
  what,
  shape = "rows",
  count,
}: {
  /** what is coming, as the wait says it: "Loading visits" */
  what: string;
  shape?: "rows" | "card" | "text";
  count?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), SHOW_AFTER);
    return () => clearTimeout(t);
  }, []);
  const n = count ?? (shape === "card" ? 1 : 3);
  return (
    <div className={`pt-load pt-load--${shape}`} aria-busy="true">
      {shown && (
        <>
          <span className="pt-load-sr" role="status">
            {what}
          </span>
          <div className="pt-load-shape" aria-hidden="true">
            {Array.from({ length: n }, (_, i) =>
              shape === "rows" ? (
                <div key={i} className="pt-load-row">
                  <span className="pt-load-bar pt-load-name" />
                  <span className="pt-load-bar pt-load-line" />
                </div>
              ) : shape === "card" ? (
                <div key={i} className="pt-load-bar pt-load-card" />
              ) : (
                <span key={i} className="pt-load-bar pt-load-text" />
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* WHEN SOMETHING GOES WRONG (rule 42): a red dot and the word, what it
   means for you, and what to do. Red is the word and the dot, never a box
   (rule 16, law 31). */
export function Wrong({ word, means, action }: { word: ReactNode; means: ReactNode; action?: ReactNode }) {
  return (
    <div className="pt-wrong">
      <p className="pt-wrong-word">
        <Dot hue="red" />
        {word}
      </p>
      <p className="pt-wrong-means">{means}</p>
      {action != null && <div className="pt-wrong-act">{action}</div>}
    </div>
  );
}
