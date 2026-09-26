/* Which job did the note mean?

   A note says a client's name out loud — "Luke needs to organise some
   filters for Kingsford Medical Center" — and when it lands on no job, Tiff
   asks "Which job is this for?" with the JOB CARDS the words named as the
   answers, job number and all, so a person taps the right one rather than
   hunting for it (Isaac, 2026-08-02: "it should also confirm the job number
   or the job card that you are referring to").

   Deliberately NOT the model's job. Understanding is probabilistic and effect
   is deterministic, and that split is the whole trust model — so the matching
   is plain code against the workspace's own open jobs, it runs on words a
   human can see, and nothing it decides is acted on until a person taps it.

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

/* Searching the roster is a different job from MATCHING it. Matching reads a
   whole spoken sentence and has to ignore the noise in it; searching reads
   what someone is deliberately typing to find a job, so it takes them
   literally — every word must appear somewhere on the card, generic or not.
   "medical centre" is a perfectly good thing to type and a useless thing to
   infer. */
export function searchJobs(query: string, candidates: JobCandidate[]): JobCandidate[] {
  const words = normalise(query).split(" ").filter(Boolean);
  if (words.length === 0) return candidates;
  return candidates.filter((c) => {
    const hay = normalise(
      [c.clientName, c.label, c.siteLabel ?? "", c.jobNumber ?? ""].join(" ")
    );
    return words.every((w) => hay.includes(w));
  });
}

/** Only the candidates the words actually matched, best first — the quick
    answers under Tiff's "Which job is this for?". Never the rest of the
    roster when nothing matched: an answer the note never pointed at is a
    guess wearing a button. Two jobs tied at the top are both offered, since
    guessing between them would be worse than asking. */
export function matchedJobs(transcript: string, candidates: JobCandidate[], limit = 3): JobCandidate[] {
  const said = ` ${normalise(transcript)} `;
  const numbers = numbersIn(said);
  return candidates
    .map((c) => ({ c, score: scoreOf(c, said, numbers) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.c);
}

/** How a candidate says who it is, for the line you confirm. */
export function describeJob(c: JobCandidate): string {
  const bits = [`${c.clientName} — ${c.label}`];
  if (c.siteLabel) bits.push(c.siteLabel);
  bits.push(c.jobNumber ? `job #${c.jobNumber}` : jobless(c.kind));
  return bits.join(", ");
}

const jobless = (kind: JobCandidate["kind"]): string =>
  kind === "agreement" ? "the agreement, no job raised yet" : "no job number yet";
