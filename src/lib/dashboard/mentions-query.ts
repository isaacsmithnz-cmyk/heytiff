/* WHO ASKED YOU SOMETHING IN SERVICEM8 — the reads behind the diary's
   conversations. Server only.

   NO SESSION HERE: callers establish the right to ask (`workboard`, and a
   viewer integration_links names) and hand in an orgId and the viewer's
   ServiceM8 uuid, the same posture as every other read module.

   YOUR HANDLE COMES FROM YOUR LINK, never from your name. The roster says
   which handle belongs to the ServiceM8 person integration_links says you
   are; a name match is the guess that table exists to end.

   FOUR SMALL READS, in order, each needing the one before:
     1. the roster (sm8Roster): every handle, and yours;
     2. the asks: live notes from the last MENTION_DAYS whose words hold
        "@<your handle>", newest first, MENTION_LIMIT of them. ILIKE is the
        coarse cut ("@isaacsmithy" passes it); mentionedHandles is the
        exact one, and your own notes are never asks;
     3. the threads: every live note on those jobs from the earliest ask
        on, and the jobs' numbers and suburbs, together;
     4. which of the notes that ended up IN a conversation HeyTiff wrote
        itself (sm8Ours) — our own writes, mirrored back, are left out.
        Only those: a thread read brings up to THREAD_LIMIT notes, most of
        which join nothing, and sm8Ours asks fifty at a time, one after
        another. A note that joined nothing changed nothing, so taking it
        out can't change a conversation; the conversations are built
        again without the echoes, and again only if that brings in a note
        not yet asked about.
   docs/migrations/sm8_job_notes_org_created_idx.sql is the index read 2
   walks.

   AND FOR THE DIARY, WHAT EACH ASK BECAME: given the viewer's staff card,
   the tasks Tiff made of their asks (mention_asks, docs/migrations/
   mention_asks.sql) and whether each is done, so the conversation can say
   "1 task for you" (./mention-asks). Two reads more, only when there are
   asks; a table not there yet, or a read that fails, says no task rather
   than taking the conversations with it. The settle (./mention-settle)
   reads the conversations the same way and asks for none of this. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8Ours } from "@/lib/integrations/sm8-echo";
import { plusDays } from "@/lib/workboard/dates";
import { sm8Roster, type Sm8Person } from "@/lib/workboard/job-notes-query";
import { mentionedHandles } from "@/lib/workboard/sm8-mentions";
import {
  buildConversations,
  jobDoorLabel,
  MENTION_DAYS,
  type DiaryConversation,
  type MentionNote,
} from "./diary-feed";
import { asksIn, withAskTasks, type AskMade, type AskTaskNow } from "./mention-asks";
import { missingTable } from "./task-events";

/** The asks read at most. */
export const MENTION_LIMIT = 40;
/** The notes read at most for the threads on those jobs. */
export const THREAD_LIMIT = 400;

const NOTE_COLUMNS = "uuid, related_object, related_object_uuid, note, edit_by_staff_uuid, create_date";

/* The only handles a mention can be written with (sm8-mentions' TOKEN). A
   handle outside it — "brent(service)gilmore" — can never be matched, and
   its brackets have no business in a filter, so it reads nothing at all. */
const MENTIONABLE = /^[a-z0-9.'-]+$/;

type NoteRow = {
  uuid: string;
  related_object: string | null;
  related_object_uuid: string | null;
  note: string | null;
  edit_by_staff_uuid: string | null;
  create_date: string | null;
};

/* Notes on a JOB, with words and a date. ServiceM8 hangs notes off other
   objects too; a note with no object named is taken as the job's, which is
   how the job card reads them. */
function jobNotes(rows: unknown): MentionNote[] {
  const out: MentionNote[] = [];
  for (const r of (rows ?? []) as NoteRow[]) {
    const text = r.note?.trim();
    if (!text || !r.related_object_uuid || !r.create_date) continue;
    if (r.related_object && r.related_object.toLowerCase() !== "job") continue;
    out.push({ uuid: r.uuid, jobUuid: r.related_object_uuid, text, author: r.edit_by_staff_uuid, at: r.create_date });
  }
  return out;
}

/** The viewer's conversations: every ServiceM8 job note from the last
    MENTION_DAYS that @mentions them, threaded (see diary-feed). `mineUuid`
    is the viewer's ServiceM8 staff uuid from integration_links; `today` is
    the account's today. Empty whenever there is nothing to show — a person
    the roster can't find, a handle nothing can mention, a read that fails.

    `staffId`, the viewer's staff card, brings each ask's task with it (see
    the note at the top); `people`, the roster when the caller has it
    already, saves reading it again. */
export async function listMyMentions(
  orgId: string,
  mineUuid: string,
  today: string,
  opts: { staffId?: string | null; people?: readonly Sm8Person[] } = {},
): Promise<DiaryConversation[]> {
  const conversations = await readConversations(orgId, mineUuid, today, opts.people);
  return opts.staffId ? withTheirTasks(orgId, opts.staffId, conversations, today) : conversations;
}

async function readConversations(
  orgId: string,
  mineUuid: string,
  today: string,
  roster?: readonly Sm8Person[],
): Promise<DiaryConversation[]> {
  const people = roster ?? (await sm8Roster(orgId));
  const me = people.find((p) => p.uuid === mineUuid);
  if (!me || !MENTIONABLE.test(me.handle)) return [];
  const handles = people.map((p) => p.handle);

  const asked = await supabaseAdmin
    .from("sm8_job_notes")
    .select(NOTE_COLUMNS)
    .eq("org_id", orgId)
    .eq("active", 1)
    .ilike("note", `%@${me.handle}%`)
    .gte("create_date", plusDays(today, -MENTION_DAYS))
    .order("create_date", { ascending: false })
    .limit(MENTION_LIMIT);
  if (asked.error) {
    console.error(`[diary] couldn't read the mentions for org ${orgId}:`, asked.error);
    return [];
  }

  const asks = jobNotes(asked.data).filter(
    (n) => n.author !== mineUuid && mentionedHandles(n.text, handles).includes(me.handle)
  );
  if (asks.length === 0) return [];

  const jobUuids = [...new Set(asks.map((n) => n.jobUuid))];
  const earliest = asks.reduce((min, n) => (n.at < min ? n.at : min), asks[0].at);
  const [thread, jobRows] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_notes")
      .select(NOTE_COLUMNS)
      .eq("org_id", orgId)
      .in("related_object_uuid", jobUuids)
      .eq("active", 1)
      .gte("create_date", earliest)
      .order("create_date", { ascending: false })
      .limit(THREAD_LIMIT),
    supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, geo_city, active")
      .eq("org_id", orgId)
      .in("uuid", jobUuids),
  ]);

  /* The asks first: a thread read that failed, or was cut at its limit,
     still leaves every ask its conversation. */
  const pool = new Map<string, MentionNote>();
  for (const n of [...asks, ...jobNotes(thread.data)]) if (!pool.has(n.uuid)) pool.set(n.uuid, n);

  /* GONE ONLY WHEN THE COPY SAYS SO. A job is taken to have gone — no
     door, no Reply, and #809's sentence — only when the mirror holds its
     row as deleted. A jobs read that failed, or a job the mirror holds no
     row for, says nothing about the job: it keeps its door and its Reply,
     and the desk's card says #809's sentence itself if the job really has
     gone (openMirrorJob finds no live row). */
  if (jobRows.error) console.error(`[diary] couldn't read the jobs for org ${orgId}'s mentions:`, jobRows.error);
  const jobs = new Map<string, { label: string | null; live: boolean }>(
    jobUuids.map((uuid) => [uuid, { label: null, live: true }]),
  );
  for (const j of (jobRows.data ?? []) as {
    uuid: string;
    generated_job_id: string | number | null;
    geo_city: string | null;
    active: number | string | null;
  }[]) {
    jobs.set(j.uuid, {
      label: jobDoorLabel(j.generated_job_id === null ? null : String(j.generated_job_id), j.geo_city),
      live: Number(j.active) === 1,
    });
  }

  /* Each round asks only about messages no round has asked about, and
     goes again only when it found an echo — so today, with HeyTiff writing
     no notes, it is one round and one query. */
  const echoes = new Set<string>();
  const checked = new Set<string>();
  for (;;) {
    const conversations = buildConversations({
      notes: [...pool.values()].filter((n) => !echoes.has(n.uuid)),
      me,
      people,
      jobs,
      today,
    });
    const unchecked = [...new Set(conversations.flatMap((c) => c.messages.map((m) => m.id)))].filter(
      (id) => !checked.has(id)
    );
    if (unchecked.length === 0) return conversations;
    for (const id of unchecked) checked.add(id);
    const ours = await sm8Ours(orgId, unchecked);
    if (ours.size === 0) return conversations;
    for (const id of ours) echoes.add(id);
  }
}

/* The viewer's read asks among these conversations, and each task they
   made as it is now: done or not, the day it is due (the door's words for
   when hold only while it is still the day they named), and whose it is
   (one given away since is "1 task for Leo", not "for you"). Tasks are
   this workspace's only: a task id is looked up with the org, never on its
   own. */
async function withTheirTasks(
  orgId: string,
  staffId: string,
  conversations: DiaryConversation[],
  today: string,
): Promise<DiaryConversation[]> {
  const asks = conversations.flatMap((c) => asksIn(c).map((m) => m.id));
  if (asks.length === 0) return conversations;

  const made = await supabaseAdmin
    .from("mention_asks")
    .select("sm8_note_uuid, kind, task_id, due_said, due_said_on, due_said_for")
    .eq("org_id", orgId)
    .eq("staff_id", staffId)
    .eq("status", "read")
    .in("sm8_note_uuid", asks);
  if (made.error) {
    /* before docs/migrations/mention_asks.sql runs the table isn't there:
       expected, and no task is what the diary says */
    if (!missingTable((made.error as { code?: unknown }).code)) {
      console.error(`[diary] couldn't read the asks' tasks for org ${orgId}:`, made.error);
    }
    return conversations;
  }
  const rows = (made.data ?? []) as AskMade[];
  if (rows.length === 0) return conversations;
  const ids = [...new Set(rows.map((r) => r.task_id).filter((id): id is string => !!id))];

  const tasks = new Map<string, AskTaskNow>();
  if (ids.length > 0) {
    const read = await supabaseAdmin
      .from("tasks")
      .select("id, status, due_date, assigned_to")
      .eq("org_id", orgId)
      .in("id", ids);
    /* a task whose state can't be read is not said to be gone, or done */
    if (read.error) {
      console.error(`[diary] couldn't read the asks' tasks for org ${orgId}:`, read.error);
      return conversations;
    }
    for (const t of (read.data ?? []) as {
      id: string;
      status: string | null;
      due_date: string | null;
      assigned_to: string | null;
    }[]) {
      tasks.set(t.id, { done: t.status === "done", dueDate: t.due_date, ownerId: t.assigned_to });
    }
  }
  return withAskTasks(conversations, rows, tasks, today);
}
