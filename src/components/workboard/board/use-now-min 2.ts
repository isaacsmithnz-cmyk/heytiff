"use client";

import { useEffect, useState } from "react";

/* "Now" is drawn from the BROWSER's clock, and only when the browser's own
   date agrees with the board's today — the account's timezone lives on the
   server, and for a crew in the same country the two clocks agree. When they
   don't (a viewer overseas), the reading is null and nothing that depends on
   it is claimed: a missing mark beats one that's hours wrong. Read in an
   effect so a subtree using it could server-render someday without a
   hydration split.

   BOTH DIARY TABS ASK THE SAME QUESTION, which is why this is a hook and not
   a prop. The rail draws a now-line with it and the capacity window judges
   lateness with it; the two must not be able to disagree about what minute it
   is, and threading it between sibling tabs would only mean a third owner. */
export function useNowMin(today: string): number | null {
  const [nowMin, setNowMin] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const d = new Date();
      const localISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      setNowMin(localISO === today ? d.getHours() * 60 + d.getMinutes() : null);
    };
    read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, [today]);
  return nowMin;
}
