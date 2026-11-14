/* THE JOBS LAST OPENED, ON THIS BROWSER (Isaac, 14 November 2026: "Recent
   jobs at top" of New design's job picker, and "Both" to the jobs last
   opened and the newest). The phone keeps its own ten the same way
   (heytiff-mobile lib/recentJobs.ts): ids only, newest first, written as a
   job's page opens and read fresh by id where they're shown, so a job's
   colour and state are today's. Client-safe; a browser that refuses storage
   has no Recent, and nothing else changes. */

const KEY = "heytiff.jobs.opened";
const MOST = 10;

/** The ids of the jobs last opened here, newest first. */
export function openedJobs(): string[] {
  try {
    const kept: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, MOST) : [];
  } catch {
    return [];
  }
}

/** A job's page opened: it goes to the front. */
export function noteJobOpened(id: string | null | undefined): void {
  if (!id) return;
  try {
    const next = [id, ...openedJobs().filter((x) => x !== id)].slice(0, MOST);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* no storage: no Recent */
  }
}
