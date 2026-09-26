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

   THE TIFF MODAL FILES WITHOUT A CARD (Isaac, 2026-09-25), so for its notes
   the safety model moves: the proposal is still only a proposal here, but
   `fileNote` files it the moment nothing is left to ask, and Undo is the net.
   Which is why, for those notes (`askWho`), a task with nobody on it becomes
   a question here rather than waiting for a dropdown the modal doesn't have,
   and why only those notes (`speak`) are asked for a line Tiff says back. The
   review card's notes are read with the prompt, schema and words they always
   were: nothing the modal needs reaches them unless its caller turns it on.

   TWO LAYERS OF VALIDATION, ON PURPOSE. `output_config.format` guarantees
   the SHAPE — valid JSON matching the schema, no parsing roulette. It cannot
   guarantee the SEMANTICS: that "Luke" is a real person in this org, that a
   severity is one we render, that an unresolvable name becomes a question
   instead of a guess. `shapeProposal` does that, and it is pure so the rules
   are tested without a network call. */

import Anthropic from "@anthropic-ai/sdk";
import { HHMM, isRemindKind, type RemindKind } from "@/lib/dashboard/reminders";
import { RECORD_IN_ENGLISH, RECORD_LANGUAGE } from "@/lib/lang/policy";
import { englishProposal } from "./note-english";
import { planRows, type PlanRow } from "./note-draft";
import type { EarlierTurn, TiffRoom, Turn } from "./note-turns";

/* Opus 5: the routing decision is the whole product. A cheaper model that
   mis-assigns "tell Luke" to the wrong Luke, or reads an urgent flag as a
   bullet point, costs more in trust than the tokens save. Thinking is ON by
   default on this model and shares the max_tokens budget with the response,
   which is why the budget is generous for such a small output. Exported for
   the reader of ServiceM8 asks (./mention-brain), which is the same router
   reading the same kind of words. */
export const MODEL = "claude-opus-5";
const MAX_TOKENS = 16_000;

/* MEASURED, NOT ASSUMED. At `high` — the API default, and what this shipped
   with — routing took 6.0–9.0 s on production while the transcript it works
   from took 0.86 s. Nine seconds to sort two sentences into a task and a
   flag is most of a ten-second wait, and Isaac has now reported it twice.

   `medium` because Anthropic's own guidance for this model is to start at
   `high` and SWEEP DOWN: low and medium are unusually strong on Opus 5,
   giving strong quality "at a fraction of the tokens and latency". This is
   the second rung, not the bottom.

   The file's original argument still stands and is why this isn't `low`:
   the routing decision IS the product, and a mis-assigned "tell Luke" costs
   more trust than the tokens save. What changed is that `high` stopped
   being free. Watch the review card — if assignees or dates start coming
   back wrong, this is the line to move back. */
const DEFAULT_EFFORT = "medium" as const;

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
  /** The time of day to be nudged at, "HH:MM" on the workspace's clock, or ""
      when the note asked for no particular time.

      THIS IS WHAT MAKES A REMINDER A REMINDER. "Remind me to do that on Monday
      morning" used to arrive here as a Monday and nothing else — `dueDate` is a
      day, and the word "morning" had nowhere to go. A task with a day and a
      time is a reminder; a task with only a day is an ordinary task, as it has
      always been. */
  remindTime: string;
  /** How to read `remindTime`: be doing it THEN, or be finished BY then.

      "Get the crane truck back in the yard by four" and "service the Hilux at
      half seven" are the same shape of sentence and the opposite instruction,
      and until this field existed both arrived as a moment with no way to
      tell them apart. Only meaningful alongside a `remindTime`; `at` when
      there is none, which is what every reminder written before this meant. */
  remindKind: RemindKind;
};

export type ProposedFlag = { message: string; severity: Severity };
export type ProposedEntry = { body: string; equipmentHint: string };
/** A LEARN row — technique worth teaching the whole org, offered for the
    knowledge base. Title is what the library card will say; body is the
    method itself, written to be read by someone who wasn't there. */
export type ProposedKbEntry = { title: string; body: string };

export type NoteProposal = {
  tasks: ProposedTask[];
  bringItems: string[];
  flags: ProposedFlag[];
  progressBullets: string[];
  commissioningEntries: ProposedEntry[];
  issueEntries: ProposedEntry[];
  /** The fourth lane (Isaac, 2026-08-06): reusable know-how, published to
      the KB on tick — never automatically. "Got the E6 clear by powering
      the outdoor board separately" is a kb_entry; "cleared the E6" is not. */
  kbEntries: ProposedKbEntry[];
  plainNote: string;
  /** What Tiff tells the person, in one or two short sentences, in the
      language they spoke (the Tiff modal, 2026-09-25). The ONE field that is
      not a record: nobody else reads it, so it is not written in English, and
      `englishProposal` leaves it alone. It says what she will file and ends
      with the question when `clarify` is set. It never says anything is done
      — nothing is, until `fileNote` runs and says "Done." itself. "" when the
      model said nothing, on every note the review card routes (it is only
      asked for when `speak` is on), and on every proposal stored before the
      field. */
  say: string;
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
  /** What the org already knows about this job — the router's MEMORY
      (2026-08-06, the brain tool layer). Before this, the model met every
      note as a stranger: "tripped again" carried no again, and a repeat
      issue came back worded slightly differently so the occurrence counter
      never bumped. Fetched by the caller through lib/brain/tools. */
  history?: {
    issues: { summary: string; occurrences: number; lastSeen: string }[];
    flags: string[];
    recentNotes: string[];
  };
  /** The day the note was dictated, so "Tuesday" resolves to a real date. */
  todayISO: string;
  /** WHO IS SPEAKING. The router met every note anonymously, so "remind me"
      resolved to nobody, the task came back unassigned, and the card refused to
      save the one task a person is most certain about — their own. The author
      is not merely another name in `staff`: `me` has to beat every name in the
      workspace, and only this field knows which one it is. */
  author?: NoteStaff;
  /** The author's normal working day on the workspace's clock ("06:30",
      "15:00"), so vague times land where their day actually starts and ends
      rather than on somebody's idea of morning. Their own hours where they
      keep them, the workspace's otherwise. */
  dayStart?: string;
  dayEnd?: string;
  /** Where the words were said, when the Tiff modal or an entry box sent
      them: a hint about what a bare instruction most likely is. */
  room?: TiffRoom;
  /** ASK WHO rather than leave a task with nobody on it. The Tiff modal has
      no assign dropdown — it asks — so for its notes a task nobody can be
      matched to becomes a question, the way two Lukes already do. The old
      review card has the dropdown, and its notes are routed exactly as
      before: this is off unless the caller turns it on. */
  askWho?: boolean;
  /** TIFF SPEAKS BACK. The Tiff modal shows her own line above the plan, so
      for its notes the router is told about `say` (`sayBlock`) and held to a
      schema that has it (`TIFF_NOTE_SCHEMA`). The old review card shows no
      line, and a prompt that asks for one changes what it routes: with it,
      the card asked questions it never used to and asked them in the
      speaker's language (a real-notes check, 2026-09-26). So its notes are
      read with the prompt and schema they always were: this is off unless
      the caller turns it on. */
  speak?: boolean;
  /** THE CONVERSATION BEFORE THIS NOTE, when the Tiff modal sends a new note
      after Tiff has already answered or filed something: context to read the
      note by ("and the same for Smith St"), never more to file. Shaped and
      capped by `earlierTurns` before it gets here. */
  earlier?: readonly EarlierTurn[];
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

/** Exported for the test that reads it: every lane the model is allowed to
    fill must reach the proposal, or what it put there reaches nobody. */
export const NOTE_SCHEMA = {
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
          remind_time: str,
          remind_kind: { type: "string", enum: ["at", "by"] },
        },
        required: [
          "title",
          "detail",
          "assignee_hint",
          "due_hint",
          "due_date",
          "remind_time",
          "remind_kind",
        ],
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
    kb_entries: {
      type: "array",
      items: {
        type: "object",
        properties: { title: str, body: str },
        required: ["title", "body"],
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
    "kb_entries",
    "plain_note",
    "clarify_needed",
    "clarify_question",
    "clarify_options",
  ],
  additionalProperties: false,
} as const;

/* The Tiff modal's schema is the review card's with `say` in it, after the
   lanes and ahead of the question, and every property still required. */
const { clarify_needed, clarify_question, clarify_options, ...LANES } = NOTE_SCHEMA.properties;
const TIFF_PROPERTIES = { ...LANES, say: str, clarify_needed, clarify_question, clarify_options };

/** The schema a note is read with when Tiff speaks back (`speak`): the
    review card's, plus the one field she says. Only the modal's notes are
    held to it; `NOTE_SCHEMA` is the card's, as it always was. */
export const TIFF_NOTE_SCHEMA = {
  ...NOTE_SCHEMA,
  properties: TIFF_PROPERTIES,
  required: Object.keys(TIFF_PROPERTIES) as (keyof typeof TIFF_PROPERTIES)[],
};

/* ── the instruction ──────────────────────────────────────────────────── */

/** The "what's already known" block — pure and exported so the tests can pin
    its exact wording without a network call.

    THE ISSUE WORDING RULE IS THE LOAD-BEARING PART. applyNote dedupes issues
    by EXACT summary match (`in("summary", ...)`) — a repeat worded "RTU-2
    tripping again" against a recorded "Middle rooftop unit tripping" makes a
    second row, and two rows is exactly how a pattern stops being visible.
    Telling the model the recorded wording, and to reuse it verbatim for
    repeats, is what makes the occurrence counter actually count. */
export function historyBlock(ctx: NoteContext): string {
  const h = ctx.history;
  const lines: string[] = [];

  if (h?.issues.length) {
    lines.push("Issues already on record for this job:");
    for (const i of h.issues.slice(0, 10)) {
      lines.push(
        `- "${i.summary}" — ${i.occurrences} ${i.occurrences === 1 ? "time" : "times"}, last ${i.lastSeen}`
      );
    }
    lines.push(
      "If the note describes one of these happening again, write the",
      "issue_entry summary EXACTLY as recorded above — matching wording is",
      "how the log counts a repeat instead of splitting it in two."
    );
  }
  if (h?.flags.length) {
    lines.push(
      "",
      `Flags already active on the board: ${h.flags.slice(0, 8).map((f) => `"${f}"`).join(", ")}.`,
      "Do not raise a flag that repeats one of these."
    );
  }
  if (h?.recentNotes.length) {
    lines.push("", "Recent notes on this job, newest first:");
    for (const n of h.recentNotes.slice(0, 5)) lines.push(`- ${n}`);
  }

  return lines.length ? `\nWhat the workspace already knows:\n${lines.join("\n")}` : "";
}

/** WHEN, AND WHO "ME" IS.

    Exported and kept apart from the prompt for the reason `historyBlock` is:
    the day a note was dictated and the person who dictated it are facts about
    the workspace, not about the ask. There were two prompts once, the site
    note's and the Debrief's, and a copy of this in each drifted within two
    edits; the Debrief's went on 2026-09-25, and this stays one function.

    THE VAGUE-TIME TABLE IS THE POINT. "Monday morning" is the ordinary way to
    say when, and a model left to guess renders it as 9am — an hour and a half
    after an installer's day has already started. The workspace already knows
    when this person starts and finishes, so morning means their morning. */
export function whenBlock(ctx: NoteContext): string {
  const start = ctx.dayStart || "07:00";
  const end = ctx.dayEnd || "15:00";
  return [
    `Today is ${ctx.todayISO}. Resolve relative days against it.`,
    "Write `due_hint` in the note's own plain words, in English ('tomorrow',",
    "'before the next visit'), AND when those words name a day you can work out,",
    "put it in `due_date` as YYYY-MM-DD. 'Tomorrow', 'Monday' and '3 August'",
    "all resolve; 'before the next visit' and 'when the part lands' do not —",
    "leave `due_date` empty for those rather than inventing a day. The person",
    "confirming sees the date and can change it.",
    "",
    "`remind_time` is the time of day to nudge them at, as 24-hour HH:MM on a",
    `working day that runs ${start} to ${end}. Set it when the note asks to be`,
    "reminded, or names a time of day:",
    `  first thing, early, start of the day, ${'"'}morning${'"'} -> ${start}`,
    "  midday, lunch, lunchtime -> 12:00",
    "  afternoon, this arvo, after lunch -> 13:00",
    `  end of the day, before knock-off, close of play -> ${end}`,
    "  tonight, this evening, after work -> 18:00",
    "  a time said outright ('half seven', '2pm') -> that time",
    "When the note asks to be reminded but names no time at all, use",
    `${start} — they asked for a nudge, so a day with no time is a nudge that`,
    "never comes. When the note is not asking to be reminded, leave",
    "`remind_time` empty: an ordinary task has a due date and no alarm.",
    "",
    "`remind_kind` says how to READ that time, and the two are opposites:",
    "  'at' -> be doing it then. A booking, a call, an appointment, and the",
    "     plain nudge someone asked for. 'service at half seven', 'ring him",
    "     at two', 'remind me Monday morning'.",
    "  'by' -> be FINISHED by then. A deadline, a cut-off, a handback.",
    "     'crane truck back in the yard by four', 'off site before three',",
    "     'needs to be done by close of play', 'no later than midday'.",
    "The words to watch are by, before, no later than, until, deadline, and",
    "anything naming a moment the work must already be OVER. If the note just",
    "names when to do the thing, or asks for a nudge, it is 'at'. Use 'at'",
    "when you are unsure: a deadline drawn as an appointment is late advice,",
    "and an appointment drawn as a deadline is a false alarm, but the second",
    "is the one that teaches people to ignore the rail.",
  ].join("\n");
}

/** WHO CAN BE GIVEN WORK, and who is doing the giving.

    Its own function for the same reason as `whenBlock`. The author line
    is the fix for the note that started this: "remind me to check with Luke"
    produced a perfectly good task with nobody on it, because the router had
    never been told that a "me" was in the room. */
export function whoBlock(ctx: NoteContext): string {
  const names = ctx.staff.map((s) => s.fullName).join(", ") || "nobody on record";
  return [
    `People who can be assigned work: ${names}.`,
    "Put the name exactly as the note said it in `assignee_hint` — do not",
    "correct it to someone on the list. The application resolves names, and",
    "an unresolvable name becomes a question to the author.",
    ctx.author
      ? [
          `The person speaking is ${ctx.author.fullName}. When the note gives a`,
          "job to themselves — 'remind me', 'I need to', 'I'll', 'chase it up",
          "myself' — put `me` in `assignee_hint` rather than their name, and",
          "leave it in whatever language they said it. A task somebody set for",
          "themselves is still a task and still needs a person on it.",
        ].join("\n")
      : "",
    /* Only for the modal's notes: see `askWho`. The shaper asks anyway when
       the model does not, so this line is what lets the model ask in the
       person's own words rather than leave it to the app's. */
    ctx.askWho
      ? [
          "Every task is filed the moment nothing is left to ask, so a task with",
          "nobody on it cannot wait for a dropdown. When the note gives a task to",
          "nobody and nothing in it says who, set clarify_needed and ask who",
          "should do it, offering `Me` and the people the note names. When it",
          "gives a task to a name that is none of the people above, set",
          "clarify_needed and ask who they meant, offering `Me` and the people",
          "above whose names are closest.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** WHAT TIFF SAYS BACK. The modal shows the person Tiff's own line above the
    plan, and this is the only instruction about it.

    THE ONE EXCEPTION TO RECORDING IN ENGLISH, and written out rather than
    borrowed: the reply-in-kind rule the answering prompts carry is a whole
    prompt's posture, and this prompt's posture is the opposite (a test in
    lang/policy pins that it never carries both). One field, read once, by the
    person who said the note, is answered in their language; everything else
    stays a record.

    THE QUESTION IS A RECORD TOO, and the block says so in as many words. A
    German note once came back with its `clarify_question` and options in
    German (2026-09-26): told that one field follows the speaker, the model
    let the question follow it as well, and `checkEnglish` passed it. The
    question is stored on the note and its options are answers read back
    against the plan, so they stay in the record language; `say` carries the
    question to the person in theirs. Only in the modal's prompt (`speak`). */
export function sayBlock(): string {
  return [
    "`say` is the one field that is NOT a record: it is what you tell the",
    "person, and only they read it, once. Write it in the language the note",
    `was spoken in — ${RECORD_LANGUAGE} unless the note itself is clearly in`,
    "another language; a note of codes, model numbers and names is English.",
    "One or two short sentences, first names only, plain words: what you are",
    "about to file, for whom and when. When clarify_needed is true, end it",
    "with the question, asked in their language. Never say anything is done,",
    "saved or sent — nothing is, until they have seen it.",
    "",
    "clarify_question and clarify_options are records like every other field:",
    `write them in ${RECORD_LANGUAGE}, whatever language the note was spoken`,
    "in. Only `say` follows the language they spoke.",
  ].join("\n");
}

/** What came before this note in the same conversation with Tiff. Already
    dealt with — filed, answered or taken back — so the router is told to use
    it only to understand what the note refers to. Empty on a first note, and
    on every note the review card sends. */
export function earlierBlock(earlier: readonly EarlierTurn[] | undefined): string {
  if (!earlier?.length) return "";
  return [
    "",
    "Earlier in this conversation, before this note. It has been dealt with",
    "already: route nothing from it again. Use it only to understand what the",
    "note refers to (\"the same for Smith St\", \"him\", \"that job\").",
    ...earlier.map((t) => `${t.who === "tiff" ? "You" : "They"}: ${t.text}`),
  ].join("\n");
}

/** WHERE THEY WERE when they said it. A bare instruction means different
    things typed into a diary and into a task list, and the box knows which
    it was. Home says nothing: it is the door for everything. */
export function roomLine(room: TiffRoom | undefined): string {
  switch (room) {
    case "diary":
      return "They wrote this in their diary. A remark about their day is a plain_note; make a task only when the note asks for something to be done.";
    case "tasks":
      return "They wrote this in their task list, so it is most likely a task. An instruction that names nobody is a task for the person speaking (`me`).";
    case "calendar":
      return "They wrote this in the calendar. A day or a time in it is when the thing happens: put it in due_date and remind_time, as 'at'.";
    default:
      return "";
  }
}

/** What the router is told it is. Exported for the same reason
    `systemPromptFor` is in the KB answerer: the language rule it carries is a
    fact about the workspace rather than about a call, and a test pins it.

    ONE PROMPT. The Debrief had its own, a morning braindump sorted into tasks,
    knowledge and "note lines" with every job-bound lane closed; it went with
    the Debrief (Isaac, 2026-09-24: "the diary, tasks and HeyTiff chat window
    should assist with that"), and its lane went out of the schema with it, so
    the model has nowhere to put words that no card shows. */
export function systemPrompt(ctx: NoteContext): string {
  const room = roomLine(ctx.room);
  const earlier = earlierBlock(ctx.earlier);
  return [
    "You route a tradesperson's site note into structured outcomes for an",
    "Australian HVAC business. The note was spoken aloud or typed quickly, so",
    "expect fragments, trade slang and transcription slips.",
    "",
    RECORD_IN_ENGLISH,
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
    "- kb_entries: reusable know-how worth teaching the whole team — a fix",
    "  or method that isn't in the manuals, a gotcha specific to a unit or",
    "  site type, anything that would help a DIFFERENT person on a DIFFERENT",
    "  day. Title it like a library card; write the body for someone who",
    "  wasn't there. Propose these SPARINGLY — a technique is knowledge,",
    "  'fixed the unit' is not, and most notes contain none. If they",
    "  explicitly say to remember something or add it to the knowledge base,",
    "  that is always a kb_entry.",
    "- plain_note: anything that is genuinely just a remark. A note is",
    "  allowed to be a note — do not manufacture tasks to seem useful.",
    "",
    "One note can produce several of these at once. Produce nothing for the",
    "parts of the note that do not call for it: empty arrays are correct.",
    "",
    whoBlock(ctx),
    "",
    "Set clarify_needed only when you genuinely cannot route the note without",
    "an answer — an ambiguous person, an unclear target, or a sentence that",
    "could be a task or a remark. Ask ONE short question and offer the",
    "concrete options. When clarify_needed is true, still fill in whatever",
    "you are confident about; do not blank the rest.",
    "",
    /* The modal's lines, each only when its caller sent it: a line that is
       absent is not even an empty one, so the review card's prompt is the
       one it always was, to the byte. */
    ...(ctx.speak ? [sayBlock(), ""] : []),
    whenBlock(ctx),
    ...(room ? [`\n${room}`] : []),
    ...(earlier ? [earlier] : []),
    ctx.targetLabel ? `\nThis note is about: ${ctx.targetLabel}.` : "",
    ctx.equipment?.length ? `Equipment on site: ${ctx.equipment.join(", ")}.` : "",
    historyBlock(ctx),
  ].join("\n");
}

/* ── name resolution (pure) ───────────────────────────────────────────── */

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type AssigneeMatch =
  | { kind: "none" }
  | { kind: "one"; id: string }
  | { kind: "ambiguous"; names: string[] };

/* WHAT A PERSON CALLS THEMSELVES.

   Kept here rather than in `lib/notes/sniff-cues`, whose own rule is not to
   copy entries between consumers on the assumption that a cue is a cue: the
   sieve is spending a routing call and can afford to be generous, while this
   list assigns real work to a real person and cannot. Every entry has to mean
   the speaker and nothing else.

   The other languages are here because the model is told to put the hint in
   the note's own words and NOT to correct it — so a note dictated in Vietnamese
   arrives with "tôi" in `assignee_hint`, and an English-only list quietly gives
   that person the one failure this whole feature exists to remove. Matched
   whole, never as substrings: "me" inside "Mehmet" is somebody else. */
const SELF: readonly string[] = [
  "me",
  "i",
  "myself",
  "my self",
  "self",
  // Spanish
  "yo",
  "mí",
  "mi",
  "a mí",
  // Vietnamese
  "tôi",
  "toi",
  "mình",
  "minh",
  // Tagalog
  "ako",
  "sa akin",
  // Mandarin
  "我",
  "我自己",
  // Arabic
  "أنا",
  "لي",
];

/** Match what the note said against the people who can be assigned work.

    First names are how a site note refers to people ("tell Luke"), so a
    first-name match counts — but ONLY when it is unique. Two Lukes is the
    case that matters: guessing picks a person at random and assigns real
    work to them, so it returns `ambiguous` and the caller turns that into a
    question instead.

    "ME" IS CHECKED LAST, AFTER EVERY REAL NAME, and the order is the whole of
    the rule: a workspace is entitled to a member called Mi or Ako, and a person
    who is on the list beats a pronoun that merely looks like them. It resolves
    only when an author was supplied — a surface that routes notes without one
    gets the old behaviour rather than a wrong person. */
export function resolveAssignee(
  hint: string,
  staff: readonly NoteStaff[],
  authorId?: string | null,
): AssigneeMatch {
  const h = norm(hint);
  if (!h) return { kind: "none" };

  const full = staff.filter((s) => norm(s.fullName) === h);
  if (full.length === 1) return { kind: "one", id: full[0].id };
  if (full.length > 1) return { kind: "ambiguous", names: full.map((s) => s.fullName) };

  const first = staff.filter((s) => norm(s.fullName).split(" ")[0] === h);
  if (first.length === 1) return { kind: "one", id: first[0].id };
  if (first.length > 1) return { kind: "ambiguous", names: first.map((s) => s.fullName) };

  if (authorId && SELF.includes(h)) return { kind: "one", id: authorId };

  return { kind: "none" };
}

/* ── shaping (pure) ───────────────────────────────────────────────────── */

const TITLE_MAX = 200;
const BODY_MAX = 1000;
/** Tiff's line: one or two short sentences, and a question at most. */
export const SAY_MAX = 280;
/** How many of the people a note names are offered beside "Me". */
const WHO_NAMES = 2;

/** Trim to a length, and treat anything that isn't a string as absent. Both
    ends of this feature need it — the shaper on the model's output, the action
    on the browser's — and it must behave identically on both, so it is one
    exported function rather than two identical private ones. */
export const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const cleanList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean) : [];

/** The people a note names, as the answers to "who should do this?".

    Matched against the ROSTER, never taken from the model: an option is only
    worth offering if picking it resolves to somebody, so a name the note said
    that nobody here answers to ("Dave") is not one. In the order the note
    said them, the speaker left out ("Me" is theirs), and a first name two
    people share is offered whole, so picking it can't ask the same question
    again. */
export function namesMentioned(
  said: string,
  staff: readonly NoteStaff[],
  authorId?: string | null,
): string[] {
  const words = said.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
  const firstOf = (s: NoteStaff) => norm(s.fullName).split(" ")[0];
  const found: { at: number; label: string }[] = [];
  for (const s of staff) {
    if (s.id === authorId) continue;
    const at = words.indexOf(firstOf(s));
    if (at < 0) continue;
    const shared = staff.filter((o) => firstOf(o) === firstOf(s)).length > 1;
    found.push({ at, label: shared ? s.fullName : s.fullName.split(" ")[0] });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.label))].slice(0, WHO_NAMES);
}

/** Model output → a proposal the app will act on.

    Everything is re-derived from a whitelist rather than trusted: severities
    that aren't ours become `warn`, empty titles drop the task entirely, and
    an ambiguous assignee is escalated into a clarify question even when the
    model didn't ask one — because assigning work to the wrong person is the
    failure this feature must not have.

    `said` is every word the person said on this note (the note, then their
    replies), read only to offer the names it mentions when a task has
    nobody on it. */
export function shapeProposal(raw: unknown, ctx: NoteContext, said = ""): NoteProposal {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  let clarify: NoteProposal["clarify"] =
    r.clarify_needed === true && clean(r.clarify_question, TITLE_MAX)
      ? {
          question: clean(r.clarify_question, TITLE_MAX),
          options: cleanList(r.clarify_options, TITLE_MAX),
        }
      : null;
  /* Whether the shaper asked, rather than the model: the model's own `say`
     knows nothing of a question it did not ask. */
  let escalated = false;

  const tasks: ProposedTask[] = [];
  for (const t of Array.isArray(r.tasks) ? r.tasks : []) {
    const row = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const title = clean(row.title, TITLE_MAX);
    if (!title) continue; // a task with no title is not a task

    const assigneeHint = clean(row.assignee_hint, TITLE_MAX);
    const match = resolveAssignee(assigneeHint, ctx.staff, ctx.author?.id);

    // Two people answer to that name — ask rather than pick one.
    if (match.kind === "ambiguous" && !clarify) {
      clarify = {
        question: `Which ${assigneeHint} did you mean?`,
        options: match.names,
      };
      escalated = true;
    }

    /* Nobody on it at all — ask who, the same way (the modal's notes only;
       see `askWho`). "Me" leads because a task with no name on it is most
       often the speaker's own, and it resolves only when there IS a speaker. */
    if (match.kind === "none" && ctx.askWho && !clarify) {
      clarify = {
        question: `Who should do this: ${title}?`,
        options: [
          ...(ctx.author ? ["Me"] : []),
          ...namesMentioned(said, ctx.staff, ctx.author?.id),
        ],
      };
      escalated = true;
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
      /* Same posture as the date beside it, and it matters more: a time is
         composed into a real instant server-side, so "9pm-ish" reaching the
         database as a nudge is worse than no nudge at all. Anything that is not
         a 24-hour clock becomes no time, and the task is simply a task. */
      remindTime: HHMM.test(String(row.remind_time ?? "")) ? String(row.remind_time) : "",
      /* Validated like the two beside it. `at` is the safe default in both
         directions: it is what an unreadable answer should mean, and it is
         what the field means when there is no time for it to qualify. */
      remindKind: isRemindKind(row.remind_kind) ? row.remind_kind : "at",
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

  const kbEntries: ProposedKbEntry[] = [];
  for (const k of Array.isArray(r.kb_entries) ? r.kb_entries : []) {
    const row = (k && typeof k === "object" ? k : {}) as Record<string, unknown>;
    const body = clean(row.body, 4000);
    if (!body) continue; // knowledge with no method in it is not knowledge
    /* A missing title falls back to the body's opening words — the library
       card needs SOMETHING to say, and dropping real know-how over a blank
       heading would be the wrong economy. */
    kbEntries.push({ title: clean(row.title, TITLE_MAX) || body.slice(0, 80), body });
  }

  /* Tiff's line ends with the question when she has one to ask. When the
     shaper asked it, the model's line was written for a plan the app has just
     stopped ("I'll make a task for Leo" over a Leo nobody is), and in the
     speaker's language, so the question tacked on after it read as a second
     voice (a real-notes check, 2026-09-26). The line is set aside and the
     question is all she says. `whoBlock` asks the model to raise these itself,
     in their words, so this is the fallback. Only when she speaks: the review
     card's read never asks for a line, so its proposals carry none. */
  let say = clean(r.say, SAY_MAX);
  if (ctx.speak && escalated && clarify) say = clarify.question;

  /* NO COERCION BY MODE. The Debrief's closed every job-bound lane and
     rewrote what landed in one into a "note line"; with the Debrief gone
     there is one ask, every lane is open, and the shaper passes each through
     as it came. */
  return {
    tasks,
    bringItems: cleanList(r.bring_items, TITLE_MAX),
    flags,
    progressBullets: cleanList(r.progress_bullets, BODY_MAX),
    commissioningEntries: entries("commissioning_entries", "body"),
    issueEntries: entries("issue_entries", "summary"),
    kbEntries,
    plainNote: clean(r.plain_note, BODY_MAX),
    say,
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
    p.kbEntries.length === 0 &&
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

/* ── A REPLY ROUTES THE WHOLE NOTE AGAIN ─────────────────────────────────

   The old clarify box sends one answer to one question and tells the model
   not to ask again (`ClarifyAnswer`), and still does, word for word. The
   modal is a conversation: a reply can answer, but it can also say "no,
   Callum's doing that", "leave the flag off" or "and order the filters too".
   So the modal's second read sees the note, the plan as it stands, the
   conversation since, and the rows they took off the plan, and routes the
   whole note again from there. */

export type NoteFollow = {
  /** The plan as it stands: the proposal stored last. */
  plan: NoteProposal;
  /** The conversation so far, the note's own turn first, the reply last. */
  turns: readonly Turn[];
  /** The rows they took off the plan, as `planRows` keys of `plan`. A key
      that names no row is ignored. */
  leftOut: readonly string[];
};

/** The review card's clarify box: the question the note is waiting on and
    the answer typed or picked under it (`answerClarify`). */
export type ClarifyAnswer = { question: string; answer: string };

/** One plan row, as the router is told it. The person's name comes off the
    roster by id; a hint that matched nobody is quoted as said. */
export function rowLine(row: PlanRow, p: NoteProposal, staff: readonly NoteStaff[]): string {
  switch (row.lane) {
    case "tasks": {
      const t = p.tasks[row.index];
      const who = t.assigneeId
        ? (staff.find((s) => s.id === t.assigneeId)?.fullName ?? t.assigneeHint) || "someone"
        : t.assigneeHint
          ? `"${t.assigneeHint}" (matched to nobody)`
          : "nobody yet";
      const when = [
        t.dueDate && `due ${t.dueDate}`,
        t.dueDate && t.remindTime && `${t.remindKind === "by" ? "by" : "at"} ${t.remindTime}`,
      ]
        .filter(Boolean)
        .join(" ");
      return `Task for ${who}: ${t.title}${when ? `, ${when}` : ""}`;
    }
    case "flags":
      return `Flag (${p.flags[row.index].severity}): ${row.text}`;
    case "issueEntries":
      return `Issue: ${row.text}`;
    case "bringItems":
      return `Bring: ${row.text}`;
    case "progressBullets":
      return `Progress: ${row.text}`;
    case "commissioningEntries":
      return `Commissioning: ${row.text}`;
    case "kbEntries":
      return `For the library: ${row.text}`;
  }
}

const same = (a: string, b: string) => norm(a) === norm(b);

/** A reply that is exactly one of the answers offered: nothing else in it to
    route, so the question is settled. */
export function isPlainAnswer(plan: NoteProposal, reply: string): boolean {
  return !!plan.clarify?.options.some((o) => same(o, reply));
}

/** What the router is sent: the note, and on a reply everything since.
    Pure and exported so the wording is pinned without a network call. */
export function noteContent(
  transcript: string,
  follow?: NoteFollow | ClarifyAnswer,
  staff: readonly NoteStaff[] = [],
): string {
  const text = transcript.trim();
  if (!follow) return `Note:\n${text}`;
  /* The review card's answer, in the words it has always been sent in. */
  if (!("plan" in follow)) {
    return `Note:\n${text}\n\nYou asked: ${follow.question}\nThey answered: ${follow.answer}\n\nRoute the note using that answer. Do not ask again.`;
  }

  const rows = planRows(follow.plan);
  const plan = [
    ...rows.map((row) => `- ${rowLine(row, follow.plan, staff)}`),
    follow.plan.plainNote && `- Kept as a remark: ${follow.plan.plainNote}`,
    follow.plan.clarify && `- Your question: ${follow.plan.clarify.question}`,
  ].filter(Boolean);
  const gone = rows
    .filter((row) => follow.leftOut.includes(row.key))
    .map((row) => rowLine(row, follow.plan, staff));

  /* "Since" is everything after the note's own turn, which IS the note. */
  const first = follow.turns.findIndex((t) => t.who === "you");
  const since = follow.turns.slice(first + 1);
  const reply = [...since].reverse().find((t) => t.who === "you")?.text ?? "";
  const plain = isPlainAnswer(follow.plan, reply);

  return [
    `Note:\n${text}`,
    `Your plan so far:\n${plan.length ? plan.join("\n") : "- nothing yet"}`,
    since.length
      ? `The conversation since:\n${since.map((t) => `${t.who === "tiff" ? "You" : "They"}: ${t.text}`).join("\n")}`
      : "",
    gone.length
      ? `They took these off the plan, so leave them off:\n${gone.map((l) => `- ${l}`).join("\n")}`
      : "",
    [
      "Route the whole note again with what they said. They may answer, change",
      "who does something, drop or add a row.",
      plain ? "They answered your question. Do not ask again." : "Ask again only if something is still unclear.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Read one note. `follow` carries what came after the first read: the
    review card's answer to its question, or the modal's conversation since,
    so a reply routes the whole note again with what it said.

    Never throws, and every failure keeps the note: the transcript is already
    the valuable thing, and routing is an enhancement on top of it. */
export async function readNote(
  transcript: string,
  ctx: NoteContext,
  follow?: NoteFollow | ClarifyAnswer
): Promise<NoteBrainResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: NO_KEY };
  const text = transcript.trim();
  if (!text) return { ok: false, error: "There was nothing in that note." };

  const client = new Anthropic();
  const content = noteContent(text, follow, ctx.staff);
  /* Every word they said, for the names a "who should do this?" offers. */
  const said = [
    text,
    ...(follow && "turns" in follow ? follow.turns : [])
      .filter((t) => t.who === "you")
      .slice(1)
      .map((t) => t.text),
  ].join("\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // A real cost/quality/LATENCY lever here — see DEFAULT_EFFORT.
      output_config: {
        effort: DEFAULT_EFFORT,
        /* `say` only when Tiff speaks back: the card's schema is the one
           it always had. */
        format: { type: "json_schema", schema: ctx.speak ? TIFF_NOTE_SCHEMA : NOTE_SCHEMA },
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

    /* THE LAST READING BEFORE THE CARD. The prompt above tells the router to
       write every record in English, and it does — but an instruction is not
       an enforced check, and the failure it guards against is silent and
       weeks late. `englishProposal` re-reads what came back, repairs what
       isn't, and returns the proposal untouched on any failure of its own. */
    return {
      ok: true,
      proposal: await englishProposal(shapeProposal(JSON.parse(block.text), ctx, said)),
    };
  } catch (err) {
    return { ok: false, error: reasonFor(err) };
  }
}
