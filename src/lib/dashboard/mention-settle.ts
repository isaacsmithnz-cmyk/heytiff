import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { plusDays, todayInZone } from "@/lib/workboard/dates";
import { sm8Roster, type Sm8Person } from "@/lib/workboard/job-notes-query";
import { canReadAsks, readAsk, readReply, READ_TIMEOUT_MS, type AskKind } from "@/lib/workboard/mention-brain";
import { sm8VendorOf } from "@/lib/workboard/query";
import { deskMode, deskOn } from "./desk-flag";
import type { DiaryConversation, DiaryMessage } from "./diary-feed";
import { asksIn, taskAfterReply } from "./mention-asks";
import { listMyMentions } from "./mentions-query";
import { logTaskEvent, missingTable } from "./task-events";

/* ONE TASK PER ASK — the settle. Server only.

   Somebody @mentions you in a ServiceM8 job note, and it becomes ONE task
   for you, with no review: Tiff reads it when it arrives (Isaac, 2026-09-25,
   "filing live": yes). This is what runs after a ServiceM8 sync — behind
   the response on a page load (integrations/sm8-freshness) and in the
   nightly cron — and files what the mirror brought in.

   WHO IT READS FOR. A person integration_links names (a name is never a
   link), whose role the HOME_DESK flag gives the new Home (./desk-flag's
   `deskOn`, asked of THEIR role in THIS workspace, not the viewer's), and
   who holds `workboard`, the gate the diary's mentions sit behind. So until
   the flip the crew's Home — whose Tasks face would show an automatic task
   it has no words for — never gets one, and with the flag off nothing here
   reads at all.

   ON THEIR OWN LIST. The task is made as the person's own (created_by is
   them): nobody gave it to them, so it is nobody's delegated work, and no
   manager's team list (tasks-query's teamTasks, which today's Home shows
   anyone with `team`) picks it up before the flip. It is theirs to tick
   off, move or delete.

   WHAT AN ASK IS: the diary's own reading (./mentions-query's
   listMyMentions and ./diary-feed's threads, `asksIn`), so the settle and
   the conversation it lands under can never disagree about who asked whom.
   Only asks of the last SETTLE_DAYS, on a job the mirror holds as live
   (nothing is made for a job its business deleted: #809's rule, read here
   so a failed read makes nothing rather than guessing).

   AN ASK THE STRIP ALREADY ANSWERED is never read. The job card's strip
   offers an unanswered mention as a task, and a person may have pressed it
   (or said "That isn't work") before a settle got there: job_note_actions
   holds that answer. Such an ask is recorded as read without a model read —
   the strip's task as its one task (kind 'do'), a dismissal as none — so
   one ask is still one task. (The strip, for its part, offers no ask that
   has a task here: job-notes-query, and actions/job-notes refuses one
   pressed from a card drawn before.)

   ONE ROW PER ASK PER PERSON, in mention_asks, and the row is the lease
   (docs/migrations/mention_asks.sql): a run claims an ask by inserting it
   as 'reading', and a second run's insert fails, so two runs at once make
   one task. A claim older than CLAIM_MS, or let go after a failed read, can
   be taken again, by a swap on the claim it had; the MAX_ATTEMPTS-th
   failure sets 'failed' for good. The task and the row's `read` are written
   as a pair: a row that won't take its task id takes the task back out, so
   no later run can make a second.

   YOUR REPLIES, written in ServiceM8 to the asker, are read after the asks
   (mention-brain's readReply; ./mention-asks' `taskAfterReply` decides):
   for each task still open and still YOURS — one given to someone else
   since is theirs, and your reply never moves it — every reply of yours
   since its ask and since the last one read for it, together, in one read
   that is told the conversation's other open tasks, so "called her" ticks
   off the call and not the quote. They move the task to the day they name,
   or tick it off, and never make a second one. Asks of any age get their
   replies read while the conversation is in the diary's window.

   FAILURES ARE NOT ALL ALIKE (mention-brain's `why`). A refusal is final:
   the ask is read as asking nothing, the replies as read. An outage — a
   rate limit, the reader down or unreachable, its key refused — is
   nobody's fault: the claim is let go uncounted and the run stops, rather
   than spend its other reads into the same outage. A read that runs out of
   time may be its note's doing or the reader's, so the run goes on to the
   next read to tell: if that one runs out of time too (or meets an
   outage), it's the reader, neither is counted and the run stops;
   otherwise — the next read came back, or there was none — it's the note,
   and it is counted. So one note that always takes too long is set aside
   after MAX_ATTEMPTS runs and never holds up the asks behind it, and a
   slow reader sets nothing aside. Anything else is counted, for an ask
   (attempts) and for replies (reply_attempts) alike, and set aside after
   MAX_ATTEMPTS, so nothing is read for ever.

   BOUNDED. At most `max` model reads a run (SETTLE_MAX), asks and replies
   together, and each starts only while its own timeout still fits the
   run's budget, so a run can't outlive the function it runs in. What
   doesn't fit waits for the next sync. Without a key nothing is claimed:
   a deployment that can't read must not use up the asks' attempts.

   NEVER A SERVICEM8 WRITE. Nothing here imports the write queue, and no
   sm8_writes row is ever made: a task, its history and the ask's row are
   HeyTiff's own. Before phase 2, ticking the task tells Luke nothing. */

/** How far back an ask becomes a task (Isaac, 2026-09-25: 30 days, so Luke's
    three September asks become tasks). */
export const SETTLE_DAYS = 30;
/** Model reads a run, asks and replies together. */
export const SETTLE_MAX = 5;
/** A claim older than this can be taken again. */
export const CLAIM_MS = 5 * 60_000;
/** Failed reads before an ask, or the replies after it, are set aside. */
export const MAX_ATTEMPTS = 3;

export type SettleOutcome = {
  /** Model reads made: asks and replies. */
  reads: number;
  /** Tasks made. */
  tasks: number;
  /** Asks the job card's strip had already answered, recorded unread. */
  adopted: number;
  /** Tasks a reply moved, and ticked off. */
  moved: number;
  done: number;
  /** Reads or writes that failed, to be tried again. */
  failed: number;
  /** The reader was out, and the run stopped there. */
  outage: boolean;
  /** Why nothing was tried, when it wasn't. */
  skipped: null | "off" | "no-key" | "no-time" | "nobody" | "no-table";
};

type Status = "reading" | "read" | "failed";

type AskRow = {
  id: string;
  sm8_note_uuid: string;
  staff_id: string;
  status: Status;
  kind: AskKind | null;
  task_id: string | null;
  attempts: number;
  claimed_at: string | null;
  last_reply_note: string | null;
  reply_attempts: number;
  due_said: string | null;
};

const ASK_COLUMNS =
  "id, sm8_note_uuid, staff_id, status, kind, task_id, attempts, claimed_at, last_reply_note, reply_attempts, due_said";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
  remind_at: string | null;
  assigned_to: string | null;
};

/** The job card's strip's answer to a note (job_note_actions). */
type StripAnswer = { sm8_note_uuid: string; action: "task" | "dismissed"; task_id: string | null };

type Reader = { sm8Uuid: string; staffId: string; person: Sm8Person };

const ROLES: readonly Role[] = ["owner", "admin", "staff"];
const roleOf = (v: unknown): Role | null => (ROLES.includes(v as Role) ? (v as Role) : null);

/** The linked people this runs for: the flag gives them the new Home, and
    they may see the board — by their card and their membership in THIS
    workspace. A read that fails is nobody. */
async function readersOf(orgId: string, links: ReadonlyMap<string, string>, people: readonly Sm8Person[]): Promise<Reader[]> {
  const staffIds = [...new Set(links.values())];
  const { data: staff, error } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, user_id")
    .eq("org_id", orgId)
    .in("id", staffIds);
  if (error) {
    console.error(`[asks] couldn't read the linked staff for org ${orgId}:`, error);
    return [];
  }
  const userOf = new Map<string, string>();
  for (const s of (staff ?? []) as { id: string; user_id: string | null }[]) if (s.user_id) userOf.set(s.id, s.user_id);
  if (userOf.size === 0) return [];

  const { data: members, error: memberErr } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role, permissions")
    .eq("org_id", orgId)
    .in("user_id", [...new Set(userOf.values())]);
  if (memberErr) {
    console.error(`[asks] couldn't read the linked staff's roles for org ${orgId}:`, memberErr);
    return [];
  }
  const may = new Set<string>();
  for (const m of (members ?? []) as { user_id: string; role: unknown; permissions: unknown }[]) {
    const role = roleOf(m.role);
    if (deskOn(role) && resolve(role, m.permissions).has("workboard")) may.add(m.user_id);
  }

  const out: Reader[] = [];
  for (const [sm8Uuid, staffId] of links) {
    const user = userOf.get(staffId);
    const person = people.find((p) => p.uuid === sm8Uuid);
    if (user && may.has(user) && person) out.push({ sm8Uuid, staffId, person });
  }
  return out;
}

/** Can this run take the ask? Not yet read by anyone, or read and let go, or
    claimed long enough ago that the run that claimed it has gone. */
export function claimable(row: Pick<AskRow, "status" | "attempts" | "claimed_at"> | undefined, now: number): boolean {
  if (!row) return true;
  if (row.status !== "reading" || row.attempts >= MAX_ATTEMPTS) return false;
  return row.claimed_at === null || Date.parse(row.claimed_at) <= now - CLAIM_MS;
}

export async function settleMentionAsks(
  orgId: string,
  opts: { budgetMs: number; max?: number; now?: () => number },
): Promise<SettleOutcome> {
  const now = opts.now ?? Date.now;
  const started = now();
  const max = opts.max ?? SETTLE_MAX;
  const out: SettleOutcome = { reads: 0, tasks: 0, adopted: 0, moved: 0, done: 0, failed: 0, outage: false, skipped: null };
  /* A read starts only while its own timeout still fits the budget. */
  const fits = () => out.reads < max && now() - started + READ_TIMEOUT_MS <= opts.budgetMs;

  if (deskMode() === "off") return { ...out, skipped: "off" };
  if (!canReadAsks()) return { ...out, skipped: "no-key" };
  if (!fits()) return { ...out, skipped: "no-time" };

  const links = await sm8StaffLinkMap(orgId);
  if (links.size === 0) return { ...out, skipped: "nobody" };
  const [people, vendor] = await Promise.all([sm8Roster(orgId), sm8VendorOf(orgId)]);
  const readers = await readersOf(orgId, links, people);
  if (readers.length === 0) return { ...out, skipped: "nobody" };

  const today = todayInZone(vendor.tz, new Date(now()));
  const since = plusDays(today, -SETTLE_DAYS);
  const theirs = await Promise.all(
    readers.map(async (r) => ({ ...r, conversations: await listMyMentions(orgId, r.sm8Uuid, today, { people }) })),
  );

  /* Every ask in the diary's window: the new ones are read, and the old
     ones' tasks still hear your replies. */
  const asks = theirs.flatMap((r) => r.conversations.flatMap((c) => asksIn(c).map((m) => ({ r, c, m }))));
  if (asks.length === 0) return out;
  const noteIds = [...new Set(asks.map(({ m }) => m.id))];

  /* LIVE ONLY, and a read that fails makes nothing. */
  const jobUuids = [...new Set(asks.map(({ c }) => c.jobUuid))];
  const { data: jobRows, error: jobErr } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .in("uuid", jobUuids);
  if (jobErr) {
    console.error(`[asks] couldn't read which jobs are live for org ${orgId}:`, jobErr);
    return out;
  }
  const live = new Set(((jobRows ?? []) as { uuid: string }[]).map((j) => j.uuid));

  /* What each ask has become so far, for everybody this run reads for. */
  const { data: rowData, error: rowErr } = await supabaseAdmin
    .from("mention_asks")
    .select(ASK_COLUMNS)
    .eq("org_id", orgId)
    .in("staff_id", [...new Set(readers.map((r) => r.staffId))])
    .in("sm8_note_uuid", noteIds);
  if (rowErr) {
    const absent = missingTable((rowErr as { code?: unknown }).code);
    if (!absent) console.error(`[asks] couldn't read the asks for org ${orgId}:`, rowErr);
    return { ...out, skipped: absent ? "no-table" : null };
  }
  const rows = new Map<string, AskRow>();
  const keyOf = (staffId: string, note: string) => `${staffId}:${note}`;
  for (const row of (rowData ?? []) as AskRow[]) rows.set(keyOf(row.staff_id, row.sm8_note_uuid), row);

  /* What the strip already answered. A read that fails makes nothing: an
     ask it answered, read again, would be a second task. */
  const { data: actData, error: actErr } = await supabaseAdmin
    .from("job_note_actions")
    .select("sm8_note_uuid, action, task_id")
    .eq("org_id", orgId)
    .in("sm8_note_uuid", noteIds);
  if (actErr) {
    console.error(`[asks] couldn't read what the strip answered for org ${orgId}:`, actErr);
    return out;
  }
  const answered = new Map(((actData ?? []) as StripAnswer[]).map((a) => [a.sm8_note_uuid, a]));

  /* The tasks those asks made (and the strip's): their titles for the next
     ask's reading, and their state for a reply. A read that fails reads no
     replies. */
  const tasks = new Map<string, TaskRow>();
  let tasksKnown = true;
  const madeIds = [
    ...new Set(
      [...[...rows.values()].map((r) => r.task_id), ...[...answered.values()].map((a) => a.task_id)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  if (madeIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, title, status, due_date, remind_at, assigned_to")
      .eq("org_id", orgId)
      .in("id", madeIds);
    if (error) {
      console.error(`[asks] couldn't read the asks' tasks for org ${orgId}:`, error);
      tasksKnown = false;
    }
    for (const t of (data ?? []) as TaskRow[]) tasks.set(t.id, t);
  }

  const iso = () => new Date(now()).toISOString();

  /* Let an ask go after a read or a write that failed: tried again by a
     later run, until the last attempt. Only a row still being read: one
     another run has read and marked since is theirs, and opening it again
     would have its ask read twice. */
  const letGo = async (id: string, attempts: number, error: string) => {
    out.failed += 1;
    const tried = attempts + 1;
    const { error: e } = await supabaseAdmin
      .from("mention_asks")
      .update({ status: tried >= MAX_ATTEMPTS ? "failed" : "reading", attempts: tried, claimed_at: null, error: error.slice(0, 200) })
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("status", "reading");
    if (e) console.error(`[asks] couldn't let an ask go for org ${orgId}:`, e);
  };

  /* Let an ask go uncounted: the reader was out, which was not the ask's
     doing. */
  const release = async (id: string, error: string) => {
    out.failed += 1;
    const { error: e } = await supabaseAdmin
      .from("mention_asks")
      .update({ claimed_at: null, error: error.slice(0, 200) })
      .eq("org_id", orgId)
      .eq("id", id)
      .eq("status", "reading");
    if (e) console.error(`[asks] couldn't let an ask go for org ${orgId}:`, e);
  };

  /* A read that ran out of time, held until the run shows whose doing it
     was (see the top): `settleSlow(true)` counts it against its note — the
     next read came back, or the run ended — and `settleSlow(false)` lets it
     go uncounted — the next read ran out of time too, or met an outage. */
  let slow: ((counted: boolean) => Promise<void>) | null = null;
  const settleSlow = async (counted: boolean) => {
    const held = slow;
    slow = null;
    if (held) await held(counted);
  };

  /* Claim one ask: the insert is the lease; taking one back is a swap on
     the claim it had, so only one run wins it. */
  const claim = async (r: Reader, c: DiaryConversation, m: DiaryMessage, row: AskRow | undefined) => {
    if (!row) {
      const { data, error } = await supabaseAdmin
        .from("mention_asks")
        .insert({
          org_id: orgId,
          sm8_note_uuid: m.id,
          sm8_job_uuid: c.jobUuid,
          staff_id: r.staffId,
          asker_sm8_uuid: c.asker.uuid,
          status: "reading",
          claimed_at: iso(),
          attempts: 0,
        })
        .select("id")
        .single();
      return error || !data ? null : { id: (data as { id: string }).id, attempts: 0 };
    }
    let swap = supabaseAdmin
      .from("mention_asks")
      .update({ claimed_at: iso() })
      .eq("org_id", orgId)
      .eq("id", row.id)
      .eq("status", "reading");
    swap = row.claimed_at === null ? swap.is("claimed_at", null) : swap.eq("claimed_at", row.claimed_at);
    const { data, error } = await swap.select("id");
    return !error && (data ?? []).length === 1 ? { id: row.id, attempts: row.attempts } : null;
  };

  /* Record, without a read, what the strip already made of an ask. */
  const adopt = async (r: Reader, c: DiaryConversation, m: DiaryMessage, row: AskRow | undefined, act: StripAnswer) => {
    const kind: AskKind = act.action === "task" ? "do" : "none";
    const taskId = act.action === "task" ? act.task_id : null;
    const patch = { status: "read", kind, task_id: taskId, read_at: iso(), claimed_at: null, error: null };
    let id = row?.id ?? "";
    if (!row) {
      const { data, error } = await supabaseAdmin
        .from("mention_asks")
        .insert({
          org_id: orgId,
          sm8_note_uuid: m.id,
          sm8_job_uuid: c.jobUuid,
          staff_id: r.staffId,
          asker_sm8_uuid: c.asker.uuid,
          attempts: 0,
          ...patch,
        })
        .select("id")
        .single();
      /* another run recorded it first */
      if (error || !data) return;
      id = (data as { id: string }).id;
    } else {
      const { data, error } = await supabaseAdmin
        .from("mention_asks")
        .update(patch)
        .eq("org_id", orgId)
        .eq("id", row.id)
        .in("status", ["reading", "failed"])
        .select("id");
      if (error || (data ?? []).length !== 1) return;
    }
    out.adopted += 1;
    rows.set(keyOf(r.staffId, m.id), {
      ...(row ?? blank(id, r.staffId, m.id)),
      status: "read",
      kind,
      task_id: taskId,
    });
  };

  const settleAsk = async (r: Reader, c: DiaryConversation, m: DiaryMessage): Promise<"outage" | void> => {
    const key = keyOf(r.staffId, m.id);
    const held = await claim(r, c, m, rows.get(key));
    if (!held) return;
    out.reads += 1;

    const at = c.messages.findIndex((x) => x.id === m.id);
    const made = asksIn(c)
      .map((x) => rows.get(keyOf(r.staffId, x.id))?.task_id)
      .map((id) => (id ? tasks.get(id)?.title : undefined))
      .filter((t): t is string => !!t);
    const res = await readAsk({
      text: m.text,
      asker: c.asker.name,
      person: r.person.name,
      job: c.jobLabel,
      at: m.at,
      before: c.messages.slice(0, Math.max(0, at)).map((x) => ({
        who: x.from === "them" ? c.asker.name : r.person.name,
        text: x.text,
      })),
      tasks: made,
    });
    /* the reader's doing — an outage, or a second read in a row that ran
       out of time — counts against neither, and stops the run */
    if (!res.ok && (res.why === "outage" || (res.why === "slow" && slow))) {
      await settleSlow(false);
      await release(held.id, res.error);
      return "outage";
    }
    /* out of time, and nothing yet says whose doing: the claim is kept
       until the run can tell */
    if (!res.ok && res.why === "slow") {
      const error = res.error;
      slow = (counted) => (counted ? letGo(held.id, held.attempts, error) : release(held.id, error));
      return;
    }
    /* the reader answered, so a read before it that ran out of time was
       its note's doing */
    await settleSlow(true);
    if (!res.ok && res.why === "failed") return letGo(held.id, held.attempts, res.error);

    const readAt = iso();
    /* a note that asks nothing, or one the reader declined (final: it is
       read no further) */
    if (!res.ok || res.read.kind === "none") {
      const { error } = await supabaseAdmin
        .from("mention_asks")
        .update({ status: "read", kind: "none", read_at: readAt, claimed_at: null, error: res.ok ? null : res.error })
        .eq("org_id", orgId)
        .eq("id", held.id);
      if (error) return letGo(held.id, held.attempts, "couldn't save the reading");
      rows.set(key, { ...(rows.get(key) ?? blank(held.id, r.staffId, m.id)), status: "read", kind: "none" });
      return;
    }

    const { data: task, error: taskErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        org_id: orgId,
        title: res.read.title,
        detail: null,
        assigned_to: r.staffId,
        /* nobody gave it to them: it is their own (see the top), made by
           Tiff from Luke's note */
        created_by: r.staffId,
        due_date: res.read.dueDate,
        status: "open",
      })
      .select("id")
      .single();
    if (taskErr || !task) return letGo(held.id, held.attempts, "couldn't save the task");
    const taskId = String((task as { id: string }).id);

    /* THE PAIR. The row takes the task's id, or the task goes back out: a
       row still 'reading' with a task nobody records would be read again
       and make a second one. */
    const { data: marked, error: markErr } = await supabaseAdmin
      .from("mention_asks")
      .update({ status: "read", kind: res.read.kind, task_id: taskId, read_at: readAt, claimed_at: null, error: null })
      .eq("org_id", orgId)
      .eq("id", held.id)
      .eq("status", "reading")
      .select("id");
    if (markErr || (marked ?? []).length !== 1) {
      await supabaseAdmin.from("tasks").delete().eq("org_id", orgId).eq("id", taskId);
      return letGo(held.id, held.attempts, "couldn't record the task");
    }
    out.tasks += 1;
    await logTaskEvent(orgId, taskId, null, { kind: "created", to: r.staffId });
    rows.set(key, {
      ...(rows.get(key) ?? blank(held.id, r.staffId, m.id)),
      status: "read",
      kind: res.read.kind,
      task_id: taskId,
    });
    tasks.set(taskId, {
      id: taskId,
      title: res.read.title,
      status: "open",
      due_date: res.read.dueDate,
      remind_at: null,
      assigned_to: r.staffId,
    });
  };

  /* Record the replies up to `newest` as read for this ask's row. */
  const heard = async (row: AskRow, patch: Partial<Record<string, unknown>>) => {
    const { error } = await supabaseAdmin.from("mention_asks").update(patch).eq("org_id", orgId).eq("id", row.id);
    if (error) console.error(`[asks] couldn't record the reply read for org ${orgId}:`, error);
    else Object.assign(row, patch);
  };

  /* Your replies, per task still open and still yours (see the top). */
  const settleReply = async (r: Reader, c: DiaryConversation): Promise<"outage" | void> => {
    if (!tasksKnown) return;
    const place = (id: string | null) => (id ? c.messages.findIndex((x) => x.id === id) : -1);
    const open = asksIn(c).flatMap((m) => {
      const row = rows.get(keyOf(r.staffId, m.id));
      if (row?.status !== "read" || (row.kind !== "do" && row.kind !== "question") || !row.task_id) return [];
      const task = tasks.get(row.task_id);
      if (!task || task.status !== "open" || task.assigned_to !== r.staffId) return [];
      return [{ m, row, kind: row.kind, task }];
    });

    for (const a of open) {
      const from = Math.max(place(a.m.id), place(a.row.last_reply_note));
      const replies = c.messages.slice(from + 1).filter((x) => x.from === "you");
      if (replies.length === 0 || a.task.status !== "open") continue;
      if (!fits()) return;
      const newest = replies[replies.length - 1];

      out.reads += 1;
      const res = await readReply({
        ask: a.m.text,
        kind: a.kind,
        task: a.task.title,
        others: open.filter((o) => o !== a && o.task.status === "open").map((o) => o.task.title),
        asker: c.asker.name,
        person: r.person.name,
        job: c.jobLabel,
        replies: replies.map((x) => ({ text: x.text, at: x.at })),
      });
      /* the reader's doing, as for an ask: counted against nothing */
      if (!res.ok && (res.why === "outage" || (res.why === "slow" && slow))) {
        out.failed += 1;
        await settleSlow(false);
        return "outage";
      }
      /* the reader answered, so a read before it that ran out of time was
         its note's doing */
      if (res.ok || res.why !== "slow") await settleSlow(true);
      if (!res.ok) {
        out.failed += 1;
        /* a refusal is final; anything else is counted, and the replies
           are set aside after the last attempt, so none is read for ever */
        const tried = (a.row.reply_attempts ?? 0) + 1;
        const row = a.row;
        const count = () =>
          heard(
            row,
            res.why === "refused" || tried >= MAX_ATTEMPTS
              ? { last_reply_note: newest.id, reply_attempts: 0 }
              : { reply_attempts: tried },
          );
        /* out of time: held until the run can tell whose doing */
        if (res.why === "slow") {
          slow = async (counted) => {
            if (counted) await count();
          };
          continue;
        }
        await count();
        continue;
      }

      const change = taskAfterReply(a.kind, res.read, {
        open: true,
        dueDate: a.task.due_date ? a.task.due_date.slice(0, 10) : null,
        remindAt: a.task.remind_at,
        dueSaid: a.row.due_said,
      });
      let said: Record<string, unknown> = {};
      if (change) {
        const stamp = iso();
        const { data: changed, error } = await supabaseAdmin
          .from("tasks")
          .update(
            change.to === "done"
              ? { status: "done", done_at: stamp, done_by: r.staffId, updated_at: stamp }
              : { due_date: change.dueDate, updated_at: stamp },
          )
          .eq("org_id", orgId)
          .eq("id", a.task.id)
          .eq("status", "open")
          .select("id");
        /* a write that failed reads the replies again next time */
        if (error) {
          out.failed += 1;
          continue;
        }
        if ((changed ?? []).length === 1) {
          if (change.to === "done") {
            out.done += 1;
            a.task.status = "done";
            await logTaskEvent(orgId, a.task.id, r.staffId, { kind: "done" });
          } else {
            out.moved += 1;
            const was = a.task.due_date ? a.task.due_date.slice(0, 10) : null;
            a.task.due_date = change.dueDate;
            if (was !== change.dueDate) {
              await logTaskEvent(orgId, a.task.id, r.staffId, { kind: "due", from: was, to: change.dueDate });
            }
            /* the words, the day they were said and the day they named */
            said = { due_said: change.dueSaid, due_said_on: res.read.saidOn, due_said_for: change.dueDate };
          }
        }
      }
      await heard(a.row, { last_reply_note: newest.id, reply_attempts: 0, ...said });
    }
  };

  /* Newest conversation first (the diary's order); in each, its asks in
     the order they were made, then your replies. */
  const walk = async (): Promise<"outage" | void> => {
    for (const r of theirs) {
      for (const c of r.conversations) {
        if (!live.has(c.jobUuid)) continue;
        for (const m of asksIn(c)) {
          if (m.at.slice(0, 10) < since) continue;
          const row = rows.get(keyOf(r.staffId, m.id));
          const act = answered.get(m.id);
          if (act) {
            if (!row || row.status === "failed" || claimable(row, now())) await adopt(r, c, m, row, act);
            continue;
          }
          if (!claimable(row, now())) continue;
          if (!fits()) return;
          if ((await settleAsk(r, c, m)) === "outage") return "outage";
        }
        if ((await settleReply(r, c)) === "outage") return "outage";
      }
    }
  };
  const stopped = await walk();
  /* the run ended with nothing after a read that ran out of time to say it
     was the reader's, so it was its note's (an outage has let it go) */
  await settleSlow(true);
  return stopped === "outage" ? { ...out, outage: true } : out;
}

const blank = (id: string, staffId: string, note: string): AskRow => ({
  id,
  sm8_note_uuid: note,
  staff_id: staffId,
  status: "reading",
  kind: null,
  task_id: null,
  attempts: 0,
  claimed_at: null,
  last_reply_note: null,
  reply_attempts: 0,
  due_said: null,
});
