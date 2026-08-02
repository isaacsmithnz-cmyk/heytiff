/* Which job did the note mean?

   A note dictated from the board header says a client's name out loud —
   "Luke needs to organise some filters for Kingsford Medical Center" — and
   the review card has to come back with the JOB CARD it thinks that is, job
   number and all, so a person can confirm it rather than hunt for it in a
   dropdown (Isaac, 2026-08-02: "it should also confirm the job number or the
   job card that you are referring to").

   Deliberately NOT the model's job. Understanding is probabilistic and effect
   is deterministic, and that split is the whole trust model — so the matching
   is plain code against the board's own roster, it runs on words a human can
   see, and nothing it decides is acted on until the card is confirmed.

   Matching is by TOKEN, not by whole string, because a transcript is what was
   heard: the note above says "Center" where the agreement says "Centre", and
   an exact-name match would have found nothing. A job number said out loud
   ("job ten forty-two", "1042") outranks everything — it's the one thing on a
   job card that is unambiguous. */

export type JobCandidate = {
  kind: "visit" | "agreement" | "project";
  id: string;
  /** Who the work is for — what a note actually says out loud. */
  clientName: string;
  /** The service or project name. */
  label: string;
  siteLabel?: string | null;
  /** The ServiceM8 job number, where one has been raised. */
  jobNumber?: string | null;
};

export type JobMatch = {
  /** The one candidate to confirm, when exactly one stands out. */
  bestId: string | null;
  /** Everything that matched at all, best first, then the rest untouched. */
  ranked: JobCandidate[];
  /** More than one candidate tied at the top — say so instead of guessing. */
  ambiguous: boolean;
};

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/* Words that identify nobody. "Group", "medical" and "centre" appear across
   half a client list, so matching on them would make every client look like a
   candidate for every note. */
const GENERIC = new Set([
  "the", "and", "pty", "ltd", "limited", "group", "holdings", "services",
  "service", "company", "co", "australia", "australian", "centre", "center",
  "medical", "health", "care", "retail", "data", "logistics", "hospitality",
  "aged", "unit", "units", "site", "sites",
]);

const tokensOf = (name: string): string[] =>
  [...new Set(normalise(name).split(" "))].filter((w) => w.length >= 4 && !GENERIC.has(w));

/** Job numbers as a note would say them: "job 1042", "#1042", or bare digits. */
function numbersIn(transcript: string): Set<string> {
  const out = new Set<string>();
  for (const m of transcript.matchAll(/\d{3,}/g)) out.add(m[0]);
  return out;
}

/** Score one candidate against what was said. Higher is a better match. */
function scoreOf(candidate: JobCandidate, said: string, numbers: Set<string>): number {
  /* A job number is the one identifier on a job card that can't mean two
     things, so hearing it settles the question on its own. */
  if (candidate.jobNumber && numbers.has(candidate.jobNumber.replace(/\D/g, ""))) return 100;

  const client = tokensOf(candidate.clientName);
  if (client.length === 0) return 0;
  let score = client.filter((t) => said.includes(t)).length * 10;
  if (score === 0) return 0;

  /* The service and site only BREAK TIES — two visits for the same client are
     told apart by "the ducted units" or "level 2", never identified by them. */
  score += tokensOf(candidate.label).filter((t) => said.includes(t)).length;
  if (candidate.siteLabel) {
    score += tokensOf(candidate.siteLabel).filter((t) => said.includes(t)).length;
  }
  return score;
}

export function matchJob(transcript: string, candidates: JobCandidate[]): JobMatch {
  const said = ` ${normalise(transcript)} `;
  const numbers = numbersIn(said);

  const scored = candidates.map((c) => ({ c, score: scoreOf(c, said, numbers) }));
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

  if (hits.length === 0) {
    return { bestId: null, ranked: candidates, ambiguous: false };
  }

  const top = hits[0].score;
  const tied = hits.filter((h) => h.score === top);
  const ranked = [
    ...hits.map((h) => h.c),
    ...scored.filter((s) => s.score === 0).map((s) => s.c),
  ];

  /* Tied means we genuinely don't know which of two jobs for the same client
     was meant. Guessing one would be worse than asking — the whole point of
     this card is that a person confirms. */
  return { bestId: tied.length === 1 ? hits[0].c.id : null, ranked, ambiguous: tied.length > 1 };
}

/** How a candidate says who it is, for the line you confirm. */
export function describeJob(c: JobCandidate): string {
  const bits = [`${c.clientName} — ${c.label}`];
  if (c.siteLabel) bits.push(c.siteLabel);
  bits.push(c.jobNumber ? `job #${c.jobNumber}` : jobless(c.kind));
  return bits.join(" · ");
}

const jobless = (kind: JobCandidate["kind"]): string =>
  kind === "agreement" ? "the agreement, no job raised yet" : "no job number yet";
