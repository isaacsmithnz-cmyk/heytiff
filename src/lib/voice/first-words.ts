/* HER FIRST WORDS IN A TALK (Isaac, 28 November 2026: "I would like her to
   respond immediately after asking a question to buy some time when
   searching the database... Don't say the same thing every time. Have like
   a range of things... 20 or 30 different ways", then "Yes, do the speaker
   button", whose choice put them in Talk only:
   https://claude.ai/artifact/55kQ4sPdFTgkj6qwdtqB7W).

   The moment what you said goes to her, one of these is said while she
   looks, and her answer is read once it's finished. Which list it comes from
   goes by the words you used; within a list every line is said once before
   any comes round again, and never the same one twice running.

   THEY ARE MADE ONCE, in her voice, and kept as files
   (public/brand/tiff-voice/first-words/01.mp3 to 32.mp3, the line's number
   here), so one plays at once with no wait for her voice to be made. The
   phone keeps the same 32 in its own copy of this list, so a line changed
   here is changed there and made again. */

export type FirstWordsGroup = "manuals" | "job" | "money" | "any";

/** In clip order: the first line is 01.mp3. */
export const FIRST_WORDS: { group: FirstWordsGroup; text: string }[] = [
  { group: "manuals", text: "I'll just have a look in the manuals for you." },
  { group: "manuals", text: "Let me check the manual on that." },
  { group: "manuals", text: "One sec, I'll find the right page." },
  { group: "manuals", text: "I'll look that up in the specs." },
  { group: "manuals", text: "Let me dig out the install guide." },
  { group: "manuals", text: "Hang on, I'll check what the maker says." },
  { group: "manuals", text: "I'll have a look through the data sheets." },
  { group: "manuals", text: "Give me a moment, I'm finding the manual." },
  { group: "manuals", text: "Let me check the book on that one." },
  { group: "manuals", text: "I'll see what the manual says about it." },
  { group: "job", text: "Let me pull up the job." },
  { group: "job", text: "I'll have a look at the job card." },
  { group: "job", text: "One sec, I'll check the schedule." },
  { group: "job", text: "Let me see who's booked." },
  { group: "job", text: "I'll check the job's history for you." },
  { group: "job", text: "Give me a sec, I'm finding that job." },
  { group: "job", text: "Let me look back through the notes." },
  { group: "job", text: "I'll check what's on the job." },
  { group: "money", text: "I'll check the numbers." },
  { group: "money", text: "Let me look at the quote." },
  { group: "money", text: "One sec, I'll run the figures." },
  { group: "money", text: "I'll have a look at the price book." },
  { group: "money", text: "Let me check what's on that quote." },
  { group: "money", text: "Give me a moment to work that out." },
  { group: "any", text: "Give me a sec." },
  { group: "any", text: "Let me have a look." },
  { group: "any", text: "Leave it with me a moment." },
  { group: "any", text: "One moment, I'm on it." },
  { group: "any", text: "Let me check that for you." },
  { group: "any", text: "Hang on, I'll find out." },
  { group: "any", text: "Let me think about that one." },
  { group: "any", text: "Bear with me a sec." },
];

/** Where line `n` (0-based) is kept, as the page asks for it. */
export const firstWordsUrl = (n: number) => `/brand/tiff-voice/first-words/${String(n + 1).padStart(2, "0")}.mp3`;

/* A reply, not a question: nothing to look up, so nothing to say first. */
const REPLY =
  /^(yes|yeah|yep|yup|no|nah|nope|ok|okay|sure|thanks|thank you|cheers|ta|great|perfect|good|done|sounds good|that's all|thats all|that's it|thats it|all good|go ahead|do it)\b/i;

const MANUALS =
  /\b(manuals?|specs?|specifications?|data ?sheets?|install(ation|ing)?|commission(ing)?|clearances?|wiring|wired?|fault|faults|error|errors|codes?|flashing|blinking|model|models|refrigerant|gas charge|pressures?|isolator|breaker|reset|[a-z]{1,2}\d{1,3})\b/i;
const MONEY = /\b(quotes?|quoted|quoting|price|prices|priced|pricing|cost|costs|costing|how much|invoices?|invoiced|margin|markup|profit|dollars?|bucks)\b|\$/i;
const JOB =
  /\b(jobs?|booked|booking|bookings|schedule|scheduled|customers?|clients?|address|site|visit|visits|today|tomorrow|yesterday|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|who's|whos|who is|notes?|\d{3,5})\b/i;

/** Which list what was said takes its first words from, or null for a reply that needs none. */
export function firstWordsGroup(said: string): FirstWordsGroup | null {
  const s = said.trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return null;
  if (words.length <= 5 && REPLY.test(s)) return null;
  if (MANUALS.test(s)) return "manuals";
  if (MONEY.test(s)) return "money";
  if (JOB.test(s)) return "job";
  return "any";
}

/** Each list's lines still to be said this round, and the one said last. */
type Round = { left: number[]; last: number | null };

/** Picks the first words for what was said: the line's number, or null for none. Every line of a list once,
    in a shuffled order, before any again, and never the one said last. `random` for tests. */
export function firstWordsPicker(random: () => number = Math.random) {
  const rounds = new Map<FirstWordsGroup, Round>();
  return (said: string): number | null => {
    const group = firstWordsGroup(said);
    if (!group) return null;
    const round = rounds.get(group) ?? { left: [], last: null };
    rounds.set(group, round);
    if (round.left.length === 0) {
      const all = FIRST_WORDS.flatMap((l, i) => (l.group === group ? [i] : []));
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
      /* a new round never opens with the line that closed the last one */
      if (all.length > 1 && all[0] === round.last) [all[0], all[1]] = [all[1], all[0]];
      round.left = all;
    }
    const n = round.left.shift()!;
    round.last = n;
    return n;
  };
}
