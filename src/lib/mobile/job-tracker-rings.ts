import { fmtHours, trackerLabour, trackerMaterials, type TrackerLook, type TrackerRead } from "@/lib/jobs/job-tracker";
import { fmtAud } from "@/lib/workboard/project-money";

/* THE JOB TRACKER'S THREE RINGS, AS THE PHONE DRAWS THEM (Isaac, 17
   November 2026: "Yes, all of it", and "just put it in the money, and that
   way it's gated"). The web's Job tracker (lib/jobs/job-tracker) worked out
   here, so the phone draws them without its maths: each ring's tone, its
   parts (the shares of the circle, used, overtime's extra paid hours, and
   past the quote), the short figure in its middle, and the word under its
   name. Pure. */

export type PhoneRing = {
  tone: TrackerLook["tone"];
  /** the word under the ring's name: "28 of 32 h", "$180 over", "As quoted" */
  word: string;
  /** shares of the circle, in order from the top, each 0 to 1 */
  parts: TrackerLook["parts"];
  /** the short figure in the ring: "88%", "$6.8k", or "—" */
  centre: string;
  /** what a screen reader says for the ring */
  label: string;
  /** overtime, or materials without a price; null when nothing */
  under: string | null;
};

export type PhoneTracker = { labour: PhoneRing; materials: PhoneRing; equipment: PhoneRing };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Whole dollars, as a word under a ring says them: "$180". */
const dollars = (cents: number) => fmtAud(Math.round(cents / 100) * 100);

/** Dollars short enough for the middle of a ring: "$420", "$6.8k", "$1.2m". */
export function shortDollars(cents: number): string {
  const d = Math.round(cents / 100);
  const one = (n: number) => String(Math.round(n * 10) / 10);
  if (Math.abs(d) < 1000) return `$${d}`;
  if (Math.abs(d) < 999_500) return Math.abs(d) < 99_950 ? `$${one(d / 1000)}k` : `$${Math.round(d / 1000)}k`;
  return `$${one(d / 1_000_000)}m`;
}

const pct = (used: number, of: number | null) => (of !== null && of > 0 ? `${Math.round((used / of) * 100)}%` : "—");

export function phoneTracker(read: TrackerRead): PhoneTracker {
  /* LABOUR: the web's look; the word, the hours worked of the quote's while
     it holds, else the web's own ("4 h over", "Hours not quoted") */
  const l = read.labour;
  const lab = trackerLabour(l);
  const q = l.quotedHours;
  const labour: PhoneRing = {
    tone: lab.tone,
    word: lab.tone === "good" && q !== null ? `${r2(l.workedHours)} of ${fmtHours(q)}` : lab.word,
    parts: lab.parts,
    centre: pct(l.workedHours, q),
    label: lab.label,
    under: lab.under,
  };

  /* MATERIALS: the web's look, its dollars whole for a phone's third */
  const m = read.materials;
  const mat = trackerMaterials(m);
  const a = m.spent !== null ? m.allowance : null;
  const s = m.spent ?? 0;
  const matWord = a !== null && a > 0 && m.spent !== null ? (s > a ? `${dollars(s - a)} over` : `${dollars(a - s)} left`) : mat.word;
  const materials: PhoneRing = { tone: mat.tone, word: matWord, parts: mat.parts, centre: pct(s, a), label: mat.label, under: mat.under };

  /* EQUIPMENT: the quote's units, drawn whole, as quoted */
  const units = read.equipment.items.length;
  const equipment: PhoneRing =
    units > 0
      ? {
          tone: "info",
          word: "As quoted",
          parts: [{ kind: "used", share: 1 }],
          centre: read.equipment.total !== null ? shortDollars(read.equipment.total) : String(units),
          label: `Equipment: ${units} on the quote, as quoted`,
          under: null,
        }
      : { tone: "info", word: "No units on the quote", parts: [], centre: "—", label: "Equipment: no units on the quote", under: null };

  return { labour, materials, equipment };
}
