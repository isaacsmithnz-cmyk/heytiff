"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Icon } from "@/components/shell/icon";
import { cameFrom, subscribeTrail, trailServerSnapshot, trailSnapshot } from "@/components/shell/came-from";
import { pageNamesServerSnapshot, pageNamesSnapshot, subscribePageNames } from "@/components/shell/page-names";
import { PLACES } from "@/components/shell/places";
import { tabName } from "@/components/shell/topbar";

/* A JOB'S WAY BACK (Isaac, 5 November 2026, "That's good" to the mock on
   https://claude.ai/artifact/SJyEw4dkCb7MLp1bgCzypJ): above the job's
   header, a chevron and the screen you came from, in ink, a word button
   with no underline (his ruling on links). It takes you back to that
   screen as you left it: the browser's own Back, so its filter and its
   scroll come back too. With nowhere to go back to (a link, a refresh, a
   new tab) it is Jobs, and opens Jobs. */

export const ALL_JOBS = "/dashboard/jobs";

/** What the way back calls a screen: a place by its own name ("Jobs",
    "Home"), a page that named itself by that name ("3209 Richards"). */
export function backLabel(href: string, names: Parameters<typeof tabName>[1] = {}): string {
  const path = href.split(/[?#]/)[0];
  const place = PLACES.find((p) => p.href === path);
  if (place) return place.label;
  return tabName(href, names).label;
}

export function WayBack() {
  const router = useRouter();
  /* the trail is this tab's alone, so the server, and the first paint
     after it, see none: Jobs, until the trail says otherwise */
  const trail = useSyncExternalStore(subscribeTrail, trailSnapshot, trailServerSnapshot);
  const names = useSyncExternalStore(subscribePageNames, pageNamesSnapshot, pageNamesServerSnapshot);
  const from = trail ? cameFrom(window.location.pathname) : null;
  const word = (
    <>
      <Icon name="chevL" size={16} />
      <span>{from ? backLabel(from, names) : "Jobs"}</span>
    </>
  );
  if (!from)
    return (
      <Link href={ALL_JOBS} className="jp-back">
        {word}
      </Link>
    );
  return (
    <button type="button" className="jp-back" onClick={() => router.back()}>
      {word}
    </button>
  );
}
