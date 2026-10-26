"use client";

import { Activity, useEffect, useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { StudioHold } from "./studio-hold";

/* THE DESIGN STUDIO, KEPT ALIVE BEHIND OTHER TABS (Isaac, 26 October 2026:
   switching from the canvas to a job's tab and back "seems to have to reload
   the page… On Chrome, everything's ready to go straight away").

   A page in this app unmounts when you leave it, and the studio is a whole
   application of client state: the open design, the zoom, the tool, what's
   selected. So the studio is not drawn by its page. The page hands its
   studio to the keeper (StudioKeep), and the keeper draws it once, beside
   the pages (StudioHost, in the shell), inside React's <Activity>. Leaving
   Design hides it (display: none, its effects paused, its dialogs hidden
   with it); coming back shows the same studio, exactly as it was left.

   Which studio comes back is the address's call. Coming back to where the
   kept studio is (its design, or the list of designs) shows it. Asking for
   something else (the Design place in the sidebar, which is the list, while
   the kept studio has a design open; a link to another design) starts a new
   studio there, as a page always has. The studio tells the keeper which
   design it has open whenever that changes (noteKeptDesign), before it
   writes the address, so the two always agree.

   Next can keep whole pages alive this way only with `cacheComponents`,
   which stays off for /hq's access gate (PR #185); this does it for the one
   screen that needs it. */

const STUDIO = "/dashboard/studio";

type Kept = { element: ReactNode; key: number; design: string | null };

let kept: Kept | null = null;
let seq = 0;
const watchers = new Set<() => void>();
const watch = (fn: () => void) => {
  watchers.add(fn);
  return () => {
    watchers.delete(fn);
  };
};
const read = () => kept;
const none = () => null;

/** The kept studio has this design open now (null: its list of designs). */
export function noteKeptDesign(id: string | null): void {
  if (kept) kept.design = id;
}

/** Keep this studio, unless the kept one is already where it asks to be.
    Out here, not in the component: React Compiler won't lower a module
    counter's `++` inside a hook. */
function keep(element: ReactNode, design: string | null): void {
  if (kept && kept.design === design) return;
  seq += 1;
  kept = { element, key: seq, design };
  for (const w of watchers) w();
}

/** The Design page's studio, handed to the keeper. Draws only the studio's
    dark hold, which shows while the keeper hasn't drawn it yet (a first load,
    or a new studio for another design) and steps aside once it has. */
export function StudioKeep({ design, children }: { design?: string; children: ReactNode }) {
  const asked = design ?? null;
  useEffect(() => {
    keep(children, asked);
  }, [asked, children]);
  return <StudioHold />;
}

/** Where the kept studio is drawn: beside the pages, shown on Design. */
export function StudioHost() {
  const k = useSyncExternalStore(watch, read, none);
  const onStudio = usePathname() === STUDIO;
  const asked = useSearchParams().get("design");
  const shown = k !== null && onStudio && k.design === asked;

  /* the page's own outlet holds only the studio's hold while this shows */
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (shown) root.setAttribute("data-studio-kept", "");
    else root.removeAttribute("data-studio-kept");
  }, [shown]);

  if (!k) return null;
  return (
    <Activity mode={shown ? "visible" : "hidden"}>
      <div className="outlet ds-kept" key={k.key}>
        {k.element}
      </div>
    </Activity>
  );
}

/** For tests: forget the kept studio. */
export function resetStudioKeeper(): void {
  kept = null;
  for (const w of watchers) w();
}
