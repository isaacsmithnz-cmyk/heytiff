/* The note router — server only.

   A note is not a notepad entry. Someone says "tell Luke he needs to order
   the grilles for Smith St, and the middle rooftop unit tripped again on
   Tuesday", and three different things should happen: a task assigned to
   Luke, an issue-log entry against that unit, and nothing else invented.
   This module turns the sentence into a PROPOSAL of those things.

   THREE LANES, ONE CALL:
     ACTION  tasks · bring-items · board flags
     DATA    progress bullets · commissioning entries · recurring-issue log
             · plain_note, because a note is allowed to just be a note
     ASK     clarify, when intent or assignee is genuinely ambiguous —
             the model asks rather than guessing

   NOTHING HERE APPLIES ANYTHING. It returns a proposal; a human confirms it
   on the review card, and only the confirm action writes. That separation is
   the whole safety model: a misheard word costs a dismissed card, never a
   task assigned to the wrong person.

   TWO LAYERS OF VALIDATION, ON PURPOSE. `output_config.format` guarantees
   the SHAPE — valid JSON matching the schema, no parsing roulette. It cannot
   guarantee the SEMANTICS: that "Luke" is a real person in this org, that a
   severity is one we render, that an unresolvable name becomes a question
   instead of a guess. `shapeProposal` does that, and it is pure so the rules
   are tested without a network call. */

import Anthropic from "@anthropic-ai/sdk";
import { isEffort, type Effort } from "@/lib/dev-overrides";

/* Opus 5: the routing decision is the whole product. A cheaper model that
   mis-assigns "tell Luke" to the wrong Luke, or reads an urgent flag as a
   bullet point, costs more in trust than the tokens save. Thinking is ON by
   default on this model and shares the max_tokens budget with the response,
   which is why the budget is generous for such a small output. */
const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/* `high` is both the API default and the shipped setting. It is also, on the
   2026-08-04 measurements, about 89% of the wait between someone stopping
   talking and the review card appearing — the transport this file's caller
   spent a PR optimising is the other 11%.

   That does not make `high` wrong. It makes it the one setting worth
   MEASURING rather than assuming, which is what the caller's `effort`
   argument is for: same five sentences at each level, and a comparison of
   whether the assignees and due dates actually change. Until that runs, this
   stays where it is. */
const DEFAULT_EFFORT: Effort = "high";

/* ── what a proposal is ───────────────────────────────────────────────── */

export const SEVERITIES = ["info", "warn", "urgent"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** The house guard convention (cf. `isProjectStage`, `isReadinessKey`): the
    list and the test that narrows to it live together, so adding a severity is
    one edit rather than three. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isSeverity = (v: unknown): v is Severity =>
  (SEVERITIES as readonly unknown[]).includes(v);

export type ProposedTask = {
  title: string;
  detail: string;
  /** Resolved staff_profile id, or null when nobody could be matched. */
  assigneeId: string | null;
  /** What the note actually said — shown on the card when unresolved. */
  assigneeHint: string;
  dueHint: string;
  /** The day the hint resolves to, as an ISO date, or "" when the note named
      no day it could pin down. Isaac, 2026-08-02: told that "Dane's supposed
      to pick them up tomorrow", the card should have tomorrow's date in the
      box. This used to say "the person confirming picks the real date" and
      left it empty — which is a fine principle for "before the next visit"
      and a silly one for "tomorrow". Still shown in an editable date field:
      the model proposes, the person confirming sees it and can change it. */
  dueDate: string;
};

export type ProposedFlag = { message: string; severity: Severity };
export type ProposedEntry = { body: string; equipmentHint: string };

export type NoteProposal = {
  tasks: ProposedTask[];
  bringItems: string[];
  flags: ProposedFlag[];
  progressBullets: string[];
  commissioningEntries: ProposedEntry[];
  issueEntries: ProposedEntry[];
  plainNote: string;
  /** Set when the note can't be routed without a human answering something. */
  clarify: { question: string; options: string[] } | null;
};

export type NoteStaff = { id: string; fullName: string };

export type NoteContext = {
  /** People this note could name. First names are how they'll be referred to. */
  staff: NoteStaff[];
  /** "Smith St — ducted change-over", so the model can ground a reference. */
  targetLabel?: string;
  /** Equipment already known at this site, for grounding "the middle one". */
  equipment?: string[];
  /** The day the note was dictated, so "Tuesday" resolves to a real date. */
  todayISO: string;
};

export type NoteBrainResult =
  | { ok: true; proposal: NoteProposal }
  | { ok: false; error: string };

/* ── the schema the API is constrained to ─────────────────────────────── */

/* Structured outputs forbid recursion and length/numeric constraints, and
   require additionalProperties:false plus every property listed in
   `required`. So absence is expressed as an empty string or empty array
   rather than an optional field — one less shape to defend against. */
const str = { type: "string" } as const;
const strArray = { type: "array", items: { type: "string" } } as const;

const NOTE_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str,
          detail: str,
          assignee_hint: str,
          due_hint: str,
          due_date: str,
        },
        required: ["title", "detail", "assignee_hint", "due_hint", "due_date"],
        additionalProperties: false,
      },
    },
    bring_items: strArray,
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          message: str,
          severity: { type: "string", enum: [...SEVERITIES] },
        },
        required: ["message", "severity"],
        additionalProperties: false,
      },
    },
    progress_bullets: strArray,
    commissioning_entries: {
      type: "array",
      items: {
        type: "object",
        properties: { body: str, equipment_hint: str },
        required: ["body", "equipment_hint"],
        additionalProperties: false,
      },
    },
    issue_entries: {
      type: "array",
      items: {
        type: "object",
        properties: { summary: str, equipment_hint: str },
        required: ["summary", "equipment_hint"],
        additionalProperties: false,
      },
    },
    plain_note: str,
    clarify_needed: { type: "boolean" },
    clarify_question: str,
    clarify_options: strArray,
  },
  required: [
    "tasks",
    "bring_items",
    "flags",
    "progress_bullets",
    "commissioning_entries",
    "issue_entries",
    "plain_note",
    "clarify_needed",
    "clarify_question",
    "clarify_options",
  ],
  additionalProperties: false,
} as const;

/* ── the instruction ──────────────────────────────────────────────────── */

function systemPrompt(ctx: NoteContext): string {
  const names = ctx.staff.map((s) => s.fullName).join(", ") || "nobody on record";
  return [
    "You route a tradesperson's site note into structured outcomes for an",
    "Australian HVAC business. The note was spoken aloud or typed quickly, so",
    "expect fragments, trade slang and transcription slips.",
    "",
    "Route each part of the note into exactly one place:",
    "- tasks: someone must DO something later. 'Tell Luke to order the",
    "  grilles' is a task for Luke, not a note. Put the job's own details in",
    "  `detail` so the task stands alone when read next week.",
    "- bring_items: something to physically bring next visit.",
    "- flags: a problem that should be visible on the board until handled.",
    "  urgent = someone is blocked or it is unsafe; warn = needs attention;",
    "  info = worth seeing.",
    "- progress_bullets: what was done or found today. Statements of fact.",
    "- commissioning_entries: readings and settings — pressures, superheat,",
    "  airflow, charge. Anything a commissioning sheet would record.",
    "- issue_entries: a fault, especially a repeat one. Say what happened.",
    "- plain_note: anything that is genuinely just a remark. A note is",
    "  allowed to be a note — do not manufacture tasks to seem useful.",
    "",
    "One note can produce several of these at once. Produce nothing for the",
    "parts of the note that do not call for it: empty arrays are correct.",
    "",
    `People who can be assigned work: ${names}.`,
    "Put the name exactly as the note said it in `assignee_hint` — do not",
    "correct it to someone on the list. The application resolves names, and",
    "an unresolvable name becomes a question to the author.",
    "",
    "Set clarify_needed only when you genuinely cannot route the note without",
    "an answer — an ambiguous person, an unclear target, or a sentence that",
    "could be a task or a remark. Ask ONE short question and offer the",
    "concrete options. When clarify_needed is true, still fill in whatever",
    "you are confident about; do not blank the rest.",
    "",
    `Today is ${ctx.todayISO}. Resolve relative days against it.`,
    "Write `due_hint` in the note's own plain words ('tomorrow', 'before the",
    "next visit') AND, when those words name a day you can actually work out,",
    "put it in `due_date` as YYYY-MM-DD. 'Tomorrow', 'Monday' and '3 August'",
    "all resolve; 'before the next visit' and 'when the part lands' do not —",
    "leave `due_date` empty for those rather than inventing a day. The person",
    "confirming sees the date and can change it.",
    ctx.targetLabel ? `\nThis note is about: ${ctx.targetLabel}.` : "",
    ctx.equipment?.length ? `Equipment on site: ${ctx.equipment.join(", ")}.` : "",
  ].join("\n");
}

/* ── name resolution (pure) ───────────────────────────────────────────── */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type AssigneeMatch =
  | { kind: "none" }
  | { kind: "one"; id: string }
  | { kind: "ambiguous"; names: string[] };

/** Match what the note said against the people who can be assigned work.

    First names are how a site note refers to people ("tell Luke"), so a
    first-name match counts — but ONLY when it is unique. Two Lukes is the
    case that matters: guessing picks a person at random and assigns real
    work to them, so it returns `ambiguous` and the caller turns that into a
    question instead. */
export function resolveAssignee(hint: string, staff: readonly NoteStaff[]): AssigneeMatch {
  const h = norm(hint);
  if (!h) return { kind: "none" };

  const full = staff.filter((s) => norm(s.fullName) === h);
  if (full.length === 1) return { kind: "one", id: full[0].id };
  if (full.length > 1) return { kind: "ambiguous", names: full.map((s) => s.fullName) };

  const first = staff.filter((s) => norm(s.fullName).split(" ")[0] === h);
  if (first.length === 1) return { kind: "one", id: first[0].id };
  if (first.length > 1) return { kind: "ambiguous", names: first.map((s) => s.fullName) };

  return { kind: "none" };
}

/* ── shaping (pure) ───────────────────────────────────────────────────── */

const TITLE_MAX = 200;
const BODY_MAX = 1000;

/** Trim to a length, and treat anything that isn't a string as absent. Both
    ends of this feature need it — the shaper on the model's output, the action
    on the browser's — and it must behave identically on both, so it is one
    exported function rather than two identical private ones. */
export const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const cleanList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean) : [];

/** Model output → a proposal the app will act on.

    Everything is re-derived from a whitelist rather than trusted: severities
    that aren't ours become `warn`, empty titles drop the task entirely, and
    an ambiguous assignee is escalated into a clarify question even when the
    model didn't ask one — because assigning work to the wrong person is the
    failure this feature must not have. */
export function shapeProposal(raw: unknown, ctx: NoteContext): NoteProposal {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let clarify: NoteProposal["clarify"] =
    r.clarify_needed === true && clean(r.clarify_question, TITLE_MAX)
      ? {
          question: clean(r.clarify_question, TITLE_MAX),
          options: cleanList(r.clarify_options, TITLE_MAX),
        }
      : null;

  const tasks: ProposedTask[] = [];
  for (const t of Array.isArray(r.tasks) ? r.tasks : []) {
    const row = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const title = clean(row.title, TITLE_MAX);
    if (!title) continue; // a task with no title is not a task

    const assigneeHint = clean(row.assignee_hint, TITLE_MAX);
    const match = resolveAssignee(assigneeHint, ctx.staff);

    // Two people answer to that name — ask rather than pick one.
    if (match.kind === "ambiguous" && !clarify) {
      clarify = {
        question: `Which ${assigneeHint} did you mean?`,
        options: match.names,
      };
    }

    tasks.push({
      title,
      detail: clean(row.detail, BODY_MAX),
      assigneeId: match.kind === "one" ? match.id : null,
      assigneeHint,
      dueHint: clean(row.due_hint, TITLE_MAX),
      /* Validated, not trusted: the model is asked for an ISO date and a
         malformed one becomes no date rather than a bad one. */
      dueDate: ISO_DATE.test(String(row.due_date ?? "")) ? String(row.due_date) : "",
    });
  }

  const flags: ProposedFlag[] = [];
  for (const f of Array.isArray(r.flags) ? r.flags : []) {
    const row = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
    const message = clean(row.message, TITLE_MAX);
    if (!message) continue;
    const sev = row.severity;
    flags.push({
      message,
      // Unknown severity degrades to `warn`: visible, but never escalated to
      // urgent by a value we don't recognise.
      severity: isSeverity(sev) ? sev : "warn",
    });
  }

  const entries = (key: "commissioning_entries" | "issue_entries", body: "body" | "summary") => {
    const out: ProposedEntry[] = [];
    for (const e of Array.isArray(r[key]) ? (r[key] as unknown[]) : []) {
      const row = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
      const text = clean(row[body], BODY_MAX);
      if (!text) continue;
      out.push({ body: text, equipmentHint: clean(row.equipment_hint, TITLE_MAX) });
    }
    return out;
  };

  return {
    tasks,
    bringItems: cleanList(r.bring_items, TITLE_MAX),
    flags,
    progressBullets: cleanList(r.progress_bullets, BODY_MAX),
    commissioningEntries: entries("commissioning_entries", "body"),
    issueEntries: entries("issue_entries", "summary"),
    plainNote: clean(r.plain_note, BODY_MAX),
    clarify,
  };
}

/** True when the model found nothing to do with the note — the caller keeps
    the transcript as a plain note rather than showing an empty review card. */
export function isEmptyProposal(p: NoteProposal): boolean {
  return (
    p.tasks.length === 0 &&
    p.bringItems.length === 0 &&
    p.flags.length === 0 &&
    p.progressBullets.length === 0 &&
    p.commissioningEntries.length === 0 &&
    p.issueEntries.length === 0 &&
    !p.clarify
  );
}

/* ── the call ─────────────────────────────────────────────────────────── */

const NO_KEY = "Note routing isn't switched on yet — the note was saved as written.";
const FAILED = "That note couldn't be read just now — it was saved as written.";

/* The same four-branch ladder as fleet-ai.ts and expense-ai.ts, worded for
   notes. The APIError branch matters: without it every 4xx and 5xx that isn't
   auth or rate-limit lands on the generic sentence, which is the one that
   tells you least. */
function reasonFor(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return NO_KEY;
  if (err instanceof Anthropic.RateLimitError) return "Too busy right now — the note was saved as written.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the note reader — it was saved as written.";
  if (err instanceof Anthropic.APIError) return "The note reader errored — it was saved as written.";
  return FAILED;
}

/** Read one note. `answer` carries the author's reply to a previous clarify
    question, so the second pass routes with the ambiguity resolved.

    Never throws, and every failure keeps the note: the transcript is already
    the valuable thing, and routing is an enhancement on top of it. */
export async function readNote(
  transcript: string,
  ctx: NoteContext,
  answer?: { question: string; answer: string },
  /* A measuring override, re-checked here rather than trusted: it reaches
     this function from a browser, and an effort level is a cost lever. An
     unrecognised value is the default, never an error — nobody's note should
     fail because a query string was mistyped. */
  effort?: unknown
): Promise<NoteBrainResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: NO_KEY };
  const text = transcript.trim();
  if (!text) return { ok: false, error: "There was nothing in that note." };

  const client = new Anthropic();
  const content = answer
    ? `Note:\n${text}\n\nYou asked: ${answer.question}\nThey answered: ${answer.answer}\n\nRoute the note using that answer. Do not ask again.`
    : `Note:\n${text}`;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Stated because it is a real cost/quality lever here and a future
      // reader should see it was chosen, not inherited.
      output_config: {
        effort: isEffort(effort) ? effort : DEFAULT_EFFORT,
        format: { type: "json_schema", schema: NOTE_SCHEMA },
      },
      system: systemPrompt(ctx),
      messages: [{ role: "user", content }],
    });

    /* A refusal is a content outcome, not an error: check it before reading
       content, which is empty or partial in that case. For this feature the
       right answer is simply to keep the note as written. */
    if (response.stop_reason === "refusal") return { ok: false, error: FAILED };

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, error: FAILED };

    return { ok: true, proposal: shapeProposal(JSON.parse(block.text), ctx) };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}
