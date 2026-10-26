"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "./icon";
import { Fade } from "@/components/parts/fade";
import { Clock } from "./clock";
import { NAV } from "./nav";
import { PLACES, STILL_TO_MOVE, YOURS } from "./places";
import { useCommandPalette } from "./command-palette-context";
import { arrive, choose, closeTab, newTab, subscribeTabs, tabsServerSnapshot, tabsSnapshot } from "./open-tabs";
import { pageName, pageNamesServerSnapshot, pageNamesSnapshot, subscribePageNames, type PageName } from "./page-names";
import { Dot, type Hue } from "@/components/parts/state";

/* What a tab is called, and its glyph: the name the page gave itself
   (page-names.ts: a job's page says "3209 Richards" and its colour), or
   else the place or screen whose address is the longest start of the
   page's. */
const NAMED = [
  /* a job's page before it has said its name */
  { href: "/dashboard/jobs", label: "Job", icon: "folder" },
  /* a vehicle's page before it has said its name */
  { href: "/dashboard/vehicles", label: "Vehicle", icon: "truck" },
  ...PLACES.map((p) => ({ href: p.href, label: p.label, icon: p.icon })),
  ...STILL_TO_MOVE.map((p) => ({ href: p.href, label: p.label, icon: p.icon })),
  ...YOURS.map((p) => ({ href: p.href, label: p.label, icon: p.icon })),
  ...NAV.map((n) => ({ href: n.href, label: n.label, icon: n.icon })),
];
export function tabName(
  href: string,
  names: Readonly<Record<string, PageName>> = {},
): { label: string; icon: string; hue?: Hue } {
  const own = pageName(names, href);
  if (own) return { label: own.label, icon: own.icon ?? "folder", ...(own.hue ? { hue: own.hue } : {}) };
  const path = href.split(/[?#]/)[0];
  let best: { href: string; label: string; icon: string } | null = null;
  for (const n of NAMED) {
    if ((path === n.href || path.startsWith(n.href + "/")) && (!best || n.href.length > best.href.length)) best = n;
  }
  return best ?? { label: "Page", icon: "file" };
}

/* THE HEADER (rule 2): the date and the time together on the left of every
   page, open tabs on the right, and nothing else. Tiff isn't here (Isaac,
   18 October: "Home page will do it all"): her box is on Home, and sheets
   and boxes carry their own button. The bell has gone too (decision 25):
   what it carried is Home's To do, and its count sits on Home in the
   sidebar. */
export function Topbar({ today, tz = null }: { today: string; tz?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { open: openSearch } = useCommandPalette();
  const { tabs, on } = useSyncExternalStore(subscribeTabs, tabsSnapshot, tabsServerSnapshot);
  const names = useSyncExternalStore(subscribePageNames, pageNamesSnapshot, pageNamesServerSnapshot);

  /* where the browser is, query and all: going to a tab that's already
     there would ask the server for the same page again */
  const go = (href: string | null) => {
    if (href && href !== `${window.location.pathname}${window.location.search}`) router.push(href);
  };

  return (
    <header className="topbar fr-head" id="fg-topbar">
      <Suspense fallback={null}>
        <TabAddress />
      </Suspense>
      <Clock today={today} tz={tz} />
      <div className="fr-tabs" role="tablist" aria-label="Open tabs">
        {tabs.map((t) => {
          const name: { label: string; icon: string; hue?: Hue } = t.blank ? { label: "New tab", icon: "search" } : tabName(t.href, names);
          const here = t.id === on;
          return (
            <div key={t.id} className={`fr-tab${here ? " on" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={here}
                className="fr-tabgo"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    window.open(t.href, "_blank", "noopener");
                    return;
                  }
                  go(choose(t.id));
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) window.open(t.href, "_blank", "noopener");
                }}
              >
                {/* a job's tab wears its colour's dot (rule 18), not a glyph */}
                {name.hue ? <Dot hue={name.hue} /> : <Icon name={name.icon} size={16} />}
                <Fade className="fr-tablbl">{name.label}</Fade>
              </button>
              {tabs.length > 1 && (
                <button type="button" className="fr-tabx" aria-label={`Close ${name.label}`} onClick={() => go(closeTab(t.id))}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="fr-newtab"
          onClick={() => {
            newTab(pathname);
            openSearch();
          }}
        >
          <Icon name="plus" size={16} />
          New tab
        </button>
      </div>
    </header>
  );
}

/* THE ADDRESS THE TAB YOU'RE ON HOLDS, query and all. The query is read
   with useSearchParams, which a page's own replaceState keeps in step (the
   canvas names its design in `?design=`, Jobs its view in `?view=`), so a
   tab you leave by any way comes back to where you were. In a Suspense of
   its own, so nothing above it waits on the query. */
function TabAddress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    arrive(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);
  return null;
}
