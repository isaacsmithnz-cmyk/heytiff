import { companyKey } from "@/lib/integrations/match";
import { streetOf } from "@/lib/address/street";

/* THE JOB THE WORDS NAME — pure, on both sides of the wire.

   Bug 77 (Isaac, 23 November 2026: "Didn't pick job"): "remind me to send the
   warranty call for the job at 12 Sample Road" made a task on no job, though
   two jobs sat at that address. Bugs 87 and 88 (24 November 2026: "didnt find
   job or builder", "it also did not try and link it to a job"): "Ben from
   Sampleco Building rang about his last job in Exampleton" filed nothing on a
   job and offered Ben as a new contact, though the builder and the job were
   both on the books.

   The router says what the words name (`job_named`: a client or builder, an
   address or a suburb, a job number, whether they said the last one), and
   plain code finds it among the business's ServiceM8 jobs, FINISHED ONES
   INCLUDED: a warranty call, a callback or a builder's variation is about a
   job that is done. The model never picks the job; it only says what was
   said, and this file decides what that names:

     one job, or every job at one site     that one, the most recent
     several sites, "the last one" said    the most recent
     several sites otherwise               asked, "Which job is this for?"
     none                                  said, with what she looked for */

export type JobNamed = {
  /** The client or builder as said: "Sampleco Building". */
  client: string;
  /** An address or a suburb as said: "12 Sample Road", "Exampleton". */
  place: string;
  /** A job number as said: "3239A". */
  number: string;
  /** They said the last, latest or most recent one. */
  latest: boolean;
};

/** A ServiceM8 job the words may name, as the finder reads it. */
export type NamedJob = {
  uuid: string;
  number: string | null;
  address: string | null;
  /** Who the job is for: its company, or the client a site belongs to. */
  client: string | null;
  status: string | null;
  /** The job's date, "YYYY-MM-DD ...", for "the most recent". */
  date: string | null;
};

/** What the finder found, and whether the client named was found at all. */
export type JobsFound = {
  jobs: NamedJob[];
  /** The client the words named is none of the business's clients. */
  noClient: boolean;
};

export type JobPick =
  | { kind: "one"; job: NamedJob }
  | { kind: "several"; jobs: NamedJob[] }
  | { kind: "none" };

const text = (v: unknown, max = 120): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** A job number as ServiceM8 writes it: "#3239a" and "job 3239A" are "3239A". */
export function jobNumberOf(said: string): string {
  const m = said.toUpperCase().match(/(?:^|[^0-9A-Z])(\d{2,6}[A-Z]?)(?![0-9A-Z])/);
  return m ? m[1]! : "";
}

/** The router's `job_named`, re-read: null when it names nothing. */
export function jobNamedOf(raw: unknown): JobNamed | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const named = { client: text(r.client), place: text(r.place), number: jobNumberOf(text(r.number)), latest: r.latest === true };
  return named.client || named.place || named.number ? named : null;
}

/** A name squashed to its letters and digits, its legal ending gone. */
export const squashName = (name: string | null | undefined): string => companyKey(name).replace(/[^a-z0-9]/g, "");

/** How many single letters turn one word into the other. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** How well a company's name answers the client said: 3 the same name, 2 a
    letter or two out (a name heard, "Tee-con" for "Tecon"), 0 not it. Never
    a word in common alone: "Building" is half the builders in the book. */
export function clientScore(said: string, company: string | null): number {
  const a = squashName(said);
  const b = squashName(company);
  if (a.length < 3 || !b) return 0;
  if (a === b) return 3;
  const allowed = a.length >= 12 ? 2 : a.length >= 5 ? 1 : 0;
  return allowed && Math.abs(a.length - b.length) <= allowed && editDistance(a, b) <= allowed ? 2 : 0;
}

/** The words a database looks for a client by: each word of three letters
    or more, and a hyphenated one squashed too ("T-Con" is "tcon" and "con"). */
export function clientWords(said: string): string[] {
  const out = new Set<string>();
  for (const w of said.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)) {
    const squashed = w.replace(/-/g, "");
    if (squashed.length >= 3) out.add(squashed);
    for (const part of w.split("-")) if (part.length >= 3) out.add(part);
  }
  return [...out].slice(0, 6);
}

/** Where a job is, as one place: two jobs at one street are one site. */
export function siteKey(address: string | null): string {
  const s = streetOf(address);
  if (s) return `${s.unit}/${s.number} ${s.name}`;
  return (address ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const newestFirst = (a: NamedJob, b: NamedJob) =>
  (b.date ?? "").localeCompare(a.date ?? "") || (b.number ?? "").localeCompare(a.number ?? "");

/** At most this many jobs are offered as answers to "Which job is this for?". */
export const JOBS_OFFERED = 3;

/** Which job the words name, of those found (see the file's head). A quote
    that went nowhere counts only when nothing else does. */
export function pickNamedJob(found: readonly NamedJob[], named: JobNamed): JobPick {
  const won = found.filter((j) => j.status !== "Unsuccessful");
  const jobs = [...(won.length ? won : found)].sort(newestFirst);
  if (jobs.length === 0) return { kind: "none" };
  if (named.number) {
    const same = jobs.filter((j) => (j.number ?? "").toUpperCase() === named.number);
    if (same.length === 1) return { kind: "one", job: same[0]! };
  }
  const sites = new Map<string, NamedJob>();
  for (const j of jobs) if (!sites.has(siteKey(j.address))) sites.set(siteKey(j.address), j);
  if (sites.size === 1 || named.latest) return { kind: "one", job: jobs[0]! };
  return { kind: "several", jobs: [...sites.values()].slice(0, JOBS_OFFERED) };
}

/** An address on one line: "12 Sample Road, Exampleton NSW 2000". */
const oneLine = (address: string | null) =>
  (address ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(", ");

/** How a job is said, as an answer and in her line: "#3239A, Sampleco, 12 Sample Road, Exampleton NSW 2000". */
export function namedJobLabel(j: NamedJob): string {
  return [j.number ? `#${j.number}` : "ServiceM8 job", j.client, oneLine(j.address)].filter(Boolean).join(", ");
}

/** Her line when she found it: "On job #3239A, Sampleco, 12 Sample Road." */
export const foundJobLine = (j: NamedJob): string => `On job ${namedJobLabel(j)}.`;

/** Her line when she found nothing: what she looked for, as said. */
export function notFoundLine(named: JobNamed, noClient: boolean): string {
  if (noClient && named.client) return `I couldn't find ${named.client} among your clients.`;
  const whose = named.client ? `${named.client}'s jobs` : named.number ? `job ${named.number}` : "jobs";
  return `I looked for ${whose}${named.place ? ` at ${named.place}` : ""} and found none.`;
}
