/* ENDING YOUR TURN ON QUIET (Isaac, 2026-09-28: "having to click done kind
   of takes away from the conversation flow… maybe like two seconds of
   silence").

   A plain silence timer is what the phone assistants use, and on a site it
   clips people: they stop to look at a unit or climb down a ladder in the
   middle of a sentence. So the quiet that ends a take depends on whether
   the words so far sound finished:

     ends a sentence ("…by Friday.")          1.5 s
     ends on a word that isn't a joiner       2 s   (the live words often
                                                     carry no full stop yet)
     ends on a joiner or a filler ("…and")    4 s
     live, and no words yet                   never (a cough is not a turn)
     words unknown (the batch transport)      2.5 s

   The quiet is counted from the last frame the meter heard a voice, and
   the Done button fills as it runs out (`--quiet`). Speaking starts it
   over; so does a tap in the dock. Done still works, and is never needed. */

export const QUIET_FINISHED_MS = 1500;
export const QUIET_OPEN_MS = 2000;
export const QUIET_MIDWAY_MS = 4000;
export const QUIET_UNREAD_MS = 2500;

/** Words a sentence doesn't end on: joiners, articles, fillers. */
const MIDWAY = new Set([
  "and", "or", "but", "so", "then", "because", "cause", "if", "when", "while", "that", "which", "who",
  "the", "a", "an", "to", "of", "for", "with", "at", "on", "in", "from", "by", "into", "about", "like",
  "um", "uh", "er", "erm", "ah", "hmm", "is", "are", "was", "were", "be", "my", "his", "her", "their",
  "our", "your", "some", "also", "plus",
]);

/** How long a quiet ends the take, given what has been heard; null keeps listening. */
export function quietLimit(words: string, how: { live: boolean }): number | null {
  const said = words.trim();
  if (!how.live) return QUIET_UNREAD_MS;
  if (!said) return null;
  if (/[.?!…？。]["'”’)\]]*$/u.test(said)) return QUIET_FINISHED_MS;
  const last = said
    .toLowerCase()
    .replace(/[,;:\-–—]+$/u, "")
    .split(/\s+/)
    .pop();
  if (!last || MIDWAY.has(last) || /[,;:\-–—]$/u.test(said)) return QUIET_MIDWAY_MS;
  return QUIET_OPEN_MS;
}
