/* ONE TASK PER ASK — pure. What a ServiceM8 ask of you became, decided here
   where a test can see it (Isaac, 2026-09-24, v15: "Did that get added? As
   a task, for me"; filing without review decided 2026-09-25). The reads
   and writes are ./mention-settle (which files them) and ./mentions-query
   (which shows them in the diary).

   WHICH MESSAGES ARE ASKS. In a conversation (./diary-feed), every message
   the asker wrote to you: the ask that opened it, and each later note of
   theirs that mentions you again. Their note on the job that names nobody
   is not written to you, and asks you nothing; nor does anything you wrote.

   YOUR REPLY NEVER MAKES A SECOND TASK (`taskAfterReply`). Read by
   mention-brain's readReply, it can only do something to the task the ask
   already made:
     - a day moves it, and keeps the words that named it ("this
       afternoon") for the door;
     - "done" ticks it off;
     - an answer to a question ticks it off: the question was the task.
       Any reply to a question that doesn't put it off is that answer
       (Isaac, v16); the reader says so, "answer", because only it can tell
       a reply to THIS question from one about something else — the other
       task in the same conversation, say — which is "none";
     - a promise with no time, putting it off, or a reply about something
       else changes nothing;
     - a task already done, or deleted, is left alone, and so is one given
       an hour by hand (its reminder is on a day of its own choosing, and
       moving the day under it would part the two).

   THE WORDS FOR WHEN ARE TRUE FOR A DAY. "This afternoon" and "tomorrow"
   are only true on the day your reply said them, and only of the day they
   named: the door says them that day, while the task is still due then,
   and plain "1 task for you" after (`withAskTasks`). */

import type { MentionTask } from "./home-list";
import type { AskTask, DiaryConversation, DiaryFeed, DiaryMessage } from "./diary-feed";
import type { AskKind, ReplyRead } from "@/lib/workboard/mention-brain";

/** The messages in a conversation that ask you something: the asker's, to
    you. Oldest first, as the conversation holds them. */
export function asksIn(c: DiaryConversation): DiaryMessage[] {
  return c.messages.filter((m) => m.from === "them" && m.addressed);
}

/** A mention_asks row as the diary reads it: what the ask became. */
export type AskMade = {
  sm8_note_uuid: string;
  kind: AskKind | null;
  task_id: string | null;
  due_said: string | null;
  /** The day your reply said `due_said`, and the day it named. */
  due_said_on: string | null;
  due_said_for: string | null;
};

/** A task an ask made, as it is now. */
export type AskTaskNow = {
  done: boolean;
  dueDate: string | null;
  /** Whose it is: the staff card it is on. */
  ownerId: string | null;
};

/** Each conversation with the tasks its asks made (`AskTask`). `made` is
    the viewer's read asks; `tasks` is task id → the task now, for every
    task still there; `today` is the account's day. A row whose task is not
    among them names a task since deleted. An ask read as asking nothing
    made no task, and has none. The words for when go only while they are
    true (see the note at the top). */
export function withAskTasks(
  conversations: readonly DiaryConversation[],
  made: readonly AskMade[],
  tasks: ReadonlyMap<string, AskTaskNow>,
  today: string,
): DiaryConversation[] {
  const byNote = new Map(made.filter((r) => r.kind === "do" || r.kind === "question").map((r) => [r.sm8_note_uuid, r]));
  return conversations.map((c) => {
    const out: AskTask[] = [];
    for (const m of asksIn(c)) {
      const r = byNote.get(m.id);
      if (!r) continue;
      const task = r.task_id ? tasks.get(r.task_id) : undefined;
      const stillSo =
        !!task && !!r.due_said && r.due_said_on === today && !!task.dueDate && task.dueDate.slice(0, 10) === r.due_said_for;
      out.push({
        noteId: m.id,
        taskId: task ? r.task_id : null,
        done: task?.done ?? false,
        dueSaid: stillSo ? r.due_said : null,
        ownerId: task?.ownerId ?? null,
      });
    }
    return out.length ? { ...c, tasks: out } : c;
  });
}

/** What the list and the Tasks tab know of a task an ask made: whose ask,
    on which day, and the note that asked, which is the door back to its
    conversation. Only for tasks still there. (The ask was the viewer's;
    the task may since have been given to someone else, and the list says
    "Luke asked" rather than "Luke asked you" on a row that isn't yours.) */
export function mentionTasksOf(feed: DiaryFeed | null): MentionTask[] {
  const out: MentionTask[] = [];
  for (const item of feed ? [...feed.today, ...feed.earlier] : []) {
    if (item.kind !== "conversation") continue;
    const c = item.conversation;
    for (const t of c.tasks) {
      if (!t.taskId) continue;
      const asked = c.messages.find((m) => m.id === t.noteId);
      out.push({ taskId: t.taskId, noteId: t.noteId, asker: c.asker.first, day: (asked?.at ?? c.openedAt).slice(0, 10) });
    }
  }
  return out;
}

/** The task as a reply finds it. */
export type TaskNow = {
  open: boolean;
  dueDate: string | null;
  /** A reminder hour someone set by hand. */
  remindAt: string | null;
  /** The words a reply already moved it by, if any. */
  dueSaid: string | null;
};

export type TaskChange = { to: "due"; dueDate: string; dueSaid: string | null } | { to: "done" };

/** What a reply of yours to the asker does to the task their ask made
    (see the note at the top). Null is nothing. */
export function taskAfterReply(
  kind: Exclude<AskKind, "none">,
  reply: Pick<ReplyRead, "says" | "dueDate" | "dueSaid">,
  task: TaskNow,
): TaskChange | null {
  if (!task.open) return null;
  switch (reply.says) {
    case "done":
      return { to: "done" };
    case "answer":
      return kind === "question" ? { to: "done" } : null;
    case "when":
      if (!reply.dueDate || task.remindAt) return null;
      if (reply.dueDate === task.dueDate && reply.dueSaid === task.dueSaid) return null;
      return { to: "due", dueDate: reply.dueDate, dueSaid: reply.dueSaid };
    case "later":
    case "none":
      return null;
  }
}
