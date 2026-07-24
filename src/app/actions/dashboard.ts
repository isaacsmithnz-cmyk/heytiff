"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";

/* Dashboard mutations — tasks and the noticeboard.

   The UI is never the control; every rule is re-decided here.

     ASSIGN / POST   creating a task for someone, or posting a notice, needs
                     `team`. It's a management action about other people.
     COMPLETE        finishing a task is intrinsic to the person it's assigned
                     to (it's their to-do); a `team` holder can also close one.
     ACK             acknowledging a notice is intrinsic — it's your own read.
*/

export type DashResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

const refresh = () => revalidatePath("/dashboard");

const isISODate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ---------------- tasks ---------------- */

export async function createTask(input: {
  assignedTo: string;
  title: string;
  detail?: string;
  dueDate?: string;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't assign tasks." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a title." };
  if (input.dueDate && !isISODate(input.dueDate)) return { ok: false, error: "Check the due date." };

  // the assignee must belong to this org — scoped lookup, never id alone
  const { data: target } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", input.assignedTo)
    .maybeSingle();
  if (!target) return { ok: false, error: "That person isn't in this organisation." };

  const { error } = await supabaseAdmin.from("tasks").insert({
    org_id: ctx.orgId,
    title: title.slice(0, 200),
    detail: input.detail?.trim().slice(0, 1000) || null,
    assigned_to: input.assignedTo,
    created_by: ctx.staffId,
    due_date: input.dueDate || null,
    status: "open",
  });
  if (error) return { ok: false, error: "Couldn't create that task." };
  refresh();
  return { ok: true };
}

export async function completeTask(taskId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status")
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status === "done") return { ok: false, error: "That task is already done." };

  // your own to-do, or a manager closing one out
  const mine = ctx.staffId && ctx.staffId === data.assigned_to;
  if (!mine && !(await can("team"))) return { ok: false, error: "That task isn't yours to complete." };

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      done_by: ctx.staffId,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't complete that task." };
  refresh();
  return { ok: true };
}

/** Undo a completion. Same rule as completing it: your own task, or `team`.
    Completing is a single tap, so it has to be reversible. */
export async function reopenTask(taskId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status")
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task no longer exists." };
  if (data.status !== "done") return { ok: false, error: "That task is already open." };

  const mine = ctx.staffId && ctx.staffId === data.assigned_to;
  if (!mine && !(await can("team"))) return { ok: false, error: "That task isn't yours to reopen." };

  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ status: "open", done_at: null, done_by: null, updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't reopen that task." };
  refresh();
  return { ok: true };
}

/* ---------------- notices ---------------- */

export async function postNotice(input: {
  title: string;
  body?: string;
  pinned?: boolean;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't post notices." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the notice a title." };

  const { data, error } = await supabaseAdmin
    .from("notices")
    .insert({
      org_id: ctx.orgId,
      title: title.slice(0, 200),
      body: input.body?.trim().slice(0, 2000) || null,
      posted_by: ctx.staffId,
      pinned: input.pinned === true,
    })
    .select("id, revision")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't post that notice." };

  // The author has, by definition, read their own notice — record the ack up
  // front so notice_reads stays the single source of truth for "who has read
  // this" and the author is never prompted to acknowledge their own words.
  if (ctx.staffId) {
    await supabaseAdmin.from("notice_reads").upsert(
      {
        org_id: ctx.orgId,
        notice_id: data.id as string,
        staff_profile_id: ctx.staffId,
        revision: Number(data.revision) || 1,
        read_at: new Date().toISOString(),
      },
      { onConflict: "notice_id,staff_profile_id" },
    );
  }
  refresh();
  return { ok: true };
}

/* Editing is the AUTHOR's alone. A `team` holder can remove a notice but not
   silently reword one that still carries someone else's byline.

   Acks are never cleared — they're versioned. A change to the title or body
   bumps the revision (and stamps edited_at), so anyone who acknowledged the
   older wording now reads as "stale" rather than being silently counted as
   having seen text they never saw. Pinning is not a reword, so it leaves the
   revision alone. */
export async function editNotice(input: {
  noticeId: string;
  title: string;
  body?: string;
  pinned?: boolean;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the notice a title." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("posted_by, title, body, revision")
    .eq("org_id", ctx.orgId)
    .eq("id", input.noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That notice no longer exists." };
  if (data.posted_by !== ctx.staffId)
    return { ok: false, error: "Only whoever posted a notice can edit it." };

  const nextTitle = title.slice(0, 200);
  const nextBody = input.body?.trim().slice(0, 2000) || null;
  const reworded = nextTitle !== data.title || nextBody !== (data.body ?? null);
  const revision = (Number(data.revision) || 1) + (reworded ? 1 : 0);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("notices")
    .update({
      title: nextTitle,
      body: nextBody,
      pinned: input.pinned === true,
      revision,
      ...(reworded ? { edited_at: now } : {}),
      updated_at: now,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", input.noticeId);
  if (error) return { ok: false, error: "Couldn't save that notice." };

  // the author has read what they just wrote — carry their ack to the new revision
  if (reworded) {
    await supabaseAdmin.from("notice_reads").upsert(
      {
        org_id: ctx.orgId,
        notice_id: input.noticeId,
        staff_profile_id: ctx.staffId,
        revision,
        read_at: now,
      },
      { onConflict: "notice_id,staff_profile_id" },
    );
  }
  refresh();
  return { ok: true };
}

/** Remove a notice — the author, or anyone with `team` (moderation). Acks go
    with it via the notice_reads cascade. */
export async function deleteNotice(noticeId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("posted_by")
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That notice no longer exists." };

  const mine = ctx.staffId && ctx.staffId === data.posted_by;
  if (!mine && !(await can("team")))
    return { ok: false, error: "You can't remove that notice." };

  const { error } = await supabaseAdmin
    .from("notices")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId);
  if (error) return { ok: false, error: "Couldn't remove that notice." };
  refresh();
  return { ok: true };
}

/* Reading is passive — the client reports which notices have actually been on
   the reader's screen and this records them, at the revision they're currently
   showing. Intrinsic (it's your own read), idempotent, and bulk so a screenful
   costs one round trip.

   Deliberately does NOT revalidate: marking read is a side effect of looking at
   the page, and refreshing it underneath the reader mid-scroll would be worse
   than letting the receipt appear on their next load. */
export async function markNoticesRead(noticeIds: string[]): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  const ids = [...new Set(noticeIds)].filter(Boolean).slice(0, 50);
  if (ids.length === 0) return { ok: true };

  // only notices in this org, and read at the revision actually on show
  const { data } = await supabaseAdmin
    .from("notices")
    .select("id, revision, posted_by")
    .eq("org_id", ctx.orgId)
    .in("id", ids);
  const rows = ((data ?? []) as Record<string, unknown>[])
    // you don't "read" your own notice — that receipt is written when you post
    .filter((r) => r.posted_by !== ctx.staffId)
    .map((r) => ({
      org_id: ctx.orgId,
      notice_id: String(r.id),
      staff_profile_id: ctx.staffId,
      revision: Number(r.revision) || 1,
      read_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return { ok: true };

  const { error } = await supabaseAdmin
    .from("notice_reads")
    .upsert(rows, { onConflict: "notice_id,staff_profile_id" });
  if (error) return { ok: false, error: "Couldn't record that." };
  return { ok: true };
}
