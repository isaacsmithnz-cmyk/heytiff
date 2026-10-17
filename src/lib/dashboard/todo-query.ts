/* HOME › TO DO — the reads it adds to the page (./todo is the pure half).

   Three were the bell's, and are its same queries (the reminders due, the
   work given to you); one counts what the old Home's notices card counted
   before it went (decision 28: a notice is in To do until read); one is
   the approvers' head count of timesheets sent in, as the claims and leave
   queues already are. Each is org- and person-scoped, and none throws: a
   read that fails is a row that isn't there, never a Home that is down. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import { firstNames } from "./home-list";
import { lateness } from "./reminders";
import { dueReminders } from "./reminders-query";
import { newAssignments } from "./assignments-query";
import { isCurrent } from "./notices";
import { EMPTY_TODO, type TodoExtras, type UnreadNotice } from "./todo";
import type { StaffNames } from "./tasks-query";

/** How far back an unread notice is looked for: the board's own window. */
const NOTICE_LOOK = 20;

/** Current notices someone else posted that you haven't read at their
    latest revision, newest first. */
export async function unreadNotices(
  orgId: string,
  staffProfileId: string,
  today: string,
  names?: StaffNames,
): Promise<UnreadNotice[]> {
  const { data, error } = await supabaseAdmin
    .from("notices")
    .select("id, title, posted_by, created_at, revision, expires_at, archived_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(NOTICE_LOOK);
  if (error || !data) return [];
  const rows = (data as Record<string, unknown>[])
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      postedBy: typeof r.posted_by === "string" ? r.posted_by : null,
      createdAt: String(r.created_at ?? ""),
      revision: Number(r.revision) || 1,
      expiresAt: r.expires_at ? String(r.expires_at).slice(0, 10) : null,
      archivedAt: r.archived_at ? String(r.archived_at) : null,
    }))
    .filter((n) => n.postedBy !== staffProfileId && isCurrent(n, today));
  if (rows.length === 0) return [];
  const { data: reads } = await supabaseAdmin
    .from("notice_reads")
    .select("notice_id, revision")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .in(
      "notice_id",
      rows.map((n) => n.id),
    );
  const read = new Map<string, number>();
  for (const r of (reads ?? []) as Record<string, unknown>[]) {
    read.set(String(r.notice_id), Math.max(read.get(String(r.notice_id)) ?? 0, Number(r.revision) || 0));
  }
  const first = names ? firstNames(names) : {};
  return rows
    .filter((n) => (read.get(n.id) ?? 0) < n.revision)
    .map((n) => ({
      id: n.id,
      title: n.title,
      from: n.postedBy ? (first[n.postedBy] ?? null) : null,
      day: n.createdAt.slice(0, 10),
    }));
}

/** Sheets sent in and waiting on an approver, the approver's own left out:
    nobody signs off their own hours. */
export async function pendingTimesheetCount(orgId: string, viewerStaffId: string | null): Promise<number> {
  let q = supabaseAdmin
    .from("timesheets")
    .select("staff_profile_id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "submitted");
  if (viewerStaffId) q = q.neq("staff_profile_id", viewerStaffId);
  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
}

/** Everything To do reads beyond what the page already holds. */
export async function loadTodoExtras(ctx: {
  orgId: string;
  viewerStaffId: string | null;
  caps: ReadonlySet<Capability>;
  today: string;
  names?: StaffNames;
  now?: Date;
}): Promise<TodoExtras> {
  const { orgId, viewerStaffId: staff, caps, today, names } = ctx;
  if (!staff) {
    return {
      ...EMPTY_TODO,
      timesheets: caps.has("approvals") ? await pendingTimesheetCount(orgId, null).catch(() => 0) : 0,
    };
  }
  const now = ctx.now ?? new Date();
  const [due, given, notices, timesheets] = await Promise.all([
    dueReminders(orgId, staff, now).catch(() => []),
    newAssignments(orgId, staff).catch(() => []),
    unreadNotices(orgId, staff, today, names).catch(() => []),
    caps.has("approvals") ? pendingTimesheetCount(orgId, staff).catch(() => 0) : Promise.resolve(0),
  ]);
  return {
    reminders: due.map((r) => ({ taskId: r.taskId, title: r.title, late: lateness(r.remindAt, now) })),
    assignments: given,
    notices,
    timesheets,
  };
}
