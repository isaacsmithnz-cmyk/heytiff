import { auDayOf, daysUntil, fmtAuTime, fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { zonedParts } from "./day-rail";
import { isDelegated, isLate, sortTasks, type DashTask } from "./tasks";
import type { TaskEventKind } from "./task-events";

/* A TASK'S RECORD — what the new Home's Tasks face says about one task.

   Pure: types and words, no reads. The reads are ./task-record-query, the
   face is components/dashboard/home-tasks-face (T2). Every sentence the face
   prints about a task is made here, from the task row, where it came from
   (`TaskAbout`) and what happened to it since (`TaskEvent`), so the words
   are tested without a database or a screen.

   THE RECORD IS FIVE THINGS, and each has one maker here:
     For / Due / Time / Job   `factsOf`
     where it came from        `sourceLine`, under the title
     their own words           `wordsCaption` over `about.words`
     what happened since       `historyOf`
     what you may do to it     `powersOf`, the actions' own rules

   NO CLOCK IS READ. Every date is formatted from a stored ISO value against
   the loader's `today`, never against the time the page renders: a relative
   word worked out in render is a hydration mismatch waiting for midnight.
   Timestamps are read on the AU anchor, the way the diary reads its own
   (`auDayOf`); a reminder's hour is read in the workspace's zone, the way
   the day rail reads it (`zonedParts`). */

export { isLate };

/** Where a task came from. */
export type TaskSource =
  /** Tiff made it from something someone told Tiff (`workboard_notes`). */
  | "diary"
  /** It came off a ServiceM8 job note (`job_note_actions`). */
  | "sm8"
  /** A project's defects period made it (`projects.defects_task_id`). */
  | "project"
  /** Somebody typed it: nothing else claims it. */
  | "typed";

/** A moment as a person reads it, already in the right zone: the calendar
    day and the clock ("11:42 pm"), or no clock when none was kept. */
export type Moment = { day: string; time: string | null };

/** One change the tasks row cannot keep — a `task_events` row. */
export type TaskEvent = {
  kind: TaskEventKind;
  /** ISO timestamp. */
  at: string;
  /** Who pressed; null once their card is deleted. */
  by: string | null;
  /** `due`: the day before and after, either of which may be null. */
  dueFrom: string | null;
  dueTo: string | null;
  /** `given`: who had it. */
  from: string | null;
  /** `created` / `given`: who it went to; null once their card is deleted. */
  to: string | null;
};

/** The Job fact: words always, and a door only for a ServiceM8 job the
    mirror holds. A visit, an agreement or a project gets its words and no
    door (the reason is in journal.ts: no door on Home opens them). */
export type TaskJob = { label: string; uuid: string | null };

/** Everything the face knows about a task beyond its own row. */
export type TaskAbout = {
  source: TaskSource;
  /** diary: the entry that made it — "Open in diary". */
  noteId: string | null;
  /** diary: who said it; null once their card is deleted. */
  authorId: string | null;
  /** diary: said aloud rather than typed. */
  spoken: boolean;
  /** sm8: the note that made it — "Open conversation". */
  sm8NoteUuid: string | null;
  /** sm8: who wrote the note, as ServiceM8 spells them ("Luke Ingold"). */
  askerName: string | null;
  /** sm8: who pressed "make a task", or null when Tiff made it. */
  actedBy: string | null;
  /** project: the project's name. */
  project: string | null;
  /** When the words were said or written. */
  said: Moment | null;
  /** Their own words, verbatim: the diary entry, but ONLY for its author
      (journal-query's rule: nobody reads someone else's diary), or the
      ServiceM8 note as it was written. Null when there is nothing the viewer
      may read. */
  words: string | null;
  job: TaskJob | null;
  /** Oldest first. */
  events: TaskEvent[];
};

/** A task as the face reads it: the row plus the three facts the old Home
    never needed. A separate type rather than new fields on `DashTask`, so
    the old Home and its fixtures stay as they are until it is removed. */
export type RecordTask = DashTask & {
  createdByName: string | null;
  doneById: string | null;
  /** The assignee's "Got it" (task_acknowledged.sql). */
  acknowledgedAt: string | null;
};

/** The Tasks face's data. */
export type TaskRecord = {
  /** Yours, and with `team` the team's delegated work; most urgent first. */
  open: RecordTask[];
  /** What you finished, what you handed out and came back finished, and
      what you ticked: the last 90 days, newest first, at most 100. */
  done: RecordTask[];
  /** True when Done stopped at its limit: "Showing the latest 100." */
  doneCapped: boolean;
  /** task id → where it came from and what happened to it, for every task
      in `open` and `done`. */
  about: Record<string, TaskAbout>;
  /** staff id → display name, for every person the record names. */
  people: Record<string, string>;
};

/** A task nothing else claims: typed, with no events. */
export const typedAbout = (events: TaskEvent[] = []): TaskAbout => ({
  source: "typed",
  noteId: null,
  authorId: null,
  spoken: false,
  sm8NoteUuid: null,
  askerName: null,
  actedBy: null,
  project: null,
  said: null,
  words: null,
  job: null,
  events,
});

/* ── moments ── */

/** "4:00 pm" — the face's clock, the topbar's own format (`fmtAuTime`). */
export function clock12(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** A stored timestamp as a moment on the AU anchor, or null if unreadable. */
export function momentOf(iso: string | null | undefined): Moment | null {
  if (!iso) return null;
  const day = auDayOf(iso);
  return day ? { day, time: fmtAuTime(new Date(iso)) } : null;
}

/** ServiceM8's own stamp ("2026-09-21 13:42:10", naive, in the account's
    zone; "0000-00-00 00:00:00" for none) as a moment. Its day and clock are
    already the account's, so they are read as written, never converted. */
export function sm8Moment(stamp: string | null | undefined): Moment | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(stamp ?? ""));
  if (!m || m[1].startsWith("0000")) return null;
  const time = m[2] ? clock12(Number(m[2]) * 60 + Number(m[3])) : null;
  return { day: m[1], time };
}

/** "Fri 2 Oct", with the year only when it is not this year's. */
function dateWords(day: string, today: string): string {
  return day.slice(0, 4) === today.slice(0, 4) ? fmtAuWeekdayDayMonth(day) : fmtAuWeekdayDate(day);
}

/** "Today" or "Fri 2 Oct" — a day at the start of a line. */
function dayText(day: string, today: string): string {
  return day === today ? "Today" : dateWords(day, today);
}

/** "today" or "Fri 2 Oct" — a day inside a sentence. */
const dayInline = (day: string, today: string) => (day === today ? "today" : dateWords(day, today));

/** "Mon 21 Sept, 1:42 pm" / "Today, 1:42 pm" — a history time, a caption. */
export function whenText(m: Moment, today: string): string {
  const day = dayText(m.day, today);
  return m.time ? `${day}, ${m.time}` : day;
}

/** "2041 Wollstonecraft" — a ServiceM8 job named the way the diary's
    mention doors name it: its number and its suburb. Null when the mirror
    has neither. */
export function jobLabelOf(number: string | null | undefined, city: string | null | undefined): string | null {
  const n = number?.trim() || null;
  const c = city?.trim() || null;
  if (n && c) return `${n} ${c}`;
  if (n) return `Job ${n}`;
  return c;
}

/* ── people ── */

type People = Readonly<Record<string, string>>;

const firstOf = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;

/** Who, at the start of a sentence: "You", "Luke", or "Someone". */
function Who(id: string | null | undefined, people: People, viewer: string | null): string {
  if (id && viewer && id === viewer) return "You";
  return (id && firstOf(people[id])) || "Someone";
}

/** Who, inside a sentence: "you", "Luke", or "someone who has left". */
function whom(id: string | null | undefined, people: People, viewer: string | null): string {
  if (id && viewer && id === viewer) return "you";
  return (id && firstOf(people[id])) || "someone who has left";
}

/* ── the row ── */

/** His name tag on a row: the first name of whoever has the task, when that
    is not you — the list's own rule (lib/dashboard/home-list), so a task
    carries the same tag on both. */
export function nameTag(t: Pick<DashTask, "assigneeId" | "assigneeName">, viewer: string | null): string | null {
  if (viewer !== null && t.assigneeId === viewer) return null;
  return firstOf(t.assigneeName);
}

export type DueWord = { text: string; state: "bad" | "today" | null };

/** The word on the right of a row. Open: "30 days late", "Today",
    "Tomorrow", "Fri 2 Oct", or nothing without a date. Done: the day it was
    done, which is what a finished row dates itself by. */
export function dueWord(t: Pick<DashTask, "dueDate" | "status" | "doneAt">, today: string): DueWord | null {
  if (t.status === "done") {
    const day = t.doneAt ? auDayOf(t.doneAt) : "";
    return day ? { text: dayText(day, today), state: null } : null;
  }
  if (!t.dueDate) return null;
  const days = daysUntil(t.dueDate, today);
  if (isLate(t, today)) return { text: days === -1 ? "1 day late" : `${-days} days late`, state: "bad" };
  if (days === 0) return { text: "Today", state: "today" };
  if (days === 1) return { text: "Tomorrow", state: null };
  return { text: dateWords(t.dueDate, today), state: null };
}

/** The last hand-over, if the task has changed hands since it was made. */
const lastGiven = (about: TaskAbout) => [...about.events].reverse().find((e) => e.kind === "given") ?? null;

/** The line under a title: where it came from, or, once done, who did it. */
export function sourceLine(
  about: TaskAbout,
  t: RecordTask,
  viewer: string | null,
  today: string,
  people: People,
): string {
  if (t.status === "done") {
    return t.doneById ? `${Who(t.doneById, people, viewer)} ticked it off.` : "Done.";
  }
  const when = (m: Moment | null) => (m ? `, ${dayInline(m.day, today)}` : "");
  switch (about.source) {
    case "diary":
      if (about.authorId && about.authorId === viewer) return `Your diary${when(about.said)}.`;
      if (about.authorId && people[about.authorId])
        return `${firstOf(people[about.authorId])}'s diary${when(about.said)}.`;
      return `A diary entry${when(about.said)}.`;
    case "sm8": {
      const asker = firstOf(about.askerName) ?? "Someone";
      return t.assigneeId === viewer && viewer
        ? `${asker} asked you${when(about.said)}.`
        : `${asker} asked${when(about.said)}.`;
    }
    case "project":
      return about.project ? `From ${about.project}'s defects period.` : "From a project's defects period.";
    case "typed": {
      const g = lastGiven(about);
      if (g) {
        const day = when(momentOf(g.at));
        const to = whom(g.to, people, viewer);
        return g.by ? `${Who(g.by, people, viewer)} gave it to ${to}${day}.` : `Given to ${to}${day}.`;
      }
      const made = when(momentOf(t.createdAt));
      if (isDelegated(t)) {
        const to = whom(t.assigneeId, people, viewer);
        return t.createdBy
          ? `${Who(t.createdBy, people, viewer)} gave it to ${to}${made}.`
          : `Given to ${to}${made}.`;
      }
      const day = momentOf(t.createdAt);
      return day ? `Added ${dayInline(day.day, today)}.` : "Added.";
    }
  }
}

/** The caption over their words: "**You said**, Sat 22 Aug, 11:42 pm", or
    "**Luke Ingold** wrote, in a job note on 2041 Wollstonecraft". `strong`
    is the part set in weight; the caption reads `strong + rest`. Null when
    there are no words to caption. */
export function wordsCaption(about: TaskAbout, today: string): { strong: string; rest: string } | null {
  if (!about.words) return null;
  if (about.source === "diary") {
    return {
      strong: about.spoken ? "You said" : "You typed",
      rest: about.said ? `, ${whenText(about.said, today)}` : "",
    };
  }
  if (about.source === "sm8") {
    return {
      strong: about.askerName ?? "Someone",
      rest: about.job ? ` wrote, in a job note on ${about.job.label}` : " wrote, in a job note",
    };
  }
  return null;
}

export type TaskFact =
  | { label: "For" | "Due" | "Done" | "Time"; value: string; late?: boolean }
  | { label: "Job"; value: string; job: string | null };

/** The facts of an open row: For, Due (Done once finished), Time only when
    the task named an hour, and Job only when there is one to name. */
export function factsOf(
  t: RecordTask,
  about: TaskAbout,
  viewer: string | null,
  today: string,
  tz: string | null,
): TaskFact[] {
  const out: TaskFact[] = [
    { label: "For", value: viewer && t.assigneeId === viewer ? "You" : t.assigneeName },
  ];
  if (t.status === "done") {
    const day = t.doneAt ? auDayOf(t.doneAt) : "";
    out.push({ label: "Done", value: day ? dayText(day, today) : "Done" });
  } else if (!t.dueDate) {
    out.push({ label: "Due", value: "No date" });
  } else if (isLate(t, today)) {
    const late = -daysUntil(t.dueDate, today);
    out.push({
      label: "Due",
      value: `${dateWords(t.dueDate, today)}, ${late === 1 ? "1 day late" : `${late} days late`}`,
      late: true,
    });
  } else {
    out.push({ label: "Due", value: dateWords(t.dueDate, today) });
  }
  const hour = t.remindAt ? zonedParts(t.remindAt, tz) : null;
  if (hour) out.push({ label: "Time", value: `${t.remindKind === "by" ? "by" : "at"} ${clock12(hour.min)}` });
  if (about.job) out.push({ label: "Job", value: about.job.label, job: about.job.uuid });
  return out;
}

export type HistoryLine = {
  /** ISO timestamp — the order, and a key. */
  iso: string;
  /** "Mon 21 Sept, 1:42 pm" / "Today, 1:42 pm". */
  at: string;
  text: string;
};

/** Who a task was first made for: the `created` event says so; before that
    event existed, the first hand-over says who had it; with no hand-over at
    all, whoever has it now had it from the start. Null when that cannot be
    known (it changed hands, and the first holder's card is gone). */
function firstHolder(t: RecordTask, about: TaskAbout): string | null {
  const made = about.events.find((e) => e.kind === "created");
  if (made) return made.to;
  const given = about.events.find((e) => e.kind === "given");
  return given ? given.from : t.assigneeId;
}

/** Everything that happened to a task, oldest first, in dated lines.

    DERIVED FROM THE ROW, for every task: the made line (from where it came
    from and `created_at`), the hand-over it was made with, the assignee's
    "Got it" on delegated work, and a Done line from `done_at` when no
    logged completion already says so (every task finished before
    task_events existed). LOGGED, for tasks since: each due move, hand-over,
    completion and reopening. */
export function historyOf(
  t: RecordTask,
  about: TaskAbout,
  people: People,
  viewer: string | null,
  today: string,
): HistoryLine[] {
  const lines: HistoryLine[] = [];
  const push = (iso: string | null, text: string) => {
    const m = momentOf(iso);
    if (iso && m) lines.push({ iso, at: whenText(m, today), text });
  };

  /* made */
  let madeBy: string;
  switch (about.source) {
    case "diary":
      madeBy = "Tiff";
      push(
        t.createdAt,
        about.authorId && about.authorId === viewer
          ? "Tiff made it from your diary."
          : about.authorId && people[about.authorId]
            ? `Tiff made it from ${firstOf(people[about.authorId])}'s diary.`
            : "Tiff made it from a diary entry.",
      );
      break;
    case "sm8": {
      madeBy = about.actedBy ? Who(about.actedBy, people, viewer) : "Tiff";
      const note = about.askerName ? `${about.askerName}'s note in ServiceM8` : "a note in ServiceM8";
      push(t.createdAt, `${madeBy} made it from ${note}.`);
      break;
    }
    case "project":
      madeBy = "";
      push(t.createdAt, about.project ? `Made from ${about.project}'s defects period.` : "Made from a project's defects period.");
      break;
    case "typed":
      madeBy = Who(t.createdBy, people, viewer);
      push(t.createdAt, `${madeBy} typed it.`);
      break;
  }

  /* the hand-over it was made with: made by one person, for another */
  const holder = firstHolder(t, about);
  if (madeBy && holder && holder !== t.createdBy) {
    push(t.createdAt, `${madeBy} gave it to ${whom(holder, people, viewer)}.`);
  }

  /* "Got it" is only ever said about work someone was given */
  if (t.acknowledgedAt && isDelegated(t)) {
    push(t.acknowledgedAt, `${Who(t.assigneeId, people, viewer)} said Got it.`);
  }

  /* logged */
  for (const e of about.events) {
    const by = e.by && e.by !== viewer && people[e.by] ? ` by ${firstOf(people[e.by])}` : "";
    switch (e.kind) {
      case "due":
        if (e.dueTo === null) push(e.at, `Due date taken off${by}.`);
        else if (e.dueFrom === null) push(e.at, `Due set for ${dateWords(e.dueTo, today)}${by}.`);
        else push(e.at, `Due moved to ${dateWords(e.dueTo, today)}${by}.`);
        break;
      case "given":
        push(e.at, `Given to ${whom(e.to, people, viewer)}.`);
        break;
      case "done":
        push(e.at, e.by ? `Done. ${Who(e.by, people, viewer)} ticked it off.` : "Done.");
        break;
      case "reopened":
        push(e.at, "Not done yet. Back on the list.");
        break;
      case "created":
        break; // the made line above already says it
    }
  }

  /* The row's own Done, when nothing logged says it: no completion since the
     last reopening (or at all). */
  if (t.status === "done" && t.doneAt) {
    let lastReopen = -1;
    about.events.forEach((e, i) => {
      if (e.kind === "reopened") lastReopen = i;
    });
    const logged = about.events.some((e, i) => i > lastReopen && e.kind === "done");
    if (!logged) push(t.doneAt, t.doneById ? `Done. ${Who(t.doneById, people, viewer)} ticked it off.` : "Done.");
  }

  /* Oldest first; a stable sort keeps the made line before the hand-over it
     was made with, which shares its moment. */
  return lines
    .map((l, i) => ({ l, i, ms: new Date(l.iso).getTime() }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i)
    .map((x) => x.l);
}

/** What the viewer may do to a task — the actions' own rules, so the face
    never offers a button the action would refuse (and the actions decide
    again regardless).
      finish   Mark done, the tick, Not done yet: the assignee, or `team`.
               The creator is not in it: completeTask refuses them.
      move     the date: the assignee, the creator, or `team`; open only.
      give     `team`, open only (Isaac, 2026-09-25).
      remove   Delete task: the creator, or `team`.
    A row with no `finish` is a report — someone else's completion of work
    you handed out — and wears a tick with no control. */
export function powersOf(
  t: Pick<DashTask, "assigneeId" | "createdBy" | "status">,
  viewer: string | null,
  canManage: boolean,
): { finish: boolean; move: boolean; give: boolean; remove: boolean } {
  const assignee = !!viewer && t.assigneeId === viewer;
  const creator = !!viewer && t.createdBy === viewer;
  const open = t.status === "open";
  return {
    finish: canManage || assignee,
    move: open && (canManage || assignee || creator),
    give: open && canManage,
    remove: canManage || creator,
  };
}

/* ── what the face shows before the page comes back ── */

/** A change pressed on the face and not yet answered: the face shows the
    task as it will be (React's `useOptimistic`) until the action's answer
    brings the page back, and as it was if the action says no. */
export type TaskChange =
  | { id: string; kind: "done"; at: string; by: string | null }
  | { id: string; kind: "open" }
  | { id: string; kind: "due"; due: string | null }
  | { id: string; kind: "give"; to: string; name: string }
  | { id: string; kind: "gone" };

const stamp = (iso: string | null) => (iso ? new Date(iso).getTime() || 0 : 0);

/** The record's two groups with these changes made, in the order they were
    pressed. A task ticked off goes to Done by the moment it was ticked,
    newest first, as the page will put it; one taken back goes to Open in
    Open's own order (`sortTasks`); a moved date re-sorts Open; a deleted
    task goes. A change to a task the record no longer holds is nothing. */
export function withChanges(
  record: Pick<TaskRecord, "open" | "done">,
  changes: readonly TaskChange[],
): { open: RecordTask[]; done: RecordTask[] } {
  if (changes.length === 0) return { open: record.open, done: record.done };
  const all = new Map<string, RecordTask>();
  for (const t of [...record.open, ...record.done]) all.set(t.id, t);
  for (const c of changes) {
    const t = all.get(c.id);
    if (!t) continue;
    switch (c.kind) {
      case "gone":
        all.delete(c.id);
        break;
      case "done":
        all.set(c.id, { ...t, status: "done", doneAt: c.at, doneById: c.by });
        break;
      case "open":
        all.set(c.id, { ...t, status: "open", doneAt: null, doneById: null });
        break;
      case "due":
        all.set(c.id, { ...t, dueDate: c.due });
        break;
      case "give":
        /* giveTask clears the old "Got it": the new person has not said it */
        all.set(c.id, { ...t, assigneeId: c.to, assigneeName: c.name, acknowledgedAt: null });
        break;
    }
  }
  const tasks = [...all.values()];
  return {
    open: sortTasks(tasks.filter((t) => t.status === "open")),
    done: tasks.filter((t) => t.status === "done").sort((a, b) => stamp(b.doneAt) - stamp(a.doneAt)),
  };
}
