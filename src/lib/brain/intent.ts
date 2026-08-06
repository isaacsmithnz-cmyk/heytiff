/* QUESTION OR NOTE? — local and free, like the sniff it stands beside.

   The one token now does two jobs: capture words (the note flow) and answer
   questions (the ask loop). Something has to pick, and that something runs
   on every submit, so it cannot be a model call — the same economics that
   built lib/notes/sniff.ts.

   THE ASYMMETRY RUNS THE OPPOSITE WAY TO THE SNIFF'S. There, a false "no"
   was invisible and a false "yes" cost one wasted call, so it leans
   generous. Here a false "question" EATS A NOTE — the words go to the
   answer loop and never reach the review card, so nothing is saved, and
   the person spoke a note that quietly became a conversation. A false
   "note" merely shows someone their own question on a review card, one
   Discard away. So this leans HARD toward note: it says "question" only on
   signals a note essentially never carries.

   Two such signals:
     · a trailing question mark — nobody dictates one into a site note
     · an INFORMATIONAL opener: "what's / where / when / who / why / how
       many / is there / do we / show me / tell me about…"

   The traps that shaped the opener list:
     · "can you order the grilles" is question-SHAPED and is a task. All the
       request modals (can/could/will/would/should) are excluded.
     · "tell Luke to order the grilles" is a task; "tell me about Meridian"
       is a question. The opener is "tell me", never "tell".
     · "is the crane booked" is a genuine question; "isolated the unit" is
       not — hence word-boundary matching, not prefixes. */

const OPENERS = [
  "what",
  "what's",
  "whats",
  "where",
  "where's",
  "wheres",
  "when",
  "when's",
  "who",
  "who's",
  "whos",
  "which",
  "why",
  "how",
  "is there",
  "are there",
  "is the",
  "are the",
  "do we",
  "does the",
  "does anyone",
  "did we",
  "did anyone",
  "has the",
  "has anyone",
  "have we",
  "am i",
  "show me",
  "tell me about",
  "tell me what",
  "any idea",
  "anything outstanding",
  "anything open",
];

/** Should these words go to the ask loop instead of the note flow? */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith("?")) return true;

  /* Openers match at the very start only. A question buried mid-note
     ("…and ask Dane what's left") is part of the note. */
  return OPENERS.some((o) => t === o || t.startsWith(o + " "));
}
