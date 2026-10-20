"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { homeCount } from "@/app/actions/home-count";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";

/* THE COUNT BESIDE HOME (decision 25). The bell went; what it counted sits
   on Home's row in the sidebar, white on the ink (a coloured word does not
   reach 4.5:1 there), and only when there is something to count.

   It asks as the bell asked: once the frame is up (the layout is
   synchronous, so the frame never waits on it), again every minute while
   the tab is looked at (a reminder comes due while you sit on a screen),
   when you come back to the tab, and when a screen says it has cleared a
   row (`BELL_REFRESH_EVENT`: a SWMS signed on, To do's Later or Got it).
   A read that fails keeps the last number. */

const POLL_MS = 60_000;

export function useHomeCount(load: () => Promise<number | null> = homeCount): number | null {
  const [count, setCount] = useState<number | null>(null);
  const live = useRef(true);
  const ask = useCallback(async () => {
    const n = await load().catch(() => null);
    if (live.current && n !== null) setCount(n);
  }, [load]);

  useEffect(() => {
    live.current = true;
    /* after this render commits, not during it */
    void Promise.resolve().then(ask);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void ask();
    }, POLL_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") void ask();
    };
    const onAsk = () => void ask();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener(BELL_REFRESH_EVENT, onAsk);
    return () => {
      live.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener(BELL_REFRESH_EVENT, onAsk);
    };
  }, [ask]);

  return count;
}

/** "3", or nothing at all. A screen reader hears "3 to do". */
export function HomeCount({ load }: { load?: () => Promise<number | null> }) {
  const count = useHomeCount(load);
  if (count === null || count <= 0) return null;
  return (
    <span className="hm-navcount">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">, {count} to do</span>
    </span>
  );
}
