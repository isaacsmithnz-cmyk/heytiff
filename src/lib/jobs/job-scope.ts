/* A JOB'S SCOPE, AS A WRITTEN BRIEF (Isaac, 28 October 2026: "a common point
   where a quote can get built from"; he picked layout B, the written brief,
   of https://claude.ai/artifact/SJBwjp8GmvKAFYuV6ufryT). Pure: the shape,
   what Tiff is told, and how her answer is read back, so the writer, the
   Overview and the tests read one definition.

   ONE BRIEF A JOB, FROM EVERYTHING ON IT. The writer is handed the job's own
   words and its story, the same merge the Activity feed draws (notes, Tiff's
   reads of its drawings, emails filed on it, files, visits), and nothing
   else, so a sentence in the brief can always be traced to something on the
   job. Each system says the sheets or notes it came from.

   NO MONEY, as the Summary: the brief says what's going in, never what it
   costs. Money-shaped story entries never reach the writer. */

/** One system, area by area: "First floor, front: ducted, a zone per room". */
export type ScopeSystem = {
  area: string;
  kind: string;
  /** A short paragraph: the rooms, where the indoor and outdoor units go,
      the air side, and any catch. */
  text: string;
  /** Where it came from: drawing sheets ("A201"), a note ("Sam, 27 Oct"). */
  from: string[];
};

export type ScopeAdded = { text: string; from: string };
export type ScopeQuestion = { q: string; who: string };
/** What came in lately and what it did to the scope. */
export type ScopeUpdate = { on: string; from: string; said: string };

export type JobScope = {
  lede: string;
  systems: ScopeSystem[];
  added: ScopeAdded[];
  notOurs: string[];
  clarify: ScopeQuestion[];
  updates: ScopeUpdate[];
};

/** The stored brief, as the Overview reads it. */
export type JobScopeRead = JobScope & {
  /** The story stamp it was written at: a newer story asks for a rewrite. */
  stamp: string;
  writtenAt: string;
};

/* Clamped on our side as well as asked of the model: a rule the schema
   can't state is a rule that will eventually be broken. */
const MAX = { lede: 400, text: 700, short: 120, line: 240, systems: 12, added: 12, notOurs: 8, clarify: 12, updates: 4, from: 6 };

/* No nullable fields: an empty string or an empty list says "none"
   (structured outputs take few nullable fields). */
export const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    lede: { type: "string" },
    systems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "string" },
          kind: { type: "string" },
          text: { type: "string" },
          from: { type: "array", items: { type: "string" } },
        },
        required: ["area", "kind", "text", "from"],
        additionalProperties: false,
      },
    },
    added: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, from: { type: "string" } },
        required: ["text", "from"],
        additionalProperties: false,
      },
    },
    notOurs: { type: "array", items: { type: "string" } },
    clarify: {
      type: "array",
      items: {
        type: "object",
        properties: { q: { type: "string" }, who: { type: "string" } },
        required: ["q", "who"],
        additionalProperties: false,
      },
    },
    updates: {
      type: "array",
      items: {
        type: "object",
        properties: { on: { type: "string" }, from: { type: "string" }, said: { type: "string" } },
        required: ["on", "from", "said"],
        additionalProperties: false,
      },
    },
  },
  required: ["lede", "systems", "added", "notOurs", "clarify", "updates"],
  additionalProperties: false,
} as const;

export const SCOPE_SYSTEM_PROMPT =
  "You keep the scope of works for one job at a small Australian air conditioning and " +
  "HVAC company: a short written brief at the top of the job, which everyone on the job " +
  "reads and the quote is built from. You are handed the job's own words and its record, " +
  "newest first: notes from the office and the techs, your own earlier reads of its " +
  "drawings and documents, emails filed on it, files and visits. Plain Australian trade " +
  "English, short sentences.\n\n" +
  "`lede`: one or two sentences: what the job is and where its scope comes from (whose " +
  "drawings or brief, their date, a site visit), and anything missing from them that " +
  "matters, such as no mechanical drawings.\n\n" +
  "`systems`: one per system, area by area, in the order of the building. `area` is where " +
  "(\"Ground floor\", \"First floor, front\", \"Studio\"); `kind` is the system in a few " +
  "words (\"ducted, under the floor\", \"VRV heads\", \"split system\"). `text` is a short " +
  "paragraph of three or four plain sentences: the rooms it serves, where the indoor unit goes, where the outdoor unit goes, " +
  "the air side (grilles, registers, ducts) and any catch worth checking. Name a model only " +
  "when the record names one. `from` is where it came from, each a short label: a drawing " +
  "sheet as the record names it (\"A201\"), or who said it and when (\"Sam, 27 Oct\", " +
  "\"Tandem's email, 8 Oct\").\n\n" +
  "`added`: what was asked for on top of the original brief or drawings (a builder's or " +
  "client's call, a note), each with where it came from. Leave it empty when nothing was.\n\n" +
  "`notOurs`: work the record puts with others (the builder, another trade), each short.\n\n" +
  "`clarify`: questions the record leaves open that change what goes in or what it costs, " +
  "each with `who` can answer it (\"Architect\", \"Builder\", \"Client\"), or \"\" when " +
  "the record doesn't say. Drop a question the record has since answered.\n\n" +
  "`updates`: the newest things on the record that shaped this scope, newest first, at " +
  "most four: `on` is its day as the record gives it (\"Tue 27 Oct\"), `from` who or what " +
  "it came from (\"Sam Lee's note\", \"the builder's email\"), `said` what it did to the " +
  "scope in one sentence.\n\n" +
  "When the record disagrees with itself, the person's later word stands over the drawings, " +
  "and the drawings over an earlier note; say the disagreement in `clarify` unless someone " +
  "has settled it. Never invent a room, a unit, a size or a fact the record doesn't give; " +
  "say less rather than guess. STRICTLY NO MONEY: no prices, quote amounts, invoices or " +
  "payments. Never mention this system or that anything was generated.";

/** What the writer is handed: the job's words, its state, and its story lines. */
export function scopePrompt(read: {
  status: string | null;
  clientName: string | null;
  scope: string | null;
  workDone: string | null;
  lines: readonly string[];
}): string {
  return [
    `Client: ${read.clientName ?? "unknown"}`,
    `Job status: ${read.status ?? "unknown"}`,
    read.scope ? `The job, in the office's own words:\n${read.scope}` : null,
    read.workDone ? `ServiceM8's invoice description, on a quoted job usually the quote's scope:\n${read.workDone}` : null,
    `The job's record, newest first:\n${read.lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The writer's answer (or a stored row's `brief`), clamped; null when it
    holds no scope at all. */
export function scopeOf(raw: unknown): JobScope | null {
  const r = obj(raw);
  const systems = list(r.systems)
    .map((x) => {
      const s = obj(x);
      return {
        area: str(s.area, MAX.short),
        kind: str(s.kind, MAX.short),
        text: str(s.text, MAX.text),
        from: list(s.from).map((f) => str(f, MAX.short)).filter(Boolean).slice(0, MAX.from),
      };
    })
    .filter((s) => s.area || s.kind || s.text)
    .slice(0, MAX.systems);
  const added = list(r.added)
    .map((x) => ({ text: str(obj(x).text, MAX.line), from: str(obj(x).from, MAX.short) }))
    .filter((a) => a.text)
    .slice(0, MAX.added);
  const notOurs = list(r.notOurs).map((x) => str(x, MAX.line)).filter(Boolean).slice(0, MAX.notOurs);
  const clarify = list(r.clarify)
    .map((x) => ({ q: str(obj(x).q, MAX.line), who: str(obj(x).who, MAX.short) }))
    .filter((c) => c.q)
    .slice(0, MAX.clarify);
  const updates = list(r.updates)
    .map((x) => ({ on: str(obj(x).on, MAX.short), from: str(obj(x).from, MAX.short), said: str(obj(x).said, MAX.line) }))
    .filter((u) => u.said)
    .slice(0, MAX.updates);
  const lede = str(r.lede, MAX.lede);
  if (!lede && systems.length === 0 && added.length === 0) return null;
  return { lede, systems, added, notOurs, clarify, updates };
}

/** Whose jobs get a brief: one being quoted or worked. A finished or lost
    job keeps the brief it has and is never written for. */
export const scopeWanted = (status: string | null | undefined): boolean => {
  const s = (status ?? "").trim().toLowerCase();
  return s === "quote" || s === "work order";
};
