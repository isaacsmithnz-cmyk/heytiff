import type { RemindKind } from "./reminders";

/* Tasks & notices — the two writable dashboard surfaces.

   Types plus the pure display helpers (ordering). Queries live in
   ./tasks-query, mutations in app/actions/dashboard. Kept pure and separate so
   the ordering and the "overdue" rule are unit-tested without a database. */

export type TaskStatus = "open" | "done";

/* What a noticeboard post IS. Declared here with the row type it belongs to;
   the rules about kinds (labels, narrowing, lifecycle) live in ./notices, which
   depends on this file and never the other way around. */
export type NoticeKind = "notice" | "poll" | "event";

export type DashTask = {
  id: string;
  title: string;
  detail: string | null;
  assigneeId: string;
  assigneeName: string;
  dueDate: string | null;
  status: TaskStatus;
  createdBy: string | null;
  createdAt: string;
  /** Set once completed — completing keeps the row; only an explicit delete
      (the creator's, or a manager's) removes a task. */
  doneAt: string | null;
  doneByName: string | null;
  /** The hour this task named, if it named one — a timestamptz whose date IS
      `dueDate`. The only thing that can put a task on Home's day rail; null
      for the ordinary "some time that day" task. */
  remindAt: string | null;
  /** How to read `remindAt`: be doing it THEN (`at`), or be finished BY then
      (`by`). Always a word, never null — a task with no `remindAt` has no
      moment for this to qualify, and reads as `at` because that costs nothing
      and every reminder written before the column existed was one. */
  remindKind: RemindKind;
};

/* A task you wrote for yourself is a private to-do; a task someone gave you is
   delegated work. Only delegated work is management's business — it's what
   shows in the team list, and what reports back to whoever assigned it when
   it's done. A self-assigned task stays with the person who made it.

   A task with no recorded creator counts as delegated: it wasn't self-made, so
   defaulting it to private would hide it from everyone. */
export function isDelegated(task: Pick<DashTask, "assigneeId" | "createdBy">): boolean {
  return task.createdBy !== task.assigneeId;
}

/* Late is ONE comparison: an open task whose day is before today. The Tasks
   face (./task-record) and the list's Late group (home-list.ts, the same
   comparison written inline) make this one test, so what the list calls late
   is exactly what the Tasks face does. A finished task is never late,
   whatever its date said. */
export function isLate(task: Pick<DashTask, "dueDate" | "status">, today: string): boolean {
  return task.status === "open" && task.dueDate !== null && task.dueDate < today;
}

export type NoticeItem = {
  id: string;
  title: string;
  body: string | null;
  pinned: boolean;
  postedById: string | null;
  postedByName: string | null;
  createdAt: string;
  /** Bumped only when the title/body changes — pinning is not a reword. */
  revision: number;
  /** Null until the first material edit; drives the "edited" marker. */
  editedAt: string | null;
  /** What the post is: a plain notice, a poll, an event. See lib/dashboard/notices. */
  kind: NoticeKind;
  /** Inclusive last day on the board (ISO date), or null to never expire. */
  expiresAt: string | null;
  /** Set when someone filed it off the board; distinct from expiry. */
  archivedAt: string | null;
};

/* Reading is passive, like a messaging app: a notice marks itself read once the
   reader has actually had it on screen. There is no acknowledge button.

   A read still means "I read THIS text", so it records the revision it was for.
   Editing therefore doesn't invalidate anything destructively — it just means
   readers who only saw the old wording stop counting as having read the current
   one, and quietly count again next time they see it. The author sees that as
   their read count dipping after an edit, which is the honest signal. */
export type NoticeReadState = "unread" | "read" | "stale";

export type NoticeWithRead = NoticeItem & {
  /** The revision the viewer last read; null if they never have. */
  ackedRevision: number | null;
  state: NoticeReadState;
  /** True when the viewer posted it — authors never "read" their own notice. */
  mine: boolean;
  /** How many others have read the CURRENT revision (author excluded). */
  readBy: number;
  /** How many others could read it — active staff, author excluded. */
  audience: number;
};

export function noticeReadState(revision: number, ackedRevision: number | null): NoticeReadState {
  if (ackedRevision === null) return "unread";
  return ackedRevision >= revision ? "read" : "stale";
}

export type DueState = "bad" | "warn" | "ok";

/* Open tasks, most urgent first: anything with a due date sorts by that date
   ascending (overdue → soonest → later), and undated tasks trail, newest of
   those first. Stable so equal keys keep insertion order. */
export function sortTasks<T extends Pick<DashTask, "dueDate" | "createdAt">>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

/* Notices: pinned first, then newest. */
export function sortNotices<T extends { pinned: boolean; createdAt: string }>(notices: readonly T[]): T[] {
  return [...notices].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

/* `unreadCount` lived here and had no callers left: `currentUnreadCount` in
   ./notices replaced it, and that went in its turn with the old Home's rail,
   the one place that badged the count. */
