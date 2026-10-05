/* WHAT THE BUSINESS TYPICALLY TAKES, FROM ITS OWN JOBS (Isaac, 2026-10-04:
   "it should only show when enough jobs have run through for it to say
   (you typically use 24hrs labour for this type of work)"; 2026-10-05: the
   memory is built "Only in the review section" — the post-job review — and
   shows from 3 reviewed jobs of a kind).

   Every reviewed job is a sample of its kind of work. A typical is made only
   from MIN_JOBS of the same kind or more, and it is the middle of them —
   never a rule of thumb, never another business's numbers, never read off
   old briefs. Pure; the reviews are read by the server. */

export type WorkKind = "maintenance" | "service" | "split" | "multi" | "ducted" | "vrf";

/** A kind of work, as "Typical ___ jobs" says it. */
export const WORK_KIND_WORDS: Record<WorkKind, string> = {
  maintenance: "maintenance",
  service: "service",
  split: "wall split",
  multi: "multi-split",
  ducted: "ducted",
  vrf: "VRF",
};

/** Below this many of its own reviewed jobs, the business has no "typical". */
export const MIN_JOBS = 3;

/** The kind of work a job is, from its category and its words. Null when
    it can't be told — and then it is nobody's sample. */
export function workKindOf(text: string | null | undefined, category: string | null | undefined): WorkKind | null {
  const t = (text ?? "").toLowerCase();
  const cat = (category ?? "").trim().toLowerCase();
  if (cat.includes("maintenance") || /\bmaintenance\b/.test(t)) return "maintenance";
  if (/\b(vrf|vrv|pumy|puhy|city\s*multi)\b/.test(t)) return "vrf";
  if (/\bducted\b|\bbulkhead\b/.test(t)) return "ducted";
  if (/\bmulti\b/.test(t)) return "multi";
  if (/\bhigh\s*wall\b|\bwall\s*split\b|\bsplit system\b/.test(t)) return "split";
  if (cat.includes("service")) return "service";
  return null;
}

/** A reviewed job: its kind of work and the person-hours it took. */
export type LabourSample = { job: string; kind: WorkKind; personHours: number };

export type TypicalLabour = { kind: WorkKind; hours: number; jobs: number; words: string };

/** The middle of the business's own jobs of this kind, once there are
    enough of them; null until then. */
export function typicalLabour(samples: readonly LabourSample[], kind: WorkKind): TypicalLabour | null {
  const hours = samples.filter((s) => s.kind === kind).map((s) => s.personHours).sort((a, b) => a - b);
  if (hours.length < MIN_JOBS) return null;
  const mid = hours.length % 2 ? hours[(hours.length - 1) / 2]! : (hours[hours.length / 2 - 1]! + hours[hours.length / 2]!) / 2;
  const rounded = Math.round(mid * 2) / 2;
  return {
    kind,
    hours: rounded,
    jobs: hours.length,
    words: `Typical ${WORK_KIND_WORDS[kind]} jobs: ${rounded} hrs, from ${hours.length} reviewed jobs.`,
  };
}
