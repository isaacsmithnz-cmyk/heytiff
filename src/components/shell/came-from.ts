/* WHERE YOU CAME FROM (Isaac, 5 November 2026: "on a job card. We don't
   have a back button to go back to all jobs or whatever screen you were
   just on", then "That's good" to the mock on
   https://claude.ai/artifact/SJyEw4dkCb7MLp1bgCzypJ).

   A trail of the screens this tab has been to, by path, kept in memory
   only: a refresh, a link from somewhere else or a new tab starts it
   again, and the way back is then Jobs. A change of the query alone (a
   job's tabs, a filter) is the same screen, so it is never a step. The
   browser's own Back and Forward walk the trail too, so the word above a
   job's name stays the screen Back would land on. */

type Step = { path: string; href: string };

let trail: Step[] = [];
let popped = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    popped = true;
  });
}

const pathOf = (href: string) => href.split(/[?#]/)[0] || "/";

/** Notes the screen now showing; the shell calls it on every change of address. */
export function noteRoute(href: string): void {
  const path = pathOf(href);
  const top = trail[trail.length - 1];
  const wasPop = popped;
  popped = false;
  if (top && top.path === path) {
    trail = [...trail.slice(0, -1), { path, href }];
    return;
  }
  /* Back lands on the step before; anything else is a step forward */
  if (wasPop && trail.length >= 2 && trail[trail.length - 2]!.path === path) trail = trail.slice(0, -1);
  else trail = [...trail, { path, href }].slice(-50);
  emit();
}

/** The screen before this one, while this one is the trail's last; else null. */
export function cameFrom(path: string): string | null {
  const top = trail[trail.length - 1];
  if (!top || top.path !== pathOf(path) || trail.length < 2) return null;
  return trail[trail.length - 2]!.href;
}

export function subscribeTrail(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The trail's version, for useSyncExternalStore: it changes as the trail does. */
export function trailSnapshot(): string {
  return trail.map((s) => s.path).join(" ");
}

export function trailServerSnapshot(): string {
  return "";
}

/** For tests: forget the trail. */
export function resetTrail(): void {
  trail = [];
  popped = false;
  emit();
}
