import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { newAssignments } from "@/lib/dashboard/assignments-query";
import { dueReminders } from "@/lib/dashboard/reminders-query";
import { unreadNotices } from "@/lib/dashboard/todo-query";
import { listMyMentions } from "@/lib/dashboard/mentions-query";
import { ownDeclinedLeave } from "@/lib/timepay/leave-query";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import type { MobileCtx } from "@/lib/mobile/auth";

/* WHAT THE PHONE TELLS YOU (Isaac, 26 October 2026: "build out the
   notifications in general so I can see how native apps look").

   The things that are yours to hear about, from the loaders Home's To do
   already reads, each turned into one notification: a task someone gave
   you, a reminder that has come due, a ServiceM8 note that asks you
   something, a notice you haven't read, and leave that was declined. Each
   says where it opens on the phone (`path`), so a tap never lands on a
   blank screen.

   Your reminders still to come travel too (`upcoming`): the phone puts each
   on its own clock, so it arrives at its time with no signal.

   Session-free, read for the context the phone's token check made; every
   loader is your own workspace's and your own staff card's. */

export type MobileNotification = {
  /** Stable, so the phone knows one it has shown: `${kind}:${id}`. */
  id: string;
  kind: "task" | "reminder" | "mention" | "notice" | "leave";
  title: string;
  body: string | null;
  /** ISO instant: when it happened, or came due. */
  at: string;
  /** Where it opens on the phone; null opens the list. */
  path: string | null;
};

export type UpcomingReminder = { id: string; title: string; body: string | null; at: string; path: string | null };

export type MobileNotifications = { items: MobileNotification[]; upcoming: UpcomingReminder[] };

const LOOK_BACK_DAYS = 14;
const MAX_ITEMS = 50;
const UPCOMING_DAYS = 14;

const dayAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000).toISOString();

/** A wall-clock stamp on the account's clock ("2026-10-21 20:58:43", or a
    bare day) as the instant it was, so it sorts beside the true instants. */
export function wallToIso(naive: string, tz: string): string {
  const [d, t = "00:00:00"] = naive.trim().split(/[ T]/);
  const guess = new Date(`${d}T${(t + ":00:00").slice(0, 8)}Z`);
  if (Number.isNaN(guess.getTime())) return naive;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}

/** A leave span in words: "Mon 2 Nov", or "Mon 2 – Fri 6 Nov". */
function span(start: string, end: string): string {
  const fmt = (iso: string, withMonth: boolean) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const wd = d.toLocaleDateString("en-AU", { weekday: "short", timeZone: "UTC" });
    const mon = d.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" });
    return `${wd} ${d.getUTCDate()}${withMonth ? ` ${mon}` : ""}`;
  };
  return start === end ? fmt(start, true) : `${fmt(start, start.slice(5, 7) !== end.slice(5, 7))} – ${fmt(end, true)}`;
}

/** Reminders still to come for this person, soonest first. */
async function upcomingReminders(orgId: string, staffId: string, now: Date): Promise<UpcomingReminder[]> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select("id, title, detail, remind_at")
    .eq("org_id", orgId)
    .eq("assigned_to", staffId)
    .eq("status", "open")
    .gt("remind_at", now.toISOString())
    .lte("remind_at", new Date(now.getTime() + UPCOMING_DAYS * 86_400_000).toISOString())
    .order("remind_at", { ascending: true })
    .limit(40);
  if (error || !data) return [];
  return (data as { id: string; title: string | null; detail: string | null; remind_at: string }[]).map((t) => ({
    id: t.id,
    title: t.title?.trim() || "A reminder",
    body: t.detail?.trim() || null,
    at: t.remind_at,
    path: "/notifications",
  }));
}

/** Everything the phone tells this person now, newest first, and their reminders to come. */
export async function notificationsFor(ctx: MobileCtx, now: Date = new Date()): Promise<MobileNotifications> {
  const { data: card } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const staffId = (card as { id: string } | null)?.id ?? null;
  if (!staffId) return { items: [], upcoming: [] };

  const tz = (await getSm8Timezone(ctx.orgId)) || "Australia/Sydney";
  const today = todayInZone(tz);
  const since = dayAgo(LOOK_BACK_DAYS, now);
  /* ServiceM8 asks only where you can see the board and are linked to your ServiceM8 person */
  const mineUuid = ctx.caps.has("workboard")
    ? await sm8StaffLinkMap(ctx.orgId)
        .then((links) => [...links.entries()].find(([, id]) => id === staffId)?.[0] ?? null)
        .catch(() => null)
    : null;

  const [tasks, due, notices, asks, declined, upcoming] = await Promise.all([
    newAssignments(ctx.orgId, staffId).catch(() => []),
    dueReminders(ctx.orgId, staffId, now).catch(() => []),
    unreadNotices(ctx.orgId, staffId, today).catch(() => []),
    mineUuid ? listMyMentions(ctx.orgId, mineUuid, today, { staffId }).catch(() => []) : Promise.resolve([]),
    ownDeclinedLeave(ctx.orgId, staffId, since.slice(0, 10)).catch(() => []),
    upcomingReminders(ctx.orgId, staffId, now).catch(() => []),
  ]);

  const items: MobileNotification[] = [
    ...tasks.map((t) => ({
      id: `task:${t.taskId}`,
      kind: "task" as const,
      title: t.fromName ? `${t.fromName} gave you a task` : "A task for you",
      body: t.title,
      at: t.createdAt,
      path: null,
    })),
    ...due.map((r) => ({
      id: `reminder:${r.taskId}`,
      kind: "reminder" as const,
      title: r.title,
      body: r.detail,
      at: r.remindAt,
      path: null,
    })),
    ...asks
      .filter((c) => !c.answered && c.lastTheirs >= since.slice(0, 10))
      .map((c) => {
        const last = [...c.messages].reverse().find((m) => m.from === "them");
        return {
          id: `mention:${c.key}`,
          kind: "mention" as const,
          title: c.jobLabel ? `${c.asker.name} on ${c.jobLabel}` : `${c.asker.name} asked you`,
          body: last?.text?.trim() || null,
          at: wallToIso(c.lastTheirs, tz),
          path: `/job?id=${encodeURIComponent(c.jobUuid)}`,
        };
      }),
    ...notices.map((n) => ({
      id: `notice:${n.id}`,
      kind: "notice" as const,
      title: n.from ? `${n.from} posted a notice` : "A new notice",
      body: n.title,
      at: wallToIso(n.day, tz),
      path: null,
    })),
    ...declined.map((l) => ({
      id: `leave:${l.id}`,
      kind: "leave" as const,
      title: "Your leave was declined",
      body: `${l.kind[0]?.toUpperCase() ?? ""}${l.kind.slice(1)} leave, ${span(l.startDate, l.endDate)}`,
      at: l.decidedOn ?? wallToIso(l.startDate, tz),
      path: "/leave",
    })),
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { items: items.slice(0, MAX_ITEMS), upcoming };
}
