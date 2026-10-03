import { labourFromBrief } from "./brief-labour";

/* WHAT THE BUSINESS TYPICALLY TAKES, FROM ITS OWN JOBS (Isaac, 2026-10-04:
   "it should only show when enough jobs have run through for it to say
   (you typically use 24hrs labour for this type of work)… recommendation
   comes from orgs own history").

   Every past job whose brief states its labour is a sample of its kind of
   work. A suggestion is made only from MIN_JOBS of the same kind or more,
   and it is the middle of them — never a rule of thumb, never another
   business's numbers. Pure; the server reads the jobs. */

export type WorkKind = "maintenance" | "service" | "split" | "multi" | "ducted" | "vrf";

export const WORK_KIND_WORDS: Record<WorkKind, string> = {
  maintenance: "maintenance",
  service: "a service call",
  split: "a wall split",
  multi: "a multi-split",
  ducted: "a ducted system",
  vrf: "a VRF system",
};

/** Below this many of its own jobs, the business has no "typical". */
export const MIN_JOBS = 5;

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

export type LabourSample = { job: string; kind: WorkKind; personHours: number };

/** A past job as a sample, when its brief states its labour in hours —
    or in days and the business has set its working day — and its kind can
    be told. */
export function sampleOf(job: string, text: string | null, category: string | null, dayHours: number | null): LabourSample | null {
  const kind = workKindOf(text, category);
  const labour = labourFromBrief(text, dayHours);
  if (!kind || !labour || labour.personHours == null || labour.personHours <= 0) return null;
  return { job, kind, personHours: labour.personHours };
}

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
    words: `You typically use ${rounded} hrs labour for ${WORK_KIND_WORDS[kind]} (${hours.length} of your jobs).`,
  };
}

export type LabourAdvice =
  | { from: "brief"; labour: NonNullable<ReturnType<typeof labourFromBrief>> }
  | { from: "history"; typical: TypicalLabour }
  | { from: "none" };

/** Where a quote's labour comes from: the brief, then the business's own
    history, else nowhere — and then the quote says labour isn't set. */
export function labourAdvice(
  brief: string | null,
  kind: WorkKind | null,
  samples: readonly LabourSample[],
  dayHours: number | null
): LabourAdvice {
  const labour = labourFromBrief(brief, dayHours);
  if (labour) return { from: "brief", labour };
  const typical = kind ? typicalLabour(samples, kind) : null;
  if (typical) return { from: "history", typical };
  return { from: "none" };
}
