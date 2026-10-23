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

export type TypicalLabour = { kind: WorkKind; hours: number; jobs: number; words: string };

