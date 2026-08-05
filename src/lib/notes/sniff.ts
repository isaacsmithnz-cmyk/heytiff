/* IS THERE AN ACTION IN THIS? — a cheap local guess, never the model.

   Isaac chose "smart, but only when it finds something" for the plain form
   fields: dictate into "access notes" and the box just fills; if the words
   contain something that ought to become a task, a quiet line offers it and
   ignoring it costs nothing.

   THE PROBLEM THAT MAKES THIS FILE EXIST. Deciding the question properly
   means asking the router, and the router is an Opus 5 call — measured at
   ~7 s and real money. Paying that every time somebody dictates a gate code
   into a text box would be absurd: most field dictation is a gate code, a
   name at the front desk, a note about where the roof ladder is.

   So this runs first, in the browser, for free. It is deliberately a SIEVE,
   not a judge: it decides whether the expensive question is worth asking,
   and the router still decides the answer. Two consequences for anyone
   changing it —

     · FALSE POSITIVES ARE CHEAP. A wrong "yes" costs one routing call whose
       proposal comes back empty and is silently dropped. Lean generous.
     · FALSE NEGATIVES ARE INVISIBLE. A wrong "no" means the offer never
       appears and nobody knows it could have. That is the failure to fear,
       which is why this errs toward asking.

   Plain testable code, never the model — the same rule `note-match.ts`
   follows. Understanding is probabilistic; the decision to spend money is
   deterministic. */

/** Words that put a job on somebody. Deliberately spoken-English, because
    this reads transcripts: "needs to", "has to", "wants" — not "shall". */
const OBLIGATION = [
  "needs to",
  "need to",
  "needs a",
  "has to",
  "have to",
  "should",
  "must",
  "make sure",
  "don't forget",
  "dont forget",
  "remember to",
  "remind",
  "chase",
  "follow up",
  "book in",
  "get someone",
  "someone needs",
  "we need",
  "i need",
  "can you",
  "could you",
  "tell ",
  "ask ",
];

/** Things you do to a job rather than record about it. Bare imperatives are
    the hardest case — "order the grilles" has no obligation word at all —
    so the verbs carry it, and only when they OPEN a clause. */
const IMPERATIVE = [
  "order",
  "replace",
  "quote",
  "invoice",
  "call",
  "email",
  "send",
  "book",
  "arrange",
  "schedule",
  "collect",
  "pick up",
  "drop off",
  "bring",
  "fix",
  "repair",
  "check",
  "chase",
  "return",
  "swap",
  "install",
  "remove",
];

/** When. A deadline is the strongest single signal that a sentence is about
    something that has to happen, rather than something that is true. */
const DEADLINE = [
  "today",
  "tonight",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "next week",
  "this week",
  "next visit",
  "before ",
  "by the ",
  "asap",
  "urgent",
  "end of day",
  "end of week",
  "eod",
  "cob",
];

/** Something is wrong, which is how a flag sounds. */
const FAULT = [
  "tripped",
  "faulty",
  "broken",
  "leaking",
  "leak",
  "not working",
  "isn't working",
  "isnt working",
  "failed",
  "seized",
  "cracked",
  "blocked",
  "overheating",
  "alarm",
  "fault",
  "again",
  "still not",
  "keeps ",
];

export type Sniff = {
  /** Worth paying the router for. */
  actionable: boolean;
  /** Why — shown in no UI, but it makes the tests readable and a wrong
      verdict diagnosable without re-deriving the scoring by hand. */
  reasons: string[];
  /** 0–1, for a caller that wants to be choosier than the default. */
  score: number;
};

const NOTHING: Sniff = { actionable: false, reasons: [], score: 0 };

/** Does `needle` start a word in `hay`? Stops "order" matching "recorder"
    and "call" matching "recall" — both of which turn up in HVAC notes. */
function hasWord(hay: string, needle: string): boolean {
  const at = hay.indexOf(needle);
  if (at < 0) return false;
  /* Phrases carrying their own trailing space are already anchored on the
     right; only the left edge needs checking. */
  if (at === 0) return true;
  return !/[a-z0-9]/.test(hay[at - 1]);
}

const anyOf = (hay: string, list: readonly string[]): string | null =>
  list.find((w) => hasWord(hay, w)) ?? null;

/** A person's first name, spoken. The caller passes the roster, because
    "Luke needs to order the grilles" is only a task if Luke is real —
    and a name is the single strongest signal there is. */
function namedPerson(hay: string, firstNames: readonly string[]): string | null {
  return firstNames.find((n) => n.length >= 2 && hasWord(hay, n.toLowerCase())) ?? null;
}

/**
 * Should these words be offered to the router?
 *
 * @param text        what was typed or dictated into a plain field
 * @param firstNames  the org's staff first names, lowercased or not
 */
export function sniff(text: string, firstNames: readonly string[] = []): Sniff {
  const t = text.trim().toLowerCase();
  /* Below about four words there is nothing to route — "gate code 4417" is
     the canonical case and it must never cost anything. */
  if (t.split(/\s+/).filter(Boolean).length < 4) return NOTHING;

  const reasons: string[] = [];
  let score = 0;

  const person = namedPerson(t, firstNames);
  if (person) {
    reasons.push(`names ${person}`);
    score += 0.4;
  }

  /* WEIGHTED TO CLEAR THE BAR ALONE, and that is a decision rather than a
     tuned number. "Someone needs to chase the supplier" and "Tell Luke to
     order the grilles" carry exactly one signal each — an obligation — and
     both are plainly jobs for somebody. At 0.4 they fell through silently,
     which is the invisible failure this file is most afraid of. A phrase
     from this list IS the ask; nothing else has to corroborate it. */
  const obligation = anyOf(t, OBLIGATION);
  if (obligation) {
    reasons.push(`says "${obligation.trim()}"`);
    score += 0.6;
  }

  const deadline = anyOf(t, DEADLINE);
  if (deadline) {
    reasons.push(`names a time ("${deadline.trim()}")`);
    score += 0.3;
  }

  const fault = anyOf(t, FAULT);
  if (fault) {
    reasons.push(`describes a fault ("${fault.trim()}")`);
    score += 0.35;
  }

  /* A bare imperative counts only where it OPENS a clause — start of the
     text, or straight after a full stop, comma, "and", or "then". Anywhere
     else "check" is far more likely to be describing what was done ("did a
     check on the belts") than asking for it. */
  const opener = IMPERATIVE.find((v) =>
    new RegExp(String.raw`(?:^|[.;,]\s*|\band\s+|\bthen\s+)${v}\b`).test(t)
  );
  if (opener) {
    reasons.push(`opens with "${opener}"`);
    score += 0.3;
  }

  /* ONE SIGNAL IS NOT ENOUGH, with one exception. "The unit tripped again on
     Tuesday" is a fault and a date and clearly worth routing; "check the
     roof" alone is not worth seven seconds. So: two signals, OR a named
     person (who is, on their own, the reason this feature exists). */
  const actionable = score >= 0.6 || Boolean(person && reasons.length >= 1);

  return { actionable, reasons, score: Math.min(1, Math.round(score * 100) / 100) };
}
