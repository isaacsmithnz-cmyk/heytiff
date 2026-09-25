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
