import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import type { MobileCtx } from "@/lib/mobile/auth";

/* A SWIPE ON A NOTIFICATION (Isaac, 11 November 2026: "Notifications, I want
   to have a swiping feature on those where you can swipe to the left or the
   right with actions", "Reminders may be ... a snooze thing", then "Yes,
   build it" to https://claude.ai/artifact/766ntHx3oPedW4oieP6f9b).

   Right is Done, left is Clear (Snooze on a reminder). A task's or a
   reminder's Done is the tick the phone's To do already makes
   (api/mobile/tasks/[id]), so it never comes here. What does:

     clear     off your list, nothing else touched (notification_clears);
               also a ServiceM8 ask's and declined leave's Done
     unclear   Undo of that
     read      a notice's Done: read, as the web's notice is
     unread    Undo of that
     snooze    a reminder, an hour on
     unsnooze  Undo of that, back to when it was (`at`)

   Yours alone: each write is scoped to your workspace and your staff card. */

export type NotificationAct = "clear" | "unclear" | "read" | "unread" | "snooze" | "unsnooze";
const ACTS: readonly NotificationAct[] = ["clear", "unclear", "read", "unread", "snooze", "unsnooze"];
const KINDS = ["task", "reminder", "mention", "notice", "leave"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 60 * 60_000;

type Done<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
const bad = (error: string, status = 400): Done<never> => ({ ok: false, error, status });

/** "notice:abc" → kind and the record's own id; the id after the first colon may hold colons (an ask's). */
export function parseNotificationId(raw: unknown): { id: string; kind: (typeof KINDS)[number]; rest: string } | null {
  if (typeof raw !== "string" || raw.length < 3 || raw.length > 200) return null;
  const at = raw.indexOf(":");
  const kind = raw.slice(0, at) as (typeof KINDS)[number];
  const rest = raw.slice(at + 1);
  if (at < 1 || !rest || !KINDS.includes(kind)) return null;
  return { id: raw, kind, rest };
}

/** The ids you've cleared, for the list to leave out. Empty where the table isn't there yet. */
export async function clearedIds(orgId: string, staffId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("notification_clears")
    .select("notification_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId);
  if (error || !data) return new Set();
  return new Set((data as { notification_id: string }[]).map((r) => r.notification_id));
}

export async function actOnNotification(ctx: MobileCtx, body: Record<string, unknown>): Promise<Done<{ at?: string }>> {
  const act = body.act as NotificationAct;
  if (!ACTS.includes(act)) return bad("Couldn't do that.");
  const n = parseNotificationId(body.id);
  if (!n) return bad("That notification has gone.", 404);
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return bad("You need a staff card in HeyTiff to have notifications.", 403);

  if (act === "clear") {
    const { error } = await supabaseAdmin
      .from("notification_clears")
      .upsert({ org_id: ctx.orgId, staff_profile_id: staffId, notification_id: n.id, cleared_at: new Date().toISOString() }, { onConflict: "staff_profile_id,notification_id" });
    if (error) {
      console.error("[notifications] clear", error.message);
      return bad("Couldn't clear that.", 500);
    }
    return { ok: true, value: {} };
  }
  if (act === "unclear") {
    const { error } = await supabaseAdmin.from("notification_clears").delete().eq("org_id", ctx.orgId).eq("staff_profile_id", staffId).eq("notification_id", n.id);
    if (error) return bad("Couldn't put that back.", 500);
    return { ok: true, value: {} };
  }

  if (act === "read" || act === "unread") {
    if (n.kind !== "notice" || !UUID.test(n.rest)) return bad("Only a notice is read.");
    if (act === "unread") {
      const { error } = await supabaseAdmin.from("notice_reads").delete().eq("org_id", ctx.orgId).eq("notice_id", n.rest).eq("staff_profile_id", staffId);
      if (error) return bad("Couldn't put that back.", 500);
      return { ok: true, value: {} };
    }
    const { data: notice } = await supabaseAdmin.from("notices").select("id, revision").eq("org_id", ctx.orgId).eq("id", n.rest).maybeSingle();
    if (!notice) return bad("That notice has gone.", 404);
    const { error } = await supabaseAdmin.from("notice_reads").upsert(
      { org_id: ctx.orgId, notice_id: n.rest, staff_profile_id: staffId, revision: Number((notice as { revision?: unknown }).revision) || 1, read_at: new Date().toISOString() },
      { onConflict: "notice_id,staff_profile_id" },
    );
    if (error) return bad("Couldn't mark that read.", 500);
    return { ok: true, value: {} };
  }

  // snooze, unsnooze: a reminder of yours that's still open
  if (n.kind !== "reminder" || !UUID.test(n.rest)) return bad("Only a reminder snoozes.");
  const { data: task } = await supabaseAdmin.from("tasks").select("assigned_to, status, remind_at").eq("org_id", ctx.orgId).eq("id", n.rest).maybeSingle();
  const t = task as { assigned_to: string; status: string; remind_at: string | null } | null;
  if (!t) return bad("That reminder has gone.", 404);
  if (t.assigned_to !== staffId) return bad("That reminder isn't yours.", 403);
  if (t.status === "done") return bad("That's already done.", 409);
  let next: string;
  if (act === "snooze") next = new Date(Date.now() + HOUR).toISOString();
  else {
    const at = typeof body.at === "string" ? new Date(body.at) : null;
    if (!at || Number.isNaN(at.getTime())) return bad("Couldn't put that back.");
    next = at.toISOString();
  }
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ remind_at: next, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", n.rest)
    .eq("assigned_to", staffId);
  if (error) return bad(act === "snooze" ? "Couldn't snooze that." : "Couldn't put that back.", 500);
  // what it was, for Undo; and when it comes back
  return { ok: true, value: { at: act === "snooze" ? (t.remind_at ?? undefined) : next } };
}
