/* READ THE JOB (slice 4.5, mock-up screen 1) — what Tiff is given to
   start from: the job's description, ServiceM8's quote when it has one, and
   every note on the job, each whole (not the 8 newest cut at 600
   characters, as the old builder reads them). Each is a source the person
   can untick before she reads; nothing is judged for them here, because a
   rule that guesses which note is about the work is the kind of rule that
   missed the ones that were.

   The brief is the ticked sources, oldest note first, each marked with what
   it is, when and who. A whole job's notes are bounded: past the budget the
   oldest notes give way, and the person is told how many. Pure. */

export type JobSource = {
  id: string;
  kind: "description" | "sm8_quote" | "note";
  /** what it is, as the list shows it: "Note, 6 Oct, Luke" */
  label: string;
  text: string;
  at: string | null;
};

/** The brief's budget, characters: a long job's notes, not a novel. */
export const BRIEF_BUDGET = 40_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-06 09:12:00" → "6 Oct 2026"; whatever else, as it came. */
export function dayOf(at: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(at ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

const squash = (t: string) => t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
const same = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

export function jobSources(input: {
  description: string | null;
  sm8Quote: string | null;
  notes: readonly { id: string; text: string; at: string | null; by: string | null }[];
}): { sources: JobSource[]; left: number } {
  const out: JobSource[] = [];
  const description = squash(input.description ?? "");
  if (description) out.push({ id: "description", kind: "description", label: "The job's description", text: description, at: null });
  const quote = squash(input.sm8Quote ?? "");
  if (quote) out.push({ id: "sm8_quote", kind: "sm8_quote", label: "ServiceM8's quote", text: quote, at: null });

  /* every note, oldest first, once: a HeyTiff note sent to ServiceM8 is
     both, word for word */
  const seen = new Set<string>([same(description)]);
  const notes = [...input.notes]
    .filter((n) => n.text.trim())
    .sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? -1 : (a.at ?? "") > (b.at ?? "") ? 1 : 0))
    .filter((n) => {
      const k = same(n.text);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  /* the newest kept within the budget; the oldest give way */
  let room = BRIEF_BUDGET - out.reduce((n, s) => n + s.text.length, 0);
  const kept: typeof notes = [];
  for (let i = notes.length - 1; i >= 0; i--) {
    const t = squash(notes[i]!.text);
    if (t.length > room) break;
    room -= t.length;
    kept.unshift(notes[i]!);
  }
  for (const n of kept) {
    const day = dayOf(n.at);
    out.push({ id: `note:${n.id}`, kind: "note", label: ["Note", day, n.by].filter(Boolean).join(", "), text: squash(n.text), at: n.at });
  }
  return { sources: out, left: notes.length - kept.length };
}

/** The brief from the sources left ticked, each marked with what it is. */
export function briefOf(sources: readonly JobSource[], ticked: ReadonlySet<string>): string {
  return sources
    .filter((s) => ticked.has(s.id))
    .map((s) => `[${s.label}]\n${s.text}`)
    .join("\n\n");
}
