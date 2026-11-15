import type { SiteNotesRead } from "@/lib/sites/site-notes";

/* THE SITE NOTES' READS, by their own route (/api/workboard/site-notes), not
   a server action: the job page's actions run one at a time, and the
   pop-up's first open waited about ten seconds behind them (the walk of 15
   November 2026, 3416). Null when it couldn't be read. */

const ROUTE = "/api/workboard/site-notes";

/** The site's notes and the other jobs there. */
export async function fetchSiteNotes(jobUuid: string): Promise<SiteNotesRead | null> {
  const r = await fetch(`${ROUTE}?job=${encodeURIComponent(jobUuid)}`);
  const a = (await r.json()) as { ok?: boolean; read?: SiteNotesRead };
  return a?.ok && a.read ? a.read : null;
}

/** How many notes the job's site has, for the mark on its button. */
export async function fetchSiteNoteCount(jobUuid: string): Promise<number | null> {
  const r = await fetch(`${ROUTE}?job=${encodeURIComponent(jobUuid)}&count=1`);
  const a = (await r.json()) as { ok?: boolean; count?: number | null };
  return a?.ok && typeof a.count === "number" ? a.count : null;
}
