import { daysUntil } from "@/components/fleet/logic";

/* Tasks & notices — the two writable dashboard surfaces.

   Types plus the pure display helpers (due labels, ordering). Queries live in
   ./tasks-query, mutations in app/actions/dashboard. Kept pure and separate so
   the ordering and the "overdue" rule are unit-tested without a database. */

export type TaskStatus = "open" | "done";

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
};

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

/** A task is "soon" within this many days of its due date. */
export const DUE_SOON_DAYS = 7;

/** The due-date label and its urgency, or null when no date is set. */
export function dueLabel(
  dueDate: string | null,
  today: string,
): { label: string; state: DueState } | null {
  if (!dueDate) return null;
  const days = daysUntil(dueDate, today);
  if (days < 0) return { label: `Overdue ${-days}d`, state: "bad" };
  if (days === 0) return { label: "Due today", state: "warn" };
  if (days <= DUE_SOON_DAYS) return { label: `Due in ${days}d`, state: "warn" };
  return { label: `Due ${fmtDate(dueDate)}`, state: "ok" };
}

/** "15 Jul" — a compact due date for the calm (not-soon) case. */
function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/* Open tasks, most urgent first: anything with a due date sorts by that date
   ascending (overdue → soonest → later), and undated tasks trail, newest of
   those first. Stable so equal keys keep insertion order. */
export function sortTasks(tasks: readonly DashTask[]): DashTask[] {
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

/** Notices still wanting the viewer's attention — never read, or read at an
    older revision. Your own notices never count: you wrote them. */
export function unreadCount(notices: readonly NoticeWithRead[]): number {
  return notices.reduce((n, x) => n + (!x.mine && x.state !== "read" ? 1 : 0), 0);
}
