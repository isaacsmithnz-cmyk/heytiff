/* A PROPOSAL DRAFT — the house layout of a Diamond Air ServiceM8 Proposal,
   as data.

   WHY DATA AND NOT PROSE. Read side by side (jobs 2749, 3266, 2872, 2587 and
   3343, 2026-09-29), the Proposals already share one structure: a title, an
   Intro, one block per option or area in dash bullets, a pricing block with
   one "As Per Quote" line per option, and the standard Notes. What drifted
   was everything a person typed fresh each time: the title ("AC Options",
   "AC Quote – …", "Air Conditioning Scope – …"), "Intro" or "Info", pros and
   cons on one job and not the next. So the writer fills FIELDS and this file
   draws the words around them. The title is built here from the address;
   the option headings are numbered here; the extra notes are a fixed
   library the writer picks from by key and never words itself. What the
   writer gets to say is the intro, the bullets, the pros and cons, and the
   questions it still has.

   THE STANDARD NOTES ARE NOT IN HERE. They live in the ServiceM8 Proposal
   template the office starts from, word for word the same on every job. A
   draft carries only the notes a job needs BEYOND them.

   Everything a model hands back passes through `normaliseDraft` before it is
   stored or shown: the schema says the shapes, and the clamps say how many
   and how long, because a rule the schema can't state is a rule that will
   eventually be broken. The same gate takes a person's own edits. */

export type PricingMode = "multiple_choice" | "optional";

export type ProposalOption = {
  /** The option's own short name, without "Option 1:" — "Replace with a
      7 kW Daikin ducted system", "Downstairs". Numbered where it is drawn. */
  name: string;
  /** The scope, one fact per bullet, in the house voice. */
  lines: string[];
  pros: string[];
  cons: string[];
};

/** The extra notes a job can need beyond the template's standard ones. The
    writer picks keys; the words are these, always. */
export const EXTRA_NOTES = {
  client_supplied: {
    heading: "Client-supplied equipment",
    lines: [
      "The unit's manufacturer warranty is between you and your supplier.",
      "Our installation workmanship warranty still applies.",
      "Time spent finding a fault with supplied equipment is charged.",
    ],
  },
  roof_access: {
    heading: "Roof access",
    lines: [
      "Roof tiles are lifted to reach the work and relaid when it is done.",
      "Tiles that are already cracked or brittle may break when lifted, and replacing them is extra.",
    ],
  },
  strata: {
    heading: "Strata approval",
    lines: [
      "Strata or building management approval is needed before we start.",
      "We can supply the specifications they ask for.",
    ],
  },
  existing_removal: {
    heading: "Existing system",
    lines: ["The old system is removed, its refrigerant recovered, and it is disposed of."],
  },
  pipe_reuse: {
    heading: "Existing pipework",
    lines: [
      "Existing pipes are reused where they pass a pressure test.",
      "If they fail, replacing them is extra.",
    ],
  },
} as const satisfies Record<string, { heading: string; lines: readonly string[] }>;

export type ExtraNoteKey = keyof typeof EXTRA_NOTES;
export const EXTRA_NOTE_KEYS = Object.keys(EXTRA_NOTES) as ExtraNoteKey[];

export type ProposalDraft = {
  intro: string;
  options: ProposalOption[];
  pricingMode: PricingMode;
  notes: ExtraNoteKey[];
  /** What the writer still needs to know before this can go out. */
  questions: string[];
};

/* ── the clamps ── */

export const MAX_OPTIONS = 4;
export const MAX_LINES = 14;
export const MAX_PROS = 4;
export const MAX_QUESTIONS = 6;
export const MAX_INTRO_CHARS = 900;
export const MAX_NAME_CHARS = 80;
export const MAX_LINE_CHARS = 240;

const clean = (s: unknown, max: number): string =>
  typeof s === "string" ? s.replace(/\s+\n/g, "\n").trim().slice(0, max) : "";

/** A bullet as typed or returned: a leading dash, asterisk or bullet is the
    list's own mark, not the words'. */
const cleanLine = (s: unknown): string =>
  clean(s, MAX_LINE_CHARS + 4)
    .replace(/^[-*•–]\s*/, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_LINE_CHARS);

const lineList = (raw: unknown, max: number): string[] =>
  (Array.isArray(raw) ? raw : []).map(cleanLine).filter(Boolean).slice(0, max);

/** "Option 2: Replace" handed back as a name would be numbered twice. */
const cleanName = (s: unknown): string =>
  clean(s, MAX_NAME_CHARS + 12)
    .replace(/^option\s*\d+\s*[:.–-]\s*/i, "")
    .replace(/[:.]\s*$/, "")
    .slice(0, MAX_NAME_CHARS);

/** The one gate between a model (or a person's edit) and the table. Null
    when nothing usable is left — a draft with no option is not a draft. */
export function normaliseDraft(raw: unknown): ProposalDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const options = (Array.isArray(r.options) ? r.options : [])
    .map((o): ProposalOption | null => {
      if (!o || typeof o !== "object") return null;
      const x = o as Record<string, unknown>;
      const name = cleanName(x.name);
      const lines = lineList(x.lines, MAX_LINES);
      if (!name && lines.length === 0) return null;
      return {
        name: name || "Scope",
        lines,
        pros: lineList(x.pros, MAX_PROS),
        cons: lineList(x.cons, MAX_PROS),
      };
    })
    .filter((o): o is ProposalOption => o !== null)
    .slice(0, MAX_OPTIONS);
  if (options.length === 0) return null;

  const mode = r.pricingMode ?? r.pricing_mode;
  const notes = (Array.isArray(r.notes) ? r.notes : []).filter(
    (k, i, all): k is ExtraNoteKey =>
      typeof k === "string" && (EXTRA_NOTE_KEYS as string[]).includes(k) && all.indexOf(k) === i
  );

  return {
    intro: clean(r.intro, MAX_INTRO_CHARS),
    options,
    pricingMode: mode === "optional" ? "optional" : "multiple_choice",
    notes,
    questions: lineList(r.questions, MAX_QUESTIONS),
  };
}

/* ── the words drawn around the fields ── */

/** "Air Conditioning Scope – 37 Taleeban Rd, Riverview". The address as the
    job holds it, on one line, without the state and postcode: the client's
    block beside it on the page already carries those. */
export function proposalTitle(address: string | null | undefined): string {
  const one = (address ?? "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\s+\d{4}\s*$/i, "")
    .replace(/,\s*$/, "");
  return one ? `Air Conditioning Scope – ${one}` : "Air Conditioning Scope";
}

/** An option's heading as it stands in the Proposal: numbered when the
    client picks one, the area's own name when they tick the ones they want
    (2872's Downstairs and Upstairs). */
export function optionHeading(draft: ProposalDraft, index: number): string {
  const name = draft.options[index]?.name ?? "";
  return draft.pricingMode === "multiple_choice" ? `Option ${index + 1}: ${name}` : name;
}

const bullets = (lines: readonly string[]) => lines.map((l) => `- ${l}`).join("\n");

/** An option's body, the way the Proposals set it: dash bullets, then Pros
    and Cons each under its own word when there are any. */
export function optionText(option: ProposalOption): string {
  const parts = [bullets(option.lines)];
  if (option.pros.length) parts.push(`Pros:\n${bullets(option.pros)}`);
  if (option.cons.length) parts.push(`Cons:\n${bullets(option.cons)}`);
  return parts.filter(Boolean).join("\n\n");
}

/** One line per option for the pricing block: the item name ServiceM8's
    "As Per Quote" line carries. */
export function pricingLines(draft: ProposalDraft): string[] {
  return draft.options.map((_, i) => optionHeading(draft, i));
}

export function notesText(keys: readonly ExtraNoteKey[]): string {
  return keys
    .map((k) => `${EXTRA_NOTES[k].heading}:\n${bullets(EXTRA_NOTES[k].lines)}`)
    .join("\n\n");
}

/** The whole draft as text, block by block, for pasting in one go. */
export function draftText(draft: ProposalDraft, title: string): string {
  const parts = [title, `Intro:\n${draft.intro}`];
  draft.options.forEach((o, i) => parts.push(`${optionHeading(draft, i)}\n${optionText(o)}`));
  parts.push(`Pricing:\n${pricingLines(draft).join("\n")}`);
  if (draft.notes.length) parts.push(`Notes:\n${notesText(draft.notes)}`);
  return parts.join("\n\n");
}
