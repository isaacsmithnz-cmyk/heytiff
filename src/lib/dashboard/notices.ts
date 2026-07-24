import { daysUntil } from "@/components/fleet/logic";
import type { DueState, NoticeKind, NoticeWithRead } from "./tasks";

/* The noticeboard's lifecycle rules — what a post IS, and whether it's still
   current. Pure, so the "is this expired" question is decided in one place and
   unit-tested without a database or a clock.

   EXPIRY IS DERIVED, NEVER STORED. `expires_at` is an inclusive date: the
   notice is current up to and including that day, and drops off the board the
   day after. Nothing sweeps the table — no cron, no status column to fall out
   of step with the calendar — so every reader sees the same answer computed
   from the same today.

   ARCHIVING IS A DECISION. `archived_at` is someone taking a post off the
   board early, or filing one that's done with. Both an expired and an archived
   post land in the same Archived section, because to a reader they mean the
   same thing (not current), but the two are recorded separately: the calendar
   made one of them stale, a person made the other. */

export type { NoticeKind };

export const NOTICE_KINDS: readonly NoticeKind[] = ["notice", "poll", "event"];

/** Narrow an untrusted value (DB text, form field) to a kind, defaulting to
    the plain notice — an unknown kind must never crash a board. */
export function asNoticeKind(value: unknown): NoticeKind {
  return NOTICE_KINDS.includes(value as NoticeKind) ? (value as NoticeKind) : "notice";
}

/** What each kind is called on screen. */
export const KIND_LABEL: Record<NoticeKind, string> = {
  notice: "Notice",
  poll: "Poll",
  event: "Event",
};

export type NoticeLifecycle = "active" | "expired" | "archived";

export type Lifecycled = {
  expiresAt: string | null;
  archivedAt: string | null;
};

/* Archiving wins over expiry: someone chose to file it, and that reason is
   the truer one to show even if the date had also passed. */
export function noticeLifecycle(n: Lifecycled, today: string): NoticeLifecycle {
  if (n.archivedAt) return "archived";
  if (n.expiresAt && daysUntil(n.expiresAt, today) < 0) return "expired";
  return "active";
}

/** True while the post still belongs on the board. */
export function isCurrent(n: Lifecycled, today: string): boolean {
  return noticeLifecycle(n, today) === "active";
}

/* The expiry chip, or null when the post never expires. Mirrors dueLabel's
   urgency vocabulary so a date on a notice reads like a date on a task. */
export function expiryLabel(
  expiresAt: string | null,
  today: string,
): { label: string; state: DueState } | null {
  if (!expiresAt) return null;
  const days = daysUntil(expiresAt, today);
  if (days < 0) return { label: `Expired ${fmtDate(expiresAt)}`, state: "bad" };
  if (days === 0) return { label: "Last day", state: "warn" };
  if (days === 1) return { label: "Until tomorrow", state: "warn" };
  if (days <= 7) return { label: `${days} days left`, state: "warn" };
  return { label: `Until ${fmtDate(expiresAt)}`, state: "ok" };
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

/* Split a sorted board into what's on it and what's behind it. Order within
   each half is preserved, so whatever sortNotices decided still holds. */
export function partitionNotices<T extends Lifecycled>(
  notices: readonly T[],
  today: string,
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const n of notices) (isCurrent(n, today) ? active : archived).push(n);
  return { active, archived };
}

/* Only CURRENT notices can be unread. An announcement that expired before you
   opened the board is not something you're behind on — badging it would be
   asking people to catch up on the past. */
export function currentUnreadCount(
  notices: readonly (NoticeWithRead & Lifecycled)[],
  today: string,
): number {
  return notices.reduce(
    (n, x) => n + (!x.mine && x.state !== "read" && isCurrent(x, today) ? 1 : 0),
    0,
  );
}
