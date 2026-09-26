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
   `deskOn`, asked of THEIR role, not the viewer's), and who holds
   `workboard`, the gate the diary's mentions sit behind. So until the flip
   the crew's Home — whose Tasks face would show an automatic task it has no
   words for — never gets one, and with the flag off nothing here reads at
   all.

   WHAT AN ASK IS: the diary's own reading (./mentions-query's
   listMyMentions and ./diary-feed's threads, `asksIn`), so the settle and
   the conversation it lands under can never disagree about who asked whom.
   Only asks of the last SETTLE_DAYS, on a job the mirror holds as live
   (nothing is made for a job its business deleted: #809's rule, read here
   so a failed read makes nothing rather than guessing).

   ONE ROW PER ASK PER PERSON, in mention_asks, and the row is the lease
   (docs/migrations/mention_asks.sql): a run claims an ask by inserting it
   as 'reading', and a second run's insert fails, so two runs at once make
   one task. A claim older than CLAIM_MS, or let go after a failed read, can
   be taken again; the MAX_ATTEMPTS-th failure sets 'failed' for good. The
   task and the row's `read` are written as a pair: a row that won't take
   its task id takes the task back out, so no later run can make a second.

   YOUR REPLY, written in ServiceM8 to the asker, is read after the ask
   (mention-brain's readReply; ./mention-asks' `taskAfterReply` decides):
   it moves the task to the day it names, or ticks it off, and never makes
   a second one. Only your newest reply is read, once (`last_reply_note`).

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
/** Failed reads before an ask is set aside for good. */
export const MAX_ATTEMPTS = 3;

export type SettleOutcome = {
  /** Model reads made: asks and replies. */
  reads: number;
  /** Tasks made. */
  tasks: number;
  /** Tasks a reply moved, and ticked off. */
  moved: number;
  done: number;
  /** Reads or writes that failed, to be tried again. */
  failed: number;
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
  due_said: string | null;
};

const ASK_COLUMNS =
  "id, sm8_note_uuid, staff_id, status, kind, task_id, attempts, claimed_at, last_reply_note, due_said";

type TaskRow = { id: string; title: string; status: string; due_date: string | null; remind_at: string | null };

type Reader = { sm8Uuid: string; staffId: string; person: Sm8Person };

const ROLES: readonly Role[] = ["owner", "admin", "staff"];
const roleOf = (v: unknown): Role | null => (ROLES.includes(v as Role) ? (v as Role) : null);

/** The linked people this runs for: the flag gives them the new Home, and
    they may see the board. A read that fails is nobody. */
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
  const out: SettleOutcome = { reads: 0, tasks: 0, moved: 0, done: 0, failed: 0, skipped: null };
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

  const asks = theirs.flatMap((r) => r.conversations.flatMap((c) => asksIn(c).map((m) => ({ r, c, m }))));
  if (!asks.some(({ m }) => m.at.slice(0, 10) >= since)) return out;

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
    .in("sm8_note_uuid", [...new Set(asks.map(({ m }) => m.id))]);
  if (rowErr) {
    const absent = missingTable((rowErr as { code?: unknown }).code);
    if (!absent) console.error(`[asks] couldn't read the asks for org ${orgId}:`, rowErr);
    return { ...out, skipped: absent ? "no-table" : null };
  }
  const rows = new Map<string, AskRow>();
  const keyOf = (staffId: string, note: string) => `${staffId}:${note}`;
  for (const row of (rowData ?? []) as AskRow[]) rows.set(keyOf(row.staff_id, row.sm8_note_uuid), row);

  /* The tasks those asks made: their titles for the next ask's reading,
     and their state for a reply. A read that fails reads no replies. */
  const tasks = new Map<string, TaskRow>();
  let tasksKnown = true;
  const madeIds = [...rows.values()].map((r) => r.task_id).filter((id): id is string => !!id);
  if (madeIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("tasks")
      .select("id, title, status, due_date, remind_at")
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
     later run, until the last attempt. */
  const letGo = async (id: string, attempts: number, error: string) => {
    out.failed += 1;
    const tried = attempts + 1;
    const { error: e } = await supabaseAdmin
      .from("mention_asks")
      .update({ status: tried >= MAX_ATTEMPTS ? "failed" : "reading", attempts: tried, claimed_at: null, error: error.slice(0, 200) })
      .eq("org_id", orgId)
      .eq("id", id);
    if (e) console.error(`[asks] couldn't let an ask go for org ${orgId}:`, e);
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

  const settleAsk = async (r: Reader, c: DiaryConversation, m: DiaryMessage) => {
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
    if (!res.ok) return letGo(held.id, held.attempts, res.error);

    const readAt = iso();
    if (res.read.kind === "none") {
      const { error } = await supabaseAdmin
        .from("mention_asks")
        .update({ status: "read", kind: "none", read_at: readAt, claimed_at: null, error: null })
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
        /* nobody pressed anything: Tiff made it, from Luke's note */
        created_by: null,
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
    tasks.set(taskId, { id: taskId, title: res.read.title, status: "open", due_date: res.read.dueDate, remind_at: null });
  };

  /* Your newest reply to the asker since the latest ask that made a task. */
  const settleReply = async (r: Reader, c: DiaryConversation) => {
    if (!tasksKnown) return;
    const asked = asksIn(c)
      .map((m) => ({ m, row: rows.get(keyOf(r.staffId, m.id)) }))
      .filter(
        (a): a is { m: DiaryMessage; row: AskRow & { kind: "do" | "question"; task_id: string } } =>
          a.row?.status === "read" && (a.row.kind === "do" || a.row.kind === "question") && !!a.row.task_id,
      )
      .pop();
    if (!asked) return;
    const task = tasks.get(asked.row.task_id);
    if (!task || task.status !== "open") return;
    const from = c.messages.findIndex((x) => x.id === asked.m.id);
    const reply = c.messages
      .slice(from + 1)
      .filter((x) => x.from === "you")
      .pop();
    if (!reply || reply.id === asked.row.last_reply_note || !fits()) return;

    out.reads += 1;
    const res = await readReply({
      ask: asked.m.text,
      kind: asked.row.kind,
      task: task.title,
      asker: c.asker.name,
      person: r.person.name,
      job: c.jobLabel,
      reply: reply.text,
      at: reply.at,
    });
    if (!res.ok) {
      out.failed += 1;
      return;
    }
    const change = taskAfterReply(asked.row.kind, res.read, {
      open: true,
      dueDate: task.due_date ? task.due_date.slice(0, 10) : null,
      remindAt: task.remind_at,
      dueSaid: asked.row.due_said,
    });

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
        .eq("id", task.id)
        .eq("status", "open")
        .select("id");
      /* a write that failed reads the reply again next time */
      if (error) {
        out.failed += 1;
        return;
      }
      if ((changed ?? []).length === 1) {
        if (change.to === "done") {
          out.done += 1;
          await logTaskEvent(orgId, task.id, r.staffId, { kind: "done" });
        } else {
          out.moved += 1;
          const was = task.due_date ? task.due_date.slice(0, 10) : null;
          if (was !== change.dueDate) {
            await logTaskEvent(orgId, task.id, r.staffId, { kind: "due", from: was, to: change.dueDate });
          }
        }
      }
    }
    const { error: rowError } = await supabaseAdmin
      .from("mention_asks")
      .update({
        last_reply_note: reply.id,
        due_said: change?.to === "due" ? change.dueSaid : asked.row.due_said,
      })
      .eq("org_id", orgId)
      .eq("id", asked.row.id);
    if (rowError) console.error(`[asks] couldn't record the reply read for org ${orgId}:`, rowError);
  };

  /* Newest conversation first (the diary's order); in each, its asks in
     the order they were made, then your reply. */
  for (const r of theirs) {
    for (const c of r.conversations) {
      if (!live.has(c.jobUuid)) continue;
      for (const m of asksIn(c)) {
        if (m.at.slice(0, 10) < since || !claimable(rows.get(keyOf(r.staffId, m.id)), now())) continue;
        if (!fits()) return out;
        await settleAsk(r, c, m);
      }
      await settleReply(r, c);
    }
  }
  return out;
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
  due_said: null,
});
