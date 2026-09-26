/* WHAT A FILED NOTE RECORDED, AND WHAT UNDO CAN TAKE BACK — pure.

   `workboard_notes.applied` has always recorded what a note created: task
   ids, flag ids, entry ids, and the words where a group became text on
   somebody else's row. That was enough for the journal to count and to open
   doors, and not enough to take anything back:

     · checklist and picklist rows were inserted without asking for their ids
     · an issue that was BUMPED sat in `issueIds` beside the ones created, so
       nothing could tell "delete this" from "put the count back"
     · an append to a visit's notes or an agreement's bring list recorded the
       lines, not what the column said before

   `v: 2` is the record Undo needs, written by `applyConfirmed` for every note
   from now on (the review card's and the modal's alike). Undo refuses a note
   without it rather than guess at a v1 record.

   THE JOURNAL'S GROUPS ARE UNTOUCHED. `issueIds` still lists every issue the
   note touched, bumped or fresh, because the diary's chips read it; the bumps
   are named again in `issueBumps` with the count and day they had before, and
   a fresh issue is one in `issueIds` that is not a bump. The keys only Undo
   reads (`v`, `checklistIds`, `picklistIds`, `issueBumps`, `textWrites`,
   `kbTitles`) are not journal groups and never pass through `record`. */

export const APPLIED_V = 2;

/** The rows whose free text a note may append to, and the columns. Undo
    restores ONLY these, whatever the stored record claims. */
export const TEXT_COLUMNS = {
  projects: ["notes"],
  maintenance_visits: ["notes"],
  maintenance_agreements: ["notes", "bring_list"],
} as const satisfies Record<string, readonly string[]>;
export type TextTable = keyof typeof TEXT_COLUMNS;

export type TextWrite = {
  table: TextTable;
  id: string;
  column: string;
  /** The column exactly as it was read, null included. */
  before: string | null;
  /** The column exactly as this note wrote it. Undo restores `before` only
      while the column still says this. */
  after: string;
};

/** An issue this note counted again, with what it said before the bump. */
export type IssueBump = { id: string; occurrences: number; lastSeen: string | null };

export type AppliedRecord = {
  v: number | null;
  taskIds: string[];
  flagIds: string[];
  entryIds: string[];
  entryLines: string[];
  issueIds: string[];
  issueBumps: IssueBump[];
  bringItems: string[];
  checklistIds: string[];
  picklistIds: string[];
  textWrites: TextWrite[];
  kbIds: string[];
  kbTitles: string[];
  jobNotes: string[];
  noteLines: string[];
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];

const isTextWrite = (w: Record<string, unknown>): boolean => {
  const cols = (TEXT_COLUMNS as Record<string, readonly string[]>)[String(w.table)];
  return (
    !!cols &&
    cols.includes(String(w.column)) &&
    typeof w.id === "string" &&
    w.id !== "" &&
    (w.before === null || typeof w.before === "string") &&
    typeof w.after === "string"
  );
};

/** The column, shaped. Anything that is not a group we write is dropped. */
export function appliedOf(raw: unknown): AppliedRecord {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const objects = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      : [];
  return {
    v: typeof r.v === "number" ? r.v : null,
    taskIds: strings(r.taskIds),
    flagIds: strings(r.flagIds),
    entryIds: strings(r.entryIds),
    entryLines: strings(r.entryLines),
    issueIds: strings(r.issueIds),
    issueBumps: objects(r.issueBumps)
      .filter((b) => typeof b.id === "string" && b.id && Number.isInteger(b.occurrences))
      .map((b) => ({
        id: b.id as string,
        occurrences: b.occurrences as number,
        lastSeen: typeof b.lastSeen === "string" ? b.lastSeen : null,
      })),
    bringItems: strings(r.bringItems),
    checklistIds: strings(r.checklistIds),
    picklistIds: strings(r.picklistIds),
    textWrites: objects(r.textWrites)
      .filter(isTextWrite)
      .map((w) => ({
        table: w.table as TextTable,
        id: w.id as string,
        column: w.column as string,
        before: (w.before as string | null) ?? null,
        after: w.after as string,
      })),
    kbIds: strings(r.kbIds),
    kbTitles: strings(r.kbTitles),
    jobNotes: strings(r.jobNotes),
    noteLines: strings(r.noteLines),
  };
}

/** The issues this note CREATED — the ones Undo deletes. A bump is put back
    instead, so it must never be in here. */
export function freshIssueIds(a: AppliedRecord): string[] {
  const bumped = new Set(a.issueBumps.map((b) => b.id));
  return a.issueIds.filter((id) => !bumped.has(id));
}

/* ── THE DOORS AFTER "DONE." ─────────────────────────────────────────────

   What Tiff says she filed, one line per kind, each a door the room can open
   onto what landed. Counted from the record, never from the plan: a row that
   did not land is not a door. */

export type NoteDoorKind = "tasks" | "flags" | "issues" | "bring" | "lines";

export type NoteDoor = {
  kind: NoteDoorKind;
  count: number;
  /** "2 tasks filed" — the words, verbatim from the spec. */
  label: string;
  /** The rows behind the door, where they have ids. Bring-items on an
      agreement and lines on a visit are text on its row and have none. */
  ids: string[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function doorsOf(a: AppliedRecord): NoteDoor[] {
  const doors: NoteDoor[] = [];
  const add = (kind: NoteDoorKind, count: number, label: string, ids: string[]) => {
    if (count > 0) doors.push({ kind, count, label, ids });
  };
  add("tasks", a.taskIds.length, `${plural(a.taskIds.length, "task", "tasks")} filed`, a.taskIds);
  add("flags", a.flagIds.length, `${plural(a.flagIds.length, "flag", "flags")} raised`, a.flagIds);
  add("issues", a.issueIds.length, `${plural(a.issueIds.length, "issue", "issues")} logged`, a.issueIds);
  add(
    "bring",
    a.bringItems.length,
    `${plural(a.bringItems.length, "thing", "things")} to bring`,
    [...a.checklistIds, ...a.picklistIds],
  );
  const lines = a.entryIds.length + a.entryLines.length;
  add("lines", lines, `${plural(lines, "line", "lines")} on the job`, a.entryIds);
  return doors;
}

/** Whether Undo has anything to take back: a row it made, an issue it
    counted, or words it added to somebody else's row. A note whose record
    is only words kept (a line in your notes, a note on a job) has nothing
    Undo reaches, so it offers nothing. */
export function takesBack(a: AppliedRecord): boolean {
  return (
    a.taskIds.length +
      a.flagIds.length +
      a.entryIds.length +
      a.issueIds.length +
      a.checklistIds.length +
      a.picklistIds.length +
      a.textWrites.length +
      a.kbIds.length >
    0
  );
}

/* ── WHETHER UNDO WOULD STILL TAKE IT BACK ──────────────────────────────

   Asked in two places, answered here once: `undoNote`, which refuses on
   it, and the new Home's diary, which offers Undo only where the press
   would not be refused. Each reads the rows the record names and hands
   them in, so "someone has acted on a filed row" cannot mean one thing
   when the diary draws Undo and another when it is pressed.

   A row that is not handed in has been deleted since: there is nothing of
   anybody's in it to protect, so it stops nothing — and it is not taken
   back either, so `stillThere` leaves it out of what Undo says it took. */

/** A filed row as it reads now: the columns Undo's checks look at. */
export type NowRow = Readonly<Record<string, unknown>>;

export type FiledNow = {
  /** Its tasks still there, by id: `status`, `acknowledged_at`. */
  tasks: ReadonlyMap<string, NowRow>;
  /** Its tasks somebody has given, moved, ticked or reopened since they
      were made (their history, task_events). */
  taskHistory: ReadonlySet<string>;
  /** `active`. */
  flags: ReadonlyMap<string, NowRow>;
  /** Bumped and fresh alike: `occurrences`, `resolved`. */
  issues: ReadonlyMap<string, NowRow>;
  /** `done`. */
  checklist: ReadonlyMap<string, NowRow>;
  /** `picked`. */
  picklist: ReadonlyMap<string, NowRow>;
  /** Project entries still there. They have no state anyone acts on. */
  entries: ReadonlySet<string>;
  /** Library entries still there (field notes, the only kind Undo takes). */
  kb: ReadonlySet<string>;
  /** Each row a text write went to, by `textKey`: its columns as they read
      now. */
  text: ReadonlyMap<string, NowRow>;
};

export const textKey = (table: TextTable, id: string): string => `${table}:${id}`;

/** Why Undo would be refused: a task ticked off (named, so the sentence can
    say by whom), a row somebody acted on, or a job's notes that have
    changed since the note wrote to them. */
export type UndoBlock = { why: "ticked"; taskId: string } | { why: "acted" } | { why: "text" };

/** Undo lasts until someone acts on a filed row (the spec's call): a task
    ticked off, given on, moved, reopened or answered "Got it", a flag
    cleared, an issue counted again or resolved, a line bought or ticked,
    the job's notes edited since. Null: nothing stops it. */
export function undoBlocked(a: AppliedRecord, now: FiledNow): UndoBlock | null {
  const there = (m: ReadonlyMap<string, NowRow>, ids: readonly string[]): NowRow[] =>
    ids.flatMap((id) => {
      const r = m.get(id);
      return r ? [r] : [];
    });
  const ticked = a.taskIds.find((id) => {
    const t = now.tasks.get(id);
    return !!t && t.status !== "open";
  });
  if (ticked) return { why: "ticked", taskId: ticked };
  const issue = (id: string) => now.issues.get(id);
  if (
    a.taskIds.some((id) => now.taskHistory.has(id)) ||
    there(now.tasks, a.taskIds).some((t) => t.acknowledged_at != null) ||
    there(now.flags, a.flagIds).some((f) => f.active !== true) ||
    a.issueBumps.some((b) => {
      const i = issue(b.id);
      return !!i && i.occurrences !== b.occurrences + 1;
    }) ||
    freshIssueIds(a).some((id) => {
      const i = issue(id);
      return !!i && (i.occurrences !== 1 || i.resolved === true);
    }) ||
    there(now.checklist, a.checklistIds).some((c) => c.done === true) ||
    there(now.picklist, a.picklistIds).some((p) => p.picked === true)
  ) {
    return { why: "acted" };
  }
  for (const w of a.textWrites) {
    const said = now.text.get(textKey(w.table, w.id))?.[w.column] ?? null;
    if (said !== w.after) return { why: "text" };
  }
  return null;
}

/** The record narrowed to what is still there to take back — what Undo
    counts when it says what it took, so "2 tasks taken back." is never
    said of one. Words it added to a row's text stand while the column
    still says them (`undoBlocked` refuses otherwise). A bring-item that
    became a row goes with its row; one that became words on an
    agreement's list stands with the words. */
export function stillThere(a: AppliedRecord, now: FiledNow): AppliedRecord {
  const kept = (m: { has(id: string): boolean }, ids: readonly string[]) => ids.filter((id) => m.has(id));
  const bringRows = [...a.checklistIds, ...a.picklistIds];
  const rowLeft = (id: string | undefined) => !!id && (now.checklist.has(id) || now.picklist.has(id));
  return {
    ...a,
    taskIds: kept(now.tasks, a.taskIds),
    flagIds: kept(now.flags, a.flagIds),
    entryIds: kept(now.entries, a.entryIds),
    issueIds: kept(now.issues, a.issueIds),
    issueBumps: a.issueBumps.filter((b) => now.issues.has(b.id)),
    checklistIds: kept(now.checklist, a.checklistIds),
    picklistIds: kept(now.picklist, a.picklistIds),
    /* inserted in the order they were said, so the i-th row is the i-th item */
    bringItems: bringRows.length ? a.bringItems.filter((_, i) => rowLeft(bringRows[i])) : a.bringItems,
    kbIds: kept(now.kb, a.kbIds),
  };
}

/** What Undo says it took back: "2 tasks taken back.", "1 task and 1 flag
    taken back." A note that filed nothing but its words says "Taken back." */
export function undoSummary(a: AppliedRecord): string {
  const parts = [
    a.taskIds.length && plural(a.taskIds.length, "task", "tasks"),
    a.flagIds.length && plural(a.flagIds.length, "flag", "flags"),
    a.issueIds.length && plural(a.issueIds.length, "issue", "issues"),
    a.bringItems.length && plural(a.bringItems.length, "thing to bring", "things to bring"),
    a.entryIds.length + a.entryLines.length &&
      plural(a.entryIds.length + a.entryLines.length, "line", "lines"),
    a.kbIds.length && plural(a.kbIds.length, "library entry", "library entries"),
  ].filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return "Taken back.";
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${said} taken back.`;
}
