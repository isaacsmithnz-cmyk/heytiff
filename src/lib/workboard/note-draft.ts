import type { ConfirmedNote, NoteTarget } from "@/app/actions/workboard-notes";
import { isRemindKind, type RemindKind } from "@/lib/dashboard/reminders";
import type { NoteProposal, ProposedTask, Severity } from "./note-brain";

/* FROM A PROPOSAL TO WHAT GETS FILED — pure, and on both sides of the wire.

   These lived in `components/notes/review-card.tsx` while the review card
   was the only thing that turned a proposal into a confirmation. The Tiff
   modal files on the SERVER (`fileNote`, Isaac's call: filing live, with
   Undo as the net), from the proposal the server stored rather than one a
   browser posts, so the rules moved here where both could reach them. The
   review card went with the old capture UI (2026-09-27), and its own Save
   rules (`blockers`, `nothingTicked`) and its server door (`applyNote`)
   with it; `targetOf` still reads the expense form's job picker.

   THE ENGINE'S CONTRACT: `fileNote` applies `toConfirmed(toDraft(stored))`
   minus the rows the person took off, and never a payload the model or a
   browser shaped directly. */

export type Draft = {
  tasks: {
    on: boolean;
    title: string;
    detail: string;
    assigneeId: string | null;
    dueDate: string;
    /** "HH:MM" on the workspace's clock, or "" for an ordinary task. A day
        plus a time IS a reminder — there is no separate switch for one. */
    remindTime: string;
    /** Whether that time is when to DO it or when it must be DONE. The model
        proposes it from the note's own words ("back by four" is a deadline,
        "service at half seven" is not) and this is where a person disagrees. */
    remindKind: RemindKind;
    hint: string;
    dueHint: string;
  }[];
  bringItems: { on: boolean; text: string }[];
  flags: { on: boolean; message: string; severity: string }[];
  progressBullets: { on: boolean; text: string }[];
  commissioningEntries: { on: boolean; text: string }[];
  issueEntries: { on: boolean; summary: string; equipmentRef: string }[];
  /** LEARN — "Worth teaching everyone". Ticked rows publish to the KB. */
  kbEntries: { on: boolean; title: string; body: string }[];
};

export function toDraft(p: NoteProposal): Draft {
  return {
    tasks: p.tasks.map((t) => ({
      on: true,
      title: t.title,
      detail: t.detail,
      assigneeId: t.assigneeId,
      /* Seeded from the model's resolved day. "Tomorrow" is a date, and
         making someone read the word and then type the date is asking them
         to do the easy half of the job the note already did. */
      dueDate: t.dueDate,
      /* The router resolves "Monday morning" against this person's own working
         day, so the wheel opens on the time they asked for rather than on one
         the card guessed. */
      remindTime: t.remindTime,
      remindKind: t.remindKind,
      hint: t.assigneeHint,
      /* What was actually SAID about when — "before Monday's visit (3
         August)". The date box starts empty because that phrase isn't a
         date, but throwing the words away meant the one bit of the note
         that gave a task its urgency never reached the person doing it. */
      dueHint: t.dueHint,
    })),
    bringItems: p.bringItems.map((text) => ({ on: true, text })),
    flags: p.flags.map((f) => ({ on: true, message: f.message, severity: f.severity })),
    progressBullets: p.progressBullets.map((text) => ({ on: true, text })),
    commissioningEntries: p.commissioningEntries.map((e) => ({ on: true, text: e.body })),
    issueEntries: p.issueEntries.map((e) => ({
      on: true,
      summary: e.body,
      equipmentRef: e.equipmentHint,
    })),
    kbEntries: p.kbEntries.map((k) => ({ on: true, title: k.title, body: k.body })),
  };
}

export function toConfirmed(d: Draft): ConfirmedNote {
  return {
    tasks: d.tasks
      .filter((t) => t.on && t.title.trim() && t.assigneeId)
      .map((t) => ({
        title: t.title,
        detail: t.detail,
        assigneeId: t.assigneeId,
        dueDate: t.dueDate || null,
        /* A time with no day is not a moment, so it never travels alone —
           `remindAtFrom` would refuse it server-side anyway, and sending it
           would put a value in the payload that cannot become anything. */
        remindTime: (t.dueDate && t.remindTime) || null,
        /* Travels with the time, for the same reason: a kind with no moment
           to qualify is refused by the database and means nothing here. */
        remindKind: (t.dueDate && t.remindTime && t.remindKind) || null,
      })),
    bringItems: d.bringItems.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    flags: d.flags
      .filter((f) => f.on && f.message.trim())
      .map((f) => ({ message: f.message, severity: f.severity })),
    progressBullets: d.progressBullets.filter((b) => b.on && b.text.trim()).map((b) => b.text),
    commissioningEntries: d.commissioningEntries
      .filter((e) => e.on && e.text.trim())
      .map((e) => e.text),
    issueEntries: d.issueEntries
      .filter((e) => e.on && e.summary.trim())
      .map((e) => ({ summary: e.summary, equipmentRef: e.equipmentRef })),
    /* No library entries: each waits for its own press (`publishNoteKb`),
       so a filing never publishes one. */
  };
}

/** Buckets that are text on somebody else's row and cannot exist without a
    job to sit on. Tasks are deliberately NOT here — `tasks` has no job
    column, so a task from a note stands on its own.

    ANY job satisfies this, and that is the whole of the rule — do not be
    tempted to make progress and commissioning ask for a PROJECT because
    `project_entries` is where they land on one. They land somewhere on a
    visit and an agreement too (the job's own notes, a bullet per line), and
    the writer (`applyConfirmed`) enforces exactly this list. It didn't
    always: the server accepted any job here while only ever writing the
    project case, so a reading ticked against a visit was dropped in silence
    under a card that had nothing to complain about. `fileNote` asks "Which
    job is this for?" off this list, and the writer refuses off its own:
    the two must say the same thing. */
export const jobBound = (d: Draft): boolean => {
  const c = toConfirmed(d);
  return (
    c.bringItems.length > 0 ||
    c.flags.length > 0 ||
    c.progressBullets.length > 0 ||
    c.commissioningEntries.length > 0 ||
    c.issueEntries.length > 0
  );
};

/** Turn a picker value ("visit:abc") back into a target. */
export function targetOf(picked: string): NoteTarget | null {
  if (!picked) return null;
  const [kind, id] = picked.split(":");
  return kind === "agreement" || kind === "project" || kind === "visit"
    ? { kind: kind as NoteTarget["kind"], id }
    : null;
}

/* ── THE PLAN AS ROWS ────────────────────────────────────────────────────

   The modal draws the plan as rows, each with a cross that takes it off; the
   server has to know which row a cross meant. A row is named by its lane and
   its place in the STORED proposal ("tasks:0"), never by its words: the words
   are the model's and can repeat, the place cannot. A key is only good for
   the proposal it was read off, which is the one the server stored last. */

export const PLAN_LANES = [
  "tasks",
  "flags",
  "issueEntries",
  "bringItems",
  "progressBullets",
  "commissioningEntries",
  "kbEntries",
] as const;
export type PlanLane = (typeof PLAN_LANES)[number];

export type PlanRow = {
  key: string;
  lane: PlanLane;
  index: number;
  /** The row's own words: a task's title, a flag's message, an entry's body. */
  text: string;
};

export function planRows(p: NoteProposal): PlanRow[] {
  const rows: PlanRow[] = [];
  const add = (lane: PlanLane, texts: string[]) =>
    texts.forEach((text, index) => rows.push({ key: `${lane}:${index}`, lane, index, text }));
  add("tasks", p.tasks.map((t) => t.title));
  add("flags", p.flags.map((f) => f.message));
  add("issueEntries", p.issueEntries.map((e) => e.body));
  add("bringItems", p.bringItems);
  add("progressBullets", p.progressBullets);
  add("commissioningEntries", p.commissioningEntries.map((e) => e.body));
  add("kbEntries", p.kbEntries.map((k) => k.title));
  return rows;
}

/** The draft with the named rows unticked. A key that names nothing is
    ignored: the browser can only take a row OFF, never put one on. */
export function withoutRows(d: Draft, keys: readonly string[]): Draft {
  const next: Draft = {
    tasks: d.tasks.map((r) => ({ ...r })),
    bringItems: d.bringItems.map((r) => ({ ...r })),
    flags: d.flags.map((r) => ({ ...r })),
    progressBullets: d.progressBullets.map((r) => ({ ...r })),
    commissioningEntries: d.commissioningEntries.map((r) => ({ ...r })),
    issueEntries: d.issueEntries.map((r) => ({ ...r })),
    kbEntries: d.kbEntries.map((r) => ({ ...r })),
  };
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const [lane, at] = key.split(":");
    if (!(PLAN_LANES as readonly string[]).includes(lane) || !/^\d+$/.test(at ?? "")) continue;
    const row = next[lane as PlanLane][Number(at)];
    if (row) row.on = false;
  }
  return next;
}

/* The severities a flag can carry, restated as a set rather than imported:
   `note-brain` holds the SDK, and this module is read by the browser. The
   `satisfies` holds every entry to the real type. */
const SEVERITY = new Set<string>(["info", "warn", "urgent"] satisfies Severity[]);

/* ── A STORED PROPOSAL, READ BACK ────────────────────────────────────────

   `workboard_notes.proposal` is our own JSON, written by `shapeProposal` —
   but written by every version of it since the table began. A row from
   before the LEARN lane has no `kbEntries`, one from before the modal has no
   `say`, one from before reminders no `remindTime`. The server files from
   this, so it is shaped rather than trusted: a missing lane is empty, and
   something that is not a proposal at all is null. */
export function storedProposal(raw: unknown): NoteProposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const list = <T>(v: unknown, keep: (x: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          const kept = x && typeof x === "object" ? keep(x as Record<string, unknown>) : null;
          return kept === null ? [] : [kept];
        })
      : [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

  const tasks = list<ProposedTask>(r.tasks, (t) =>
    str(t.title).trim()
      ? {
          title: str(t.title),
          detail: str(t.detail),
          assigneeId: typeof t.assigneeId === "string" && t.assigneeId ? t.assigneeId : null,
          assigneeHint: str(t.assigneeHint),
          dueHint: str(t.dueHint),
          dueDate: str(t.dueDate),
          remindTime: str(t.remindTime),
          remindKind: isRemindKind(t.remindKind) ? t.remindKind : "at",
        }
      : null,
  );
  const entry = (e: Record<string, unknown>) =>
    str(e.body).trim() ? { body: str(e.body), equipmentHint: str(e.equipmentHint) } : null;
  const c = r.clarify && typeof r.clarify === "object" ? (r.clarify as Record<string, unknown>) : null;

  return {
    tasks,
    bringItems: strs(r.bringItems),
    flags: list(r.flags, (f) =>
      str(f.message).trim()
        ? {
            message: str(f.message),
            severity: (SEVERITY.has(str(f.severity)) ? str(f.severity) : "warn") as Severity,
          }
        : null,
    ),
    progressBullets: strs(r.progressBullets),
    commissioningEntries: list(r.commissioningEntries, entry),
    issueEntries: list(r.issueEntries, entry),
    kbEntries: list(r.kbEntries, (k) =>
      str(k.body).trim() ? { title: str(k.title), body: str(k.body) } : null,
    ),
    plainNote: str(r.plainNote),
    say: str(r.say),
    clarify: c && str(c.question).trim() ? { question: str(c.question), options: strs(c.options) } : null,
  };
}
