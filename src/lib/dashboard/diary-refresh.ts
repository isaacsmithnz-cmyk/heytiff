/* WHEN THE DIARY ASKS FOR ITSELF AGAIN — pure; the clock is handed in.

   The conversations come from ServiceM8's copy, and opening Home tops that
   copy up AFTER the response (sm8-freshness): a mirror more than ten
   minutes old is synced once the page has gone out, so what Luke wrote
   since lands in the copy a moment after you have been shown the page
   without it. The diary asks for the page again, and no more than this:

     A MINUTE AFTER IT OPENS, when the copy it was drawn from was stale —
     the sync the page itself set off has had its minute;
     WHEN YOU COME BACK TO THE TAB, when the page is more than ten minutes
     old — whatever HeyTiff holds that came in while you were away;
     A MINUTE AFTER THAT, when the page it brought was drawn from a stale
     copy too — what came in to ServiceM8 while you were away. Away that
     long, the copy is stale as a rule (the one timed sync is daily), and
     the page asked for is drawn from it before the sync its own load sets
     off has run. Once for one return.

   Neither while Tiff is open: a new page under a conversation would move
   what she is talking about. It waits for her to close.

   Only for a diary that reads ServiceM8 at all; your own entries come back
   with every save. */

/** A copy older than this is synced when a page opens — sm8-sync's
    STALE_AFTER_MS, which is server-side; a test holds the two equal. */
export const DIARY_STALE_MS = 10 * 60_000;

/** How long after it opens the diary asks again for a stale copy. */
export const DIARY_RECHECK_MS = 60_000;

/** The copy the page was drawn from was due a sync: it has never finished
    one, or its last finished more than DIARY_STALE_MS before `now`. */
export function mirrorStale(syncedAt: string | null, now: number): boolean {
  if (!syncedAt) return true;
  const at = Date.parse(syncedAt);
  return !Number.isFinite(at) || now - at > DIARY_STALE_MS;
}

/** The page came back more than DIARY_STALE_MS after it was last loaded. */
export function pageStale(loadedAt: number, now: number): boolean {
  return now - loadedAt > DIARY_STALE_MS;
}
