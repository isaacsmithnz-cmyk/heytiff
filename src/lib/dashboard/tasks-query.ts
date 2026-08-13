import { supabaseAdmin } from "@/lib/supabase-server";
import { asNoticeKind } from "./notices";
import { tallyPoll, type PollOptionRow, type PollVoteRow } from "./polls";
import { asRsvpAnswer, tallyRsvp, type RsvpRow } from "./events";
import { asReaction, tallyReactions, type ReactionRow } from "./reactions";
import {
  mentionsOf,
  threadComments,
  type CommentRow,
  type MentionTarget,
} from "./comments";
import type { BoardNotice } from "./board";
import { documentsForNotices } from "@/lib/documents/query";
import { displayNameOf } from "@/lib/staff/name";
import { isDelegated, noticeReadState, type DashTask } from "./tasks";

/* Queries for the task list and noticeboard. Org-scoped throughout.

   These carry no wages — a task is a title and a due date — so there is no money
   projection. The scoping that matters is WHOSE: the *mine* read is filtered to
   the viewer's own assignments; the *team* read (management) returns the org's.
   Notices are org-wide by design (that's what a noticeboard is), so everyone
   reads them; the join tells each viewer which they've acknowledged. */

/* Everything `displayNameOf` needs, named once. Selecting a subset is how the
   two name resolvers drifted apart in the first place. */
export const NAME_COLUMNS = "id, first_name, last_name, full_name, preferred_name";

export type StaffNames = Map<string, string>;

/* id → display name for every staff member in the org.

   Every function below wants this map, and the dashboard calls five of them at
   once — so it is a PARAMETER, and the loader reads it once and hands the same
   map to all five. Left to fetch its own, this ran five identical full-table
   reads per dashboard render. It stays optional so a caller with one query to
   run (and every test) needn't thread it through. */
async function staffNames(orgId: string): Promise<StaffNames> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId);
  const map: StaffNames = new Map();
  for (const r of data ?? []) map.set(r.id as string, displayNameOf(r));
  return map;
}

/** The caller's map if it brought one, otherwise a fresh read. */
const namesFor = (orgId: string, given?: StaffNames): Promise<StaffNames> =>
  given ? Promise.resolve(given) : staffNames(orgId);

/** Everyone's names, for a caller that is about to make several of these
    queries and wants them to share one read. */
export const loadStaffNames = staffNames;

const TASK_COLUMNS =
  "id, title, detail, assigned_to, created_by, due_date, status, created_at, done_at, done_by";

function toTask(r: Record<string, unknown>, name: (id: string) => string): DashTask {
  const assigneeId = String(r.assigned_to);
  const doneBy = (r.done_by as string) ?? null;
  return {
    id: String(r.id),
    title: String(r.title),
    detail: typeof r.detail === "string" && r.detail ? r.detail : null,
    assigneeId,
    assigneeName: name(assigneeId),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    status: r.status === "done" ? "done" : "open",
    createdBy: (r.created_by as string) ?? null,
    createdAt: String(r.created_at),
    doneAt: r.done_at ? String(r.done_at) : null,
    doneByName: doneBy ? name(doneBy) : null,
  };
}

/** Your own open tasks. */
export async function myTasks(
  orgId: string,
  staffProfileId: string,
  known?: StaffNames,
): Promise<DashTask[]> {
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("assigned_to", staffProfileId)
      .eq("status", "open"),
    namesFor(orgId, known),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"));
}

/* Your recently-completed tasks. A done task is kept, not deleted, so finishing
   one leaves a trace you can check — and undo if the tap was a mistake. */
export async function recentlyDoneTasks(
  orgId: string,
  staffProfileId: string,
  sinceDays: number,
  now = new Date(),
  known?: StaffNames,
): Promise<DashTask[]> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("assigned_to", staffProfileId)
      .eq("status", "done")
      .gte("done_at", since)
      .order("done_at", { ascending: false })
      .limit(5),
    namesFor(orgId, known),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"));
}

/* Open DELEGATED work across the org — the `team` management view.

   Self-assigned tasks are deliberately excluded: a to-do someone wrote for
   themselves is private to them, not management's business. Only work that was
   handed to someone appears here. The column-to-column comparison isn't
   expressible as a PostgREST filter, so it's applied here via isDelegated. */
export async function teamTasks(orgId: string, known?: StaffNames): Promise<DashTask[]> {
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "open"),
    namesFor(orgId, known),
  ]);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"))
    .filter(isDelegated);
}

/* Work YOU handed to someone else that has since been completed — the "it's
   done" report back to whoever assigned it. Self-assigned tasks never appear:
   you don't need telling that you finished your own to-do. */
export async function assignedByMeRecentlyDone(
  orgId: string,
  staffProfileId: string,
  sinceDays: number,
  now = new Date(),
  known?: StaffNames,
): Promise<DashTask[]> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString();
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("created_by", staffProfileId)
      .eq("status", "done")
      .gte("done_at", since)
      .order("done_at", { ascending: false })
      .limit(5),
    namesFor(orgId, known),
  ]);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"))
    .filter((t) => t.assigneeId !== staffProfileId);
}

/* How far back the board reads, for EVERYONE who reads it.

   Home used to ask for 20 and the noticeboard page for 100, over the same
   table with the same read-state join — so Home's "N unread" badge and the
   board it links to were counting different sets of rows, and an org with a
   busy month could see the two disagree. One window, one number. */
export const NOTICE_WINDOW = 100;

/** Recent notices with the viewer's read state joined in.

    PINNED FIRST IN THE QUERY, not only in `sortNotices`. The limit used to be
    applied to a plain `created_at DESC`, so pinning — the one mechanism for
    "keep this where people will see it" — stopped working the moment a post
    fell past the window: it was cut by the database and then sorted to the
    top of what was left. The edge still calls `sortNotices`, which now agrees
    with the order the rows arrive in rather than reordering them. */
export async function listNotices(
  orgId: string,
  staffProfileId: string | null,
  limit = NOTICE_WINDOW,
  known?: StaffNames,
): Promise<BoardNotice[]> {
  const [{ data }, names, activeStaff] = await Promise.all([
    supabaseAdmin
      .from("notices")
      .select(
        // one literal, not a concatenation: supabase-js infers the row type
        // FROM this string, and a `+` erases that back to unknown
        "id, title, body, pinned, posted_by, created_at, revision, edited_at, kind, expires_at, archived_at, poll_multi, event_date, event_time, event_location",
      )
      .eq("org_id", orgId)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit),
    namesFor(orgId, known),
    activeStaffCount(orgId),
  ]);

  const noticeRows = (data ?? []) as Record<string, unknown>[];
  // Only pay for an attachment's join when the page actually holds one — a
  // board of plain notices costs exactly what it did before.
  const name = (id: string) => names.get(id) ?? "Unnamed";
  const idsOfKind = (kind: string) =>
    noticeRows.filter((r) => asNoticeKind(r.kind) === kind).map((r) => String(r.id));
  const allIds = noticeRows.map((r) => String(r.id));
  const [polls, rsvps, reactions, comments, attachments, reads] = await Promise.all([
    pollsFor(orgId, idsOfKind("poll"), name),
    rsvpsFor(orgId, idsOfKind("event"), name),
    // reactions and comments are not kind-specific: anything on the board can
    // be reacted to, and talked about
    reactionsFor(orgId, allIds, name),
    commentsFor(orgId, allIds, name),
    documentsForNotices(orgId, allIds),
    // joins the ids-known batch so it can be scoped to the page: read receipts
    // are one row per person per notice and nothing ever prunes them, so
    // reading the org's entire history to render twenty posts grows without
    // bound — every other join here is already keyed to these same ids
    readsFor(orgId, allIds),
  ]);

  const threaded = new Map(
    [...comments.entries()].map(([noticeId, rows]) => [noticeId, threadComments(rows)] as const),
  );

  return noticeRows.map((r) => {
    const id = String(r.id);
    const poster = (r.posted_by as string) ?? null;
    const revision = Number(r.revision) || 1;
    const rows = reads.get(id) ?? [];
    const mineRow = staffProfileId ? rows.find((x) => x.staffId === staffProfileId) : undefined;
    const ackedRevision = mineRow ? mineRow.revision : null;
    // read receipts are about the AUDIENCE, so the author never counts toward
    // either side of "read by n of m"
    const readBy = rows.filter((x) => x.staffId !== poster && x.revision >= revision).length;
    return {
      id,
      title: String(r.title),
      body: typeof r.body === "string" && r.body ? r.body : null,
      pinned: r.pinned === true,
      postedById: poster,
      postedByName: poster ? names.get(poster) ?? null : null,
      createdAt: String(r.created_at),
      revision,
      editedAt: r.edited_at ? String(r.edited_at) : null,
      kind: asNoticeKind(r.kind),
      expiresAt: r.expires_at ? String(r.expires_at).slice(0, 10) : null,
      archivedAt: r.archived_at ? String(r.archived_at) : null,
      ackedRevision,
      state: noticeReadState(revision, ackedRevision),
      mine: !!poster && poster === staffProfileId,
      readBy,
      audience: Math.max(0, activeStaff - (poster ? 1 : 0)),
      poll:
        asNoticeKind(r.kind) === "poll"
          ? tallyPoll({
              options: polls.options.get(id) ?? [],
              votes: polls.votes.get(id) ?? [],
              multi: r.poll_multi === true,
              viewerStaffId: staffProfileId,
            })
          : null,
      // an event row without a date can't exist (DB CHECK), but a null read
      // must degrade to "not an event" rather than to an event on 1 Jan 1970
      event:
        asNoticeKind(r.kind) === "event" && r.event_date
          ? {
              date: String(r.event_date).slice(0, 10),
              time: r.event_time ? String(r.event_time).slice(0, 5) : null,
              location: typeof r.event_location === "string" && r.event_location ? r.event_location : null,
              rsvp: tallyRsvp(rsvps.get(id) ?? [], staffProfileId),
            }
          : null,
      reactions: tallyReactions(reactions.get(id) ?? [], staffProfileId),
      comments: threaded.get(id) ?? [],
      mentionsMe: mentionsOf(threaded.get(id) ?? [], staffProfileId),
      attachments: attachments.get(id) ?? [],
    };
  });
}

/* Options and votes for the polls on THIS page, keyed by notice. Two flat
   reads and a group-by rather than a nested select: the shapes are tiny, and
   the tally itself stays in the pure module where it can be tested. */
async function pollsFor(
  orgId: string,
  noticeIds: readonly string[],
  name: (id: string) => string,
): Promise<{ options: Map<string, PollOptionRow[]>; votes: Map<string, PollVoteRow[]> }> {
  const options = new Map<string, PollOptionRow[]>();
  const votes = new Map<string, PollVoteRow[]>();
  if (noticeIds.length === 0) return { options, votes };

  const [opt, vote] = await Promise.all([
    supabaseAdmin
      .from("notice_poll_options")
      .select("id, notice_id, label, position")
      .eq("org_id", orgId)
      .in("notice_id", [...noticeIds]),
    supabaseAdmin
      .from("notice_poll_votes")
      .select("notice_id, option_id, staff_profile_id")
      .eq("org_id", orgId)
      .in("notice_id", [...noticeIds]),
  ]);

  for (const r of (opt.data ?? []) as Record<string, unknown>[]) {
    const key = String(r.notice_id);
    const list = options.get(key) ?? [];
    list.push({ id: String(r.id), label: String(r.label), position: Number(r.position) || 0 });
    options.set(key, list);
  }
  for (const r of (vote.data ?? []) as Record<string, unknown>[]) {
    const key = String(r.notice_id);
    const list = votes.get(key) ?? [];
    const staffId = String(r.staff_profile_id);
    list.push({ optionId: String(r.option_id), staffId, staffName: name(staffId) });
    votes.set(key, list);
  }
  return { options, votes };
}

/** Who has replied to each event on this page. */
async function rsvpsFor(
  orgId: string,
  noticeIds: readonly string[],
  name: (id: string) => string,
): Promise<Map<string, RsvpRow[]>> {
  const out = new Map<string, RsvpRow[]>();
  if (noticeIds.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("notice_rsvps")
    .select("notice_id, staff_profile_id, answer")
    .eq("org_id", orgId)
    .in("notice_id", [...noticeIds]);

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const answer = asRsvpAnswer(r.answer);
    if (!answer) continue; // an unreadable answer is no answer, never a guess
    const key = String(r.notice_id);
    const list = out.get(key) ?? [];
    const staffId = String(r.staff_profile_id);
    list.push({ staffId, staffName: name(staffId), answer });
    out.set(key, list);
  }
  return out;
}

/** Who reacted to what, across the whole page. */
async function reactionsFor(
  orgId: string,
  noticeIds: readonly string[],
  name: (id: string) => string,
): Promise<Map<string, ReactionRow[]>> {
  const out = new Map<string, ReactionRow[]>();
  if (noticeIds.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("notice_reactions")
    .select("notice_id, staff_profile_id, emoji")
    .eq("org_id", orgId)
    .in("notice_id", [...noticeIds]);

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const emoji = asReaction(r.emoji);
    if (!emoji) continue; // a reaction we no longer offer simply isn't shown
    const key = String(r.notice_id);
    const list = out.get(key) ?? [];
    const staffId = String(r.staff_profile_id);
    list.push({ staffId, staffName: name(staffId), emoji });
    out.set(key, list);
  }
  return out;
}

/* The conversation under every post on the page, with its mentions attached.
   Two flat reads again: the comments, then the mention rows, joined in memory
   so the threading rule stays in the pure module where it is tested. */
async function commentsFor(
  orgId: string,
  noticeIds: readonly string[],
  name: (id: string) => string,
): Promise<Map<string, CommentRow[]>> {
  const out = new Map<string, CommentRow[]>();
  if (noticeIds.length === 0) return out;

  const [comment, mention] = await Promise.all([
    supabaseAdmin
      .from("notice_comments")
      .select("id, notice_id, parent_id, author_id, body, created_at")
      .eq("org_id", orgId)
      .in("notice_id", [...noticeIds])
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("notice_comment_mentions")
      .select("comment_id, staff_profile_id")
      .eq("org_id", orgId)
      .in("notice_id", [...noticeIds]),
  ]);

  const byComment = new Map<string, string[]>();
  for (const m of (mention.data ?? []) as Record<string, unknown>[]) {
    const key = String(m.comment_id);
    byComment.set(key, [...(byComment.get(key) ?? []), String(m.staff_profile_id)]);
  }

  for (const c of (comment.data ?? []) as Record<string, unknown>[]) {
    const key = String(c.notice_id);
    const id = String(c.id);
    const author = (c.author_id as string) ?? null;
    const list = out.get(key) ?? [];
    list.push({
      id,
      parentId: (c.parent_id as string) ?? null,
      authorId: author,
      authorName: author ? name(author) : null,
      body: String(c.body),
      createdAt: String(c.created_at),
      mentions: byComment.get(id) ?? [],
    });
    out.set(key, list);
  }
  return out;
}

/* Everyone a comment can @mention: the org's active staff, by display name.
   Shared by the action (to resolve who was meant) and the page (to paint the
   highlight), so the two can never disagree about what counts as a mention.

   Resolved through `displayNameOf`, like every other name in the app. It used
   to read `preferred_name || full_name` by hand and not even select the name
   parts, which meant a card whose `full_name` had fallen out of step with
   `first_name`/`last_name` was mentionable under a different name from the one
   the board showed on their own comments — or, with `full_name` empty, only as
   "Unnamed", which nobody can type. One resolver, one answer. */
export async function mentionableStaff(orgId: string): Promise<MentionTarget[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .eq("status", "Active");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: displayNameOf(r),
  }));
}

/** The answers a poll offers, for the actions that must check a vote is for a
    real option on the right notice. */
export async function pollOptionIds(orgId: string, noticeId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("notice_poll_options")
    .select("id")
    .eq("org_id", orgId)
    .eq("notice_id", noticeId);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => String(r.id));
}

type ReadRow = { staffId: string; revision: number };

/** The read receipts for the notices on THIS page, grouped by notice. One query
    serves both "did I read it" and the author's "read by n of m". */
async function readsFor(
  orgId: string,
  noticeIds: readonly string[],
): Promise<Map<string, ReadRow[]>> {
  const out = new Map<string, ReadRow[]>();
  if (noticeIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("notice_reads")
    .select("notice_id, staff_profile_id, revision")
    .eq("org_id", orgId)
    .in("notice_id", [...noticeIds]);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = String(r.notice_id);
    const list = out.get(id) ?? [];
    list.push({ staffId: String(r.staff_profile_id), revision: Number(r.revision) || 1 });
    out.set(id, list);
  }
  return out;
}

async function activeStaffCount(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("staff_profiles")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "Active");
  return count ?? 0;
}
