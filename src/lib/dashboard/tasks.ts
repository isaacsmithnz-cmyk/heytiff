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
  postedByName: string | null;
  createdAt: string;
};

/** A notice plus whether the viewer has acknowledged it. */
export type NoticeWithRead = NoticeItem & { read: boolean };

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

/** How many notices the viewer hasn't acknowledged yet. */
export function unreadCount(notices: readonly NoticeWithRead[]): number {
  return notices.reduce((n, x) => n + (x.read ? 0 : 1), 0);
}
