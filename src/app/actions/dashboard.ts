"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { asNoticeKind, noticeLifecycle } from "@/lib/dashboard/notices";
import { cleanPollOptions, POLL_ERROR_TEXT } from "@/lib/dashboard/polls";
import { asRsvpAnswer, isEventTime } from "@/lib/dashboard/events";
import { asReaction } from "@/lib/dashboard/reactions";
import { mentionedIds, MAX_COMMENT } from "@/lib/dashboard/comments";
import { mentionableStaff, pollOptionIds } from "@/lib/dashboard/tasks-query";
import { MAX_NOTICE_FILES, refIsOrgs } from "@/lib/documents/files";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { todayInAu } from "@/lib/au-dates";

/* Dashboard mutations — tasks and the noticeboard.

   The UI is never the control; every rule is re-decided here.

     ASSIGN / POST   creating a task for someone, or posting a notice, needs
                     `team`. It's a management action about other people.
     COMPLETE        finishing a task is intrinsic to the person it's assigned
                     to (it's their to-do); a `team` holder can also close one.
     DELETE          erasing a task belongs to whoever CREATED it (or `team`).
                     Narrower than complete on purpose: finishing your
                     assignment is yours; erasing the record that someone
                     assigned it is not.
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

/* Attaching already-uploaded files to a notice.

   The composer uploads as you pick, before the notice exists, so the files
   arrive unattached and are CLAIMED here once there's something to attach them
   to. Every condition is re-checked: in this org, the right kind, uploaded by
   the person now claiming them, actually finished, and not already on another
   notice. An id on its own proves nothing. */
async function claimDocuments(
  ctx: Ctx,
  noticeId: string,
  documentIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(documentIds)].filter(Boolean);
  if (ids.length === 0 || !ctx.staffId) return;

  /* The cap is on the NOTICE, not on the request. Editing claims only the files
     added this time round, so slicing the incoming list let six more through on
     every save — an unbounded pile, six at a time. Count what is already on the
     post and take only the room that is actually left. */
  const { count } = await supabaseAdmin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("notice_id", noticeId);

  const room = MAX_NOTICE_FILES - (count ?? 0);
  if (room <= 0) return;

  await supabaseAdmin
    .from("documents")
    .update({ notice_id: noticeId })
    .eq("org_id", ctx.orgId)
    .eq("kind", "notice_attachment")
    .eq("uploaded_by", ctx.staffId)
    .is("notice_id", null)
    .not("uploaded_at", "is", null)
    .in("id", ids.slice(0, room));
}

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

/** Remove a task outright — its CREATOR, or `team`. Deliberately narrower than
    complete/reopen, which also allow the assignee: finishing your assignment is
    intrinsic to you, erasing someone else's record of having assigned it is
    not. A hard delete (no table references tasks), and the one task action
    with no undo — which is why the UI asks twice before calling it. */
export async function deleteTask(taskId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("tasks")
    .select("created_by")
    .eq("org_id", ctx.orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That task is already gone." };

  const mine = ctx.staffId && ctx.staffId === data.created_by;
  if (!mine && !(await can("team"))) return { ok: false, error: "That task isn't yours to delete." };

  const { error } = await supabaseAdmin
    .from("tasks")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", taskId);
  if (error) return { ok: false, error: "Couldn't delete that task." };
  refresh();
  return { ok: true };
}

/* ---------------- notices ---------------- */

export async function postNotice(input: {
  title: string;
  body?: string;
  pinned?: boolean;
  kind?: string;
  /** Inclusive last day on the board, ISO yyyy-mm-dd. */
  expiresAt?: string | null;
  /** kind === "poll" only: the answers, in the order they were typed. */
  options?: string[];
  /** kind === "poll" only: more than one answer allowed. */
  multi?: boolean;
  /** kind === "event" only. Date is required; time is "HH:MM" or absent. */
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  /** Files already uploaded by this person and not yet on a notice. */
  documentIds?: string[];
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't post notices." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the notice a title." };
  if (input.expiresAt && !isISODate(input.expiresAt))
    return { ok: false, error: "Check the expiry date." };

  // an unrecognised kind is narrowed, never rejected — the column's CHECK is
  // the backstop, this keeps a stale client from erroring
  const kind = asNoticeKind(input.kind);

  // A poll with no answers is a notice with a question mark, so the answers
  // are validated BEFORE the notice row exists — no half-built poll on the
  // board if the second insert fails.
  let options: string[] = [];
  if (kind === "poll") {
    const cleaned = cleanPollOptions(input.options ?? []);
    if (!cleaned.ok) return { ok: false, error: POLL_ERROR_TEXT[cleaned.error] };
    options = cleaned.options;
  }

  const eventTime = input.eventTime?.trim() || null;
  if (kind === "event") {
    if (!input.eventDate || !isISODate(input.eventDate))
      return { ok: false, error: "An event needs a date." };
    if (eventTime && !isEventTime(eventTime)) return { ok: false, error: "Check the start time." };
  }

  // An event comes off the board once it's happened, unless the poster said
  // otherwise. Nobody wants last Tuesday's toolbox talk at the top of the board
  // on Wednesday, and asking them to set an expiry that always equals the event
  // date would be asking them to say the same thing twice.
  const expiresAt =
    input.expiresAt || (kind === "event" ? (input.eventDate ?? null) : null) || null;

  const { data, error } = await supabaseAdmin
    .from("notices")
    .insert({
      org_id: ctx.orgId,
      title: title.slice(0, 200),
      body: input.body?.trim().slice(0, 2000) || null,
      posted_by: ctx.staffId,
      pinned: input.pinned === true,
      kind,
      expires_at: expiresAt,
      poll_multi: kind === "poll" && input.multi === true,
      event_date: kind === "event" ? input.eventDate : null,
      event_time: kind === "event" ? eventTime : null,
      event_location: kind === "event" ? input.eventLocation?.trim().slice(0, 200) || null : null,
    })
    .select("id, revision")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't post that notice." };

  if (options.length > 0) {
    const { error: optErr } = await supabaseAdmin.from("notice_poll_options").insert(
      options.map((label, i) => ({
        org_id: ctx.orgId,
        notice_id: data.id as string,
        label,
        position: i,
      })),
    );
    // an answerless poll is worse than no poll — take the notice back out
    if (optErr) {
      await supabaseAdmin.from("notices").delete().eq("org_id", ctx.orgId).eq("id", data.id as string);
      return { ok: false, error: "Couldn't post that poll." };
    }
  }

  await claimDocuments(ctx, data.id as string, input.documentIds ?? []);

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
   revision alone.

   MOVING AN EVENT COUNTS AS REWORDING IT. "Friday 7am at the depot" is what
   people said yes to; changing the day, the time or the place changes the thing
   they agreed to, so it bumps the revision exactly like changing the text
   would. Their RSVP is kept — they're still coming unless they say otherwise —
   but they drop out of the read count until they've seen the new details. */
export async function editNotice(input: {
  noticeId: string;
  title: string;
  body?: string;
  pinned?: boolean;
  expiresAt?: string | null;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  /** Files added while editing — the ones already on it stay put. */
  documentIds?: string[];
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the notice a title." };
  if (input.expiresAt && !isISODate(input.expiresAt))
    return { ok: false, error: "Check the expiry date." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("posted_by, title, body, revision, kind, event_date, event_time, event_location")
    .eq("org_id", ctx.orgId)
    .eq("id", input.noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That notice no longer exists." };
  if (data.posted_by !== ctx.staffId)
    return { ok: false, error: "Only whoever posted a notice can edit it." };

  const isEvent = data.kind === "event";
  const nextEventTime = input.eventTime?.trim() || null;
  if (isEvent) {
    if (!input.eventDate || !isISODate(input.eventDate))
      return { ok: false, error: "An event needs a date." };
    if (nextEventTime && !isEventTime(nextEventTime))
      return { ok: false, error: "Check the start time." };
  }
  const nextEventLocation = isEvent ? input.eventLocation?.trim().slice(0, 200) || null : null;
  const eventMoved =
    isEvent &&
    (input.eventDate !== String(data.event_date ?? "").slice(0, 10) ||
      nextEventTime !== (data.event_time ? String(data.event_time).slice(0, 5) : null) ||
      nextEventLocation !== (data.event_location ?? null));

  const nextTitle = title.slice(0, 200);
  const nextBody = input.body?.trim().slice(0, 2000) || null;
  const reworded =
    nextTitle !== data.title || nextBody !== (data.body ?? null) || eventMoved;
  const revision = (Number(data.revision) || 1) + (reworded ? 1 : 0);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("notices")
    .update({
      title: nextTitle,
      body: nextBody,
      pinned: input.pinned === true,
      ...(isEvent
        ? {
            event_date: input.eventDate,
            event_time: nextEventTime,
            event_location: nextEventLocation,
          }
        : {}),
      // changing WHEN it comes down is not a change to WHAT IT SAYS, so it
      // leaves the revision (and everyone's read receipt) alone
      expires_at: input.expiresAt || null,
      revision,
      ...(reworded ? { edited_at: now } : {}),
      updated_at: now,
    })
    .eq("org_id", ctx.orgId)
    .eq("id", input.noticeId);
  if (error) return { ok: false, error: "Couldn't save that notice." };

  await claimDocuments(ctx, input.noticeId, input.documentIds ?? []);

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

/* Answering a poll is INTRINSIC — no capability. Posting the question is a
   management act; having an opinion about Friday is not.

   The whole answer is sent every time and replaces whatever was there, so
   changing your mind is the same operation as answering, and an empty list
   retracts. That also makes the action idempotent: a double-tap or a retry
   lands on the same rows rather than doubling a vote.

   A poll that has expired or been archived is CLOSED. The board still shows
   the result, but the tally stops moving — otherwise "who's coming Friday"
   keeps changing after Friday. */
export async function castPollVote(
  noticeId: string,
  optionIds: string[],
): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("kind, poll_multi, expires_at, archived_at")
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That poll no longer exists." };
  if (data.kind !== "poll") return { ok: false, error: "That notice isn't a poll." };

  const lifecycle = noticeLifecycle(
    {
      expiresAt: data.expires_at ? String(data.expires_at).slice(0, 10) : null,
      archivedAt: data.archived_at ? String(data.archived_at) : null,
    },
    todayInAu(),
  );
  if (lifecycle !== "active") return { ok: false, error: "That poll has closed." };

  const picks = [...new Set(optionIds)].filter(Boolean);
  if (data.poll_multi !== true && picks.length > 1)
    return { ok: false, error: "This poll takes one answer." };

  // every pick must be an answer ON THIS POLL, in this org — an id alone
  // proves nothing
  const valid = new Set(await pollOptionIds(ctx.orgId, noticeId));
  if (picks.some((id) => !valid.has(id)))
    return { ok: false, error: "That answer isn't on this poll." };

  // replace, don't merge: the submitted list IS the answer
  const { error: clearErr } = await supabaseAdmin
    .from("notice_poll_votes")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("notice_id", noticeId)
    .eq("staff_profile_id", ctx.staffId);
  if (clearErr) return { ok: false, error: "Couldn't record that vote." };

  if (picks.length > 0) {
    const { error } = await supabaseAdmin.from("notice_poll_votes").insert(
      picks.map((optionId) => ({
        org_id: ctx.orgId,
        notice_id: noticeId,
        option_id: optionId,
        staff_profile_id: ctx.staffId,
      })),
    );
    if (error) return { ok: false, error: "Couldn't record that vote." };
  }
  refresh();
  return { ok: true };
}

/* Saying whether you're coming. Intrinsic, like voting — and like voting, the
   answer replaces itself, with null meaning "I take it back".

   An event stays open until it's OVER, not until it expires: the expiry is
   normally the event's own date, so cutting RSVPs off at expiry would close the
   list on the morning of the thing. Archiving still closes it — that's a person
   saying it's done with. */
export async function setRsvp(noticeId: string, answer: string | null): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("kind, event_date, archived_at")
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That event no longer exists." };
  if (data.kind !== "event") return { ok: false, error: "That notice isn't an event." };
  if (data.archived_at) return { ok: false, error: "That event has been filed away." };

  const eventDate = data.event_date ? String(data.event_date).slice(0, 10) : null;
  if (eventDate && eventDate < todayInAu())
    return { ok: false, error: "That event has already happened." };

  if (answer === null) {
    const { error } = await supabaseAdmin
      .from("notice_rsvps")
      .delete()
      .eq("org_id", ctx.orgId)
      .eq("notice_id", noticeId)
      .eq("staff_profile_id", ctx.staffId);
    if (error) return { ok: false, error: "Couldn't record that." };
    refresh();
    return { ok: true };
  }

  const valid = asRsvpAnswer(answer);
  if (!valid) return { ok: false, error: "That isn't an answer to this event." };

  const { error } = await supabaseAdmin.from("notice_rsvps").upsert(
    {
      org_id: ctx.orgId,
      notice_id: noticeId,
      staff_profile_id: ctx.staffId,
      answer: valid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "notice_id,staff_profile_id" },
  );
  if (error) return { ok: false, error: "Couldn't record that." };
  refresh();
  return { ok: true };
}

/* Commenting. Intrinsic — a noticeboard where only management may speak is a
   pinboard, and the whole point of this shape is that people can reply.

   THREADING IS ONE LEVEL. A reply to a reply is re-parented to the comment that
   stands on the notice, so a conversation can't disappear three indents deep.

   MENTIONS ARE RESOLVED HERE, ONCE. The body is stored as the person typed it;
   who they meant is worked out against this org's own staff list and written as
   rows. A later rename can't re-point an old mention at somebody else, and the
   same matcher paints the highlight on screen, so what was recorded and what is
   shown can never drift apart. */
export async function commentOnNotice(input: {
  noticeId: string;
  body: string;
  /** The comment being replied to, if any. */
  parentId?: string | null;
}): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const body = input.body.trim().slice(0, MAX_COMMENT);
  if (!body) return { ok: false, error: "Write something first." };

  const { data: notice } = await supabaseAdmin
    .from("notices")
    .select("id, archived_at")
    .eq("org_id", ctx.orgId)
    .eq("id", input.noticeId)
    .maybeSingle();
  if (!notice) return { ok: false, error: "That notice no longer exists." };
  if (notice.archived_at) return { ok: false, error: "That notice has been filed away." };

  // the parent must be a comment on THIS notice, and a reply to a reply joins
  // the thread it's in rather than starting a third level
  let parentId: string | null = null;
  if (input.parentId) {
    const { data: parent } = await supabaseAdmin
      .from("notice_comments")
      .select("id, parent_id, notice_id")
      .eq("org_id", ctx.orgId)
      .eq("id", input.parentId)
      .maybeSingle();
    if (!parent || parent.notice_id !== input.noticeId)
      return { ok: false, error: "That reply has nothing to reply to." };
    parentId = (parent.parent_id as string) ?? (parent.id as string);
  }

  const { data, error } = await supabaseAdmin
    .from("notice_comments")
    .insert({
      org_id: ctx.orgId,
      notice_id: input.noticeId,
      parent_id: parentId,
      author_id: ctx.staffId,
      body,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: "Couldn't post that comment." };

  const mentions = mentionedIds(body, await mentionableStaff(ctx.orgId));
  if (mentions.length > 0) {
    // a mention that fails to record is not worth losing the comment over —
    // the words are already up, and the highlight still renders from the text
    await supabaseAdmin.from("notice_comment_mentions").insert(
      mentions.map((staffId) => ({
        org_id: ctx.orgId,
        comment_id: data.id as string,
        notice_id: input.noticeId,
        staff_profile_id: staffId,
      })),
    );
  }
  refresh();
  return { ok: true };
}

/** Remove a comment — its author, or anyone with `team` (moderation). A thread
    goes with the comment that opened it, via the parent cascade. */
export async function deleteComment(commentId: string): Promise<DashResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const { data } = await supabaseAdmin
    .from("notice_comments")
    .select("author_id")
    .eq("org_id", ctx.orgId)
    .eq("id", commentId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That comment is already gone." };

  const mine = ctx.staffId && ctx.staffId === data.author_id;
  if (!mine && !(await can("team"))) return { ok: false, error: "That comment isn't yours." };

  const { error } = await supabaseAdmin
    .from("notice_comments")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", commentId);
  if (error) return { ok: false, error: "Couldn't remove that comment." };
  refresh();
  return { ok: true };
}

/* Reacting. Intrinsic, one per person, and null takes it back.

   Deliberately NOT gated on the lifecycle. Voting on a closed poll would
   corrupt a result and RSVPing to a past event would be a lie, but a 🙏 on
   something that has already come off the board is just someone reading the
   archive and saying thanks — there is nothing there to get wrong. */
export async function reactToNotice(noticeId: string, emoji: string | null): Promise<DashResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("notices")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That notice no longer exists." };

  if (emoji === null) {
    const { error } = await supabaseAdmin
      .from("notice_reactions")
      .delete()
      .eq("org_id", ctx.orgId)
      .eq("notice_id", noticeId)
      .eq("staff_profile_id", ctx.staffId);
    if (error) return { ok: false, error: "Couldn't record that." };
    refresh();
    return { ok: true };
  }

  const valid = asReaction(emoji);
  if (!valid) return { ok: false, error: "That isn't one of the reactions." };

  const { error } = await supabaseAdmin.from("notice_reactions").upsert(
    {
      org_id: ctx.orgId,
      notice_id: noticeId,
      staff_profile_id: ctx.staffId,
      emoji: valid,
    },
    { onConflict: "notice_id,staff_profile_id" },
  );
  if (error) return { ok: false, error: "Couldn't record that." };
  refresh();
  return { ok: true };
}

/* Take a notice off the board without destroying it — the gentler half of
   Remove, and the one that should be reached for first. Same permission as
   removal (the author, or `team` moderating), because it's the same decision
   made reversibly. Archiving is deliberately NOT the same thing as expiring:
   expiry is the calendar, this is a person. */
export async function setNoticeArchived(
  noticeId: string,
  archived: boolean,
): Promise<DashResult> {
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
    return { ok: false, error: "You can't file that notice away." };

  const { error } = await supabaseAdmin
    .from("notices")
    .update({
      archived_at: archived ? new Date().toISOString() : null,
      archived_by: archived ? ctx.staffId : null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId);
  if (error) return { ok: false, error: "Couldn't file that notice away." };
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

  /* Take the attachments out of the bucket FIRST. `documents.notice_id` is
     ON DELETE CASCADE, so dropping the notice drops the rows that name the
     objects — and an object no row points at is unreachable but still billable,
     exactly what deleteDocument() goes out of its way to avoid. Done before the
     delete because afterwards there is nothing left to read the refs from. */
  await removeNoticeFiles(ctx.orgId, noticeId);

  const { error } = await supabaseAdmin
    .from("notices")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("id", noticeId);
  if (error) return { ok: false, error: "Couldn't remove that notice." };
  refresh();
  return { ok: true };
}

/* The stored objects behind a notice's attachments. Kept separate so the
   cascade's blind spot is closed in one named place; a failure here is logged
   and swallowed, because leaving a billable object behind is a smaller harm
   than refusing to let someone delete their own post. */
async function removeNoticeFiles(orgId: string, noticeId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("storage_ref")
    .eq("org_id", orgId)
    .eq("notice_id", noticeId);

  const refs = ((data ?? []) as Record<string, unknown>[])
    .map((r) => String(r.storage_ref))
    .filter((ref) => refIsOrgs(ref, orgId));
  if (refs.length === 0) return;

  const { error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(refs);
  if (error) console.error("Couldn't remove notice attachments from storage:", error);
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
