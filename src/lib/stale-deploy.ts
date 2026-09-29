/* A TAB OLDER THAN THE DEPLOY. Every press on a server action goes by the
   action's id, and the id is the build's: once a new deploy replaces
   production, a tab still open on the old one asks for an id the server no
   longer has. The server logs "Failed to find Server Action", answers 404
   with Next's action-not-found header, and the client's call REJECTS with
   Next's UnrecognizedActionError (server-action-reducer.js). Nothing the
   press itself says is true then: "couldn't queue it. Try again" can never
   come right, because every try again goes by the same dead id. Only a
   reload can.

   So a press's failure goes through thrownWords: the reload line for that
   rejection, the press's own words for anything else. Never a reload of our
   own; the person may have typing on the page.

   Skew Protection (Vercel, Pro) routes an old tab's actions to the old
   deploy for its maximum age, and this is the net while it is off. Past
   that age Vercel answers with its own 404, without Next's header, so the
   rejection is a plain Error and the press says its usual words (DEPLOY.md,
   step 2). */

import { unstable_isUnrecognizedActionError } from "next/navigation";

/** The one line a press says when the tab is older than the deploy. */
export const STALE_DEPLOY_WORDS = "HeyTiff was updated. Reload the page to carry on.";

/** Next's rejection for an action id this deploy doesn't have. Its own
    check first; the class's name as well, because a second copy of the
    class (or a test's stand-in for next/navigation) fails instanceof. */
export function isStaleDeploy(e: unknown): boolean {
  if (typeof unstable_isUnrecognizedActionError === "function" && unstable_isUnrecognizedActionError(e)) return true;
  return e instanceof Error && e.name === "UnrecognizedActionError";
}

/** What a press says when its action threw: the reload line for a tab
    older than the deploy, `fallback` for anything else. */
export function thrownWords(e: unknown, fallback: string): string {
  return isStaleDeploy(e) ? STALE_DEPLOY_WORDS : fallback;
}
