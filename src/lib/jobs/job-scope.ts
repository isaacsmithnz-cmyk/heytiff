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
   costs. Money-shaped story entries never reach the writer, and neither does
   a priced line of the quote's scope.

   KEPT UP TO DATE (slice 2). A new note on the job moves `scopeStamp`, and
   Tiff is handed the brief as it stands and changes only what the note
   changes. A booking, a visit, a photo or a payment doesn't move it: none of
   them says what's going in.

   TOLD BY THE QUOTE, AND TELLING IT (slice 3). What a person says on the quote
   and the proposal's words reach the brief, with their money taken out, and
   go in the system they belong to: the quote has them already. What a note
   adds while the quote has lines goes on the quote's rail, until it's priced
   or left out.

   AFTER IT'S SENT (slice 4). Once ServiceM8 has sent the quote (its quote
   sent stamp: every quote goes out from ServiceM8) or the job is accepted,
   the brief is the scope as quoted, and what's waiting on the quote is Since
   the quote: on the Overview and the rail alike, Update quote takes it into
   the next version, or a variation once it's accepted, and Tiff prices the
   difference. */

import type { StoryEntry } from "@/lib/workboard/job-story";

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
/** What someone took out with Undo: Tiff leaves it out until the record asks again. */
export type ScopeSetAside = { on: string; said: string };

export type JobScope = {
  lede: string;
  systems: ScopeSystem[];
  added: ScopeAdded[];
  notOurs: string[];
  clarify: ScopeQuestion[];
  updates: ScopeUpdate[];
  /** What taking the newest change back would do, in the past tense: the
      line Undo leaves, written with the change so Undo needs no read. */
  undoSaid: string;
};

/** The stored brief, as the Overview reads it. */
export type JobScopeRead = JobScope & {
  /** The story stamp it was written at: a newer story asks for a rewrite. */
  stamp: string;
  writtenAt: string;
  /** There is an earlier brief to go back to. */
  canUndo: boolean;
  /** What a note added since the quote was priced, for the quote's rail. */
  sincePriced?: ScopeAdded[];
  /** Something's been said on the quote that the brief hasn't read yet. */
  quoteDue?: boolean;
  /** ServiceM8 sent the quote: the day, and which version went. */
  quoted?: ScopeQuoted | null;
  /** The job is past Quote in ServiceM8. */
  accepted?: boolean;
};

export type ScopeQuoted = { on: string; version: number };

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
    undoSaid: { type: "string" },
  },
  required: ["lede", "systems", "added", "notOurs", "clarify", "updates", "undoSaid"],
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
  "matters, such as no mechanical drawings. On a small service job, say the fault as it was " +
  "reported and stop: never list what a small job hasn't got.\n\n" +
  "`systems`: one per system, area by area, in the order of the building. `area` is where " +
  "(\"Ground floor\", \"First floor, front\", \"Studio\"); `kind` is the system in a few " +
  "words (\"ducted, under the floor\", \"VRV heads\", \"split system\"). `text` is a short " +
  "paragraph of three or four plain sentences: the rooms it serves, where the indoor unit goes, where the outdoor unit goes, " +
  "the air side (grilles, registers, ducts) and any catch worth checking. Name a model only " +
  "when the record names one. `from` is where it came from, each a short label: a drawing " +
  "sheet as the record names it (\"A201\"), or who said it and when (\"Sam, 27 Oct\", " +
  "\"Tandem's email, 8 Oct\").\n\n" +
  "`added`: what was asked for on top of the original brief or drawings (a builder's or " +
  "client's call, a note), each with where it came from. An option in our own quote isn't " +
  "added: say it in the system it belongs to. Leave it empty when nothing was.\n\n" +
  "`notOurs`: work the record puts with others (the builder, another trade), each short.\n\n" +
  "`clarify`: questions the record leaves open that change what goes in or what it costs, " +
  "each with `who` can answer it (\"Architect\", \"Builder\", \"Client\"), or \"\" when " +
  "the record doesn't say. Drop a question the record has since answered. Ask only about " +
  "what goes in: never about a booking's time or who's attending.\n\n" +
  "`updates`: the newest things on the record that changed what's going in, newest first, at " +
  "most four: `on` is its day as the record gives it (\"Tue 27 Oct\"), `from` who or what " +
  "it came from (\"Sam Lee's note\", \"the builder's email\"), `said` what it did to the " +
  "scope in one sentence. A booking, a visit or a photo is not an update.\n\n" +
  "When you're handed the brief as it stands, start from it: change only what the newer " +
  "record changes and keep every other sentence word for word. Keep its `updates` and add " +
  "one at the top saying exactly what changed. If nothing changes what's going in, hand it " +
  "back as it is. `undoSaid` is one short past-tense sentence for taking that newest change " +
  "back (\"Took out the cover and the exhaust fans.\"), or \"\" when you weren't handed a " +
  "brief. What's listed as taken out, someone took out of this scope: leave it out unless " +
  "a record entry dated after it asks for it again.\n\n" +
  "When the record disagrees with itself, the person's later word stands over the drawings, " +
  "and the drawings over an earlier note; say the disagreement in `clarify` unless someone " +
  "has settled it. Never invent a room, a unit, a size or a fact the record doesn't give; " +
  "say less rather than guess. STRICTLY NO MONEY: no prices, quote amounts, invoices or " +
  "payments. Never mention this system or that anything was generated.\n\n" +
  "What was said on the quote and the proposal's words are the person's word too. Put what " +
  "they settle in the system it belongs to, with `from` as \"The quote's conversation, 30 Oct\", " +
  "and answer any `clarify` they answer. Never put them in `added`: the quote already has them.";

/** What the writer is handed: the job's words, its state, and its story lines. */
export function scopePrompt(read: {
  status: string | null;
  clientName: string | null;
  scope: string | null;
  workDone: string | null;
  lines: readonly string[];
  /** The brief as it stands, for Tiff to change only what moved. */
  previous?: JobScope | null;
  setAside?: readonly ScopeSetAside[];
  /** What people said on the quote, each with its day, and the proposal's words. */
  quote?: { said: readonly string[]; proposal: string } | null;
}): string {
  /* a sent quote's scope carries its total: the writer never sees a priced line */
  const workDone = read.workDone?.split("\n").filter((l) => !/\$\s?\d/.test(l)).join("\n") || null;
  const was = read.previous;
  const previous = was && { lede: was.lede, systems: was.systems, added: was.added, notOurs: was.notOurs, clarify: was.clarify, updates: was.updates };
  return [
    `Client: ${read.clientName ?? "unknown"}`,
    `Job status: ${read.status ?? "unknown"}`,
    read.scope ? `The job, in the office's own words:\n${read.scope}` : null,
    workDone ? `ServiceM8's invoice description, on a quoted job usually the quote's scope:\n${workDone}` : null,
    previous ? `The brief as it stands:\n${JSON.stringify(previous)}` : null,
    read.setAside?.length ? `Taken out of this scope:\n${read.setAside.map((s) => `${s.on}: ${s.said}`).join("\n")}` : null,
    read.quote?.said.length ? `Said on the quote, oldest first:\n${read.quote.said.join("\n")}` : null,
    read.quote?.proposal ? `The proposal's words:\n${read.quote.proposal}` : null,
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
  return { lede, systems, added, notOurs, clarify, updates, undoSaid: str(r.undoSaid, MAX.line) };
}

/** Whether a rewrite changed what's going in. Its words on the change itself
    don't count: a brief handed back as it was is no change, and leaves
    nothing to undo. */
export function scopeMoved(a: JobScope, b: JobScope): boolean {
  const body = ({ lede, systems, added, notOurs, clarify }: JobScope) => JSON.stringify({ lede, systems, added, notOurs, clarify });
  return body(a) !== body(b);
}

const sameWords = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/** What a rewrite added that the brief didn't have. Her words are kept word
    for word from one rewrite to the next, so the words are its identity. */
export function newlyAdded(was: JobScope, now: JobScope): ScopeAdded[] {
  const had = new Set(was.added.map((a) => sameWords(a.text)));
  return now.added.filter((a) => !had.has(sameWords(a.text)));
}

/** Of what's waiting on the quote, what the brief still has, once each: an
    Undo takes a thing off both. */
export function stillAdded(waiting: readonly ScopeAdded[], scope: JobScope): ScopeAdded[] {
  const has = new Set(scope.added.map((a) => sameWords(a.text)));
  const seen = new Set<string>();
  return waiting.filter((a) => {
    const k = sameWords(a.text);
    if (!has.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Off the quote's rail: priced, or left out. It stays in the brief. */
export const withoutAdded = (waiting: readonly ScopeAdded[], taken: readonly string[]): ScopeAdded[] => {
  const off = new Set(taken.map(sameWords));
  return waiting.filter((a) => !off.has(sameWords(a.text)));
};

/** Gone to the client: what lands now is Since the quote, for the next
    version or a variation, not a price to change. */
export const pastQuote = (s: Pick<JobScopeRead, "quoted" | "accepted">): boolean => !!s.quoted || !!s.accepted;

/** Which version ServiceM8 sent: one more than the versions kept before it
    went. Each kept version is the quote as it stood before the next. */
export const sentVersion = (sentMs: number, keptAt: readonly string[]): number =>
  1 + keptAt.filter((at) => Date.parse(at) < sentMs).length;

/** The line under Scope as quoted. */
export const quotedLine = (q: ScopeQuoted): string => `${q.version > 1 ? `Version ${q.version} sent` : "Sent"} from ServiceM8, ${q.on}`;

/** What's changing, for Update quote, in the brief's words with where each came from. */
export const changingWords = (items: readonly ScopeAdded[]): string => items.map((a) => a.text.replace(/[.\s]+$/, "") + (a.from ? ` (${a.from})` : "")).join("; ") + (items.length ? "." : "");

/** What Price them says to Tiff, in the person's name. */
export const priceThemWords = (items: readonly ScopeAdded[]) => `Price what's been added: ${items.map((a) => a.text).join("; ")}.`;

/** A person's words on a quote without its money: a line that names a price
    never reaches the brief's writer ("350 ex", "$85 for the trunking"). */
export const wordsWithoutMoney = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/\$\s?\d|\b\d[\d,.]*\s*(ex|inc|plus gst|\+\s?gst)\b/i.test(l))
    .join("\n")
    .trim();

/** The proposal's words for the brief's writer: no money is kept in them. */
export function proposalWords(p: { title: string; intro: string; options: readonly { summary: string; areas: readonly { name: string; items: readonly string[] }[]; included: readonly string[] }[]; notIncluded: readonly string[] }): string {
  const options = p.options.map((o, i) => [`Option ${i + 1}: ${o.summary}`, ...o.areas.map((a) => `${a.name}: ${a.items.join("; ")}`), o.included.length ? `Included: ${o.included.join("; ")}` : ""].filter(Boolean).join("\n"));
  return wordsWithoutMoney([p.title, p.intro, ...options, p.notIncluded.length ? `Not included: ${p.notIncluded.join("; ")}` : ""].filter(Boolean).join("\n"));
}

/** The brief as Tiff reads it when she quotes: the job's written scope, as a
    source of Read the job. */
export function scopeWords(s: JobScope): string {
  return [
    s.lede,
    ...s.systems.map((x) => `${[x.area, x.kind].filter(Boolean).join(": ")}. ${x.text}`),
    s.added.length ? `Added:\n${s.added.map((a) => `- ${a.text}`).join("\n")}` : "",
    s.notOurs.length ? `Not ours:\n${s.notOurs.map((n) => `- ${n}`).join("\n")}` : "",
    s.clarify.length ? `To clarify:\n${s.clarify.map((c) => `- ${c.q}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What a rewrite is due on: the job's notes (emails filed and calls land as
    notes), not the whole story. A job with no note yet still gets its first
    brief; its first note moves this. Null only when the job has no story. */
export function scopeStamp(entries: readonly StoryEntry[]): string | null {
  if (entries.length === 0) return null;
  const notes = entries.filter((e) => e.kind === "note" && !e.removed);
  if (notes.length === 0) return "no-notes";
  const newest = notes[0];
  return [newest.day, newest.at ?? "", newest.key, String(notes.length)].join("|");
}

/** The first day a job can get a brief (Isaac, 1 November 2026: "any jobs
    created in the last month. Anything before that, don't worry about").
    A fixed day, not a rolling month, so no job loses its brief by ageing. */
export const SCOPE_JOBS_FROM = "2026-10-01";

/** Whose jobs get a brief: one created since SCOPE_JOBS_FROM and being quoted
    or worked. A finished or lost job keeps the brief it has and is never
    written for. */
export const scopeWanted = (status: string | null | undefined, createdOn: string | null | undefined): boolean => {
  const s = (status ?? "").trim().toLowerCase();
  return (s === "quote" || s === "work order") && (createdOn ?? "").slice(0, 10) >= SCOPE_JOBS_FROM;
};
