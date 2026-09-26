/* ONE TASK PER ASK, pure (H18): which messages are asks, what each became
   under its conversation and on the list, and what your reply does to the
   task — which is never to make a second one. The people and jobs are the
   real ones the design was drawn from (Luke's asks of Isaac, September
   2026); the replies are examples. */

import { buildConversations, diaryFeed, type MentionNote } from "../diary-feed";
import { asksIn, mentionTasksOf, taskAfterReply, withAskTasks, type TaskNow } from "../mention-asks";
import type { ReplyRead } from "@/lib/workboard/mention-brain";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";

const ISAAC: Sm8Person = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
const LUKE: Sm8Person = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
const TODAY = "2026-09-25";

const note = (uuid: string, author: string, at: string, text: string, jobUuid = "j-2041"): MentionNote => ({
  uuid,
  jobUuid,
  author,
  at,
  text,
});
const talk = (notes: MentionNote[]) =>
  buildConversations({
    notes,
    me: { uuid: ISAAC.uuid, handle: ISAAC.handle },
    people: [ISAAC, LUKE],
    jobs: new Map([
      ["j-2041", { label: "2041 Wollstonecraft", live: true }],
      ["j-3294", { label: "3294 Rozelle", live: true }],
    ]),
    today: TODAY,
  });

const ASK = note("n-ask", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss");
const HIS_NUMBER = note("n-num", LUKE.uuid, "2026-09-22 09:42:00", "her number is on the card");
const MINE = note("n-mine", ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon");
const AGAIN = note("n-again", LUKE.uuid, "2026-09-23 08:00:00", "@isaacsmith did you get hold of her?");

describe("which messages are asks", () => {
  it("is every note of the asker's to you: the ask, and each later one that mentions you — not his note to the job, and not yours", () => {
    const [c] = talk([ASK, HIS_NUMBER, MINE, AGAIN]);
    expect(c.messages.map((m) => m.id)).toEqual(["n-ask", "n-num", "n-mine", "n-again"]);
    expect(asksIn(c).map((m) => m.id)).toEqual(["n-ask", "n-again"]);
  });
});

describe("what each ask became", () => {
  it("is a task per ask that made one, oldest first: open, done, or deleted since", () => {
    const [c] = withAskTasks(
      talk([ASK, MINE, AGAIN]),
      [
        { sm8_note_uuid: "n-again", kind: "do", task_id: "t-chase", due_said: null },
        { sm8_note_uuid: "n-ask", kind: "do", task_id: "t-mary", due_said: "this afternoon" },
      ],
      new Map([["t-mary", { done: true }], ["t-chase", { done: false }]]),
    );
    expect(c.tasks).toEqual([
      { noteId: "n-ask", taskId: "t-mary", done: true, dueSaid: "this afternoon" },
      { noteId: "n-again", taskId: "t-chase", done: false, dueSaid: null },
    ]);
  });

  it("is no task for an ask read as asking nothing", () => {
    const [c] = withAskTasks(
      talk([ASK]),
      [{ sm8_note_uuid: "n-ask", kind: "none", task_id: null, due_said: null }],
      new Map(),
    );
    expect(c.tasks).toEqual([]);
  });

  it("says a task deleted since — or one the task read didn't find — is gone, never open", () => {
    const [c] = withAskTasks(
      talk([ASK]),
      [{ sm8_note_uuid: "n-ask", kind: "question", task_id: "t-gone", due_said: null }],
      new Map(),
    );
    expect(c.tasks).toEqual([{ noteId: "n-ask", taskId: null, done: false, dueSaid: null }]);
  });

  it("only joins an ask to the conversation that holds it", () => {
    const out = withAskTasks(
      talk([ASK, note("n-fans", LUKE.uuid, "2026-09-15 08:00:00", "@isaacsmith how many fans", "j-3294")]),
      [{ sm8_note_uuid: "n-fans", kind: "question", task_id: "t-fans", due_said: null }],
      new Map([["t-fans", { done: false }]]),
    );
    expect(out.map((c) => [c.jobUuid, c.tasks.map((t) => t.taskId)])).toEqual([
      ["j-2041", []],
      ["j-3294", ["t-fans"]],
    ]);
  });
});

describe("the list's word for it", () => {
  it("is whose ask, its day, and the note that asked, for each task still there", () => {
    const [c] = withAskTasks(
      talk([ASK, MINE, AGAIN]),
      [
        { sm8_note_uuid: "n-ask", kind: "do", task_id: "t-mary", due_said: null },
        { sm8_note_uuid: "n-again", kind: "do", task_id: "t-gone", due_said: null },
      ],
      new Map([["t-mary", { done: false }]]),
    );
    const feed = diaryFeed({ entries: [], conversations: [c], day: TODAY, mentions: true, entriesCut: false, syncedAt: null });
    expect(mentionTasksOf(feed)).toEqual([{ taskId: "t-mary", noteId: "n-ask", asker: "Luke", day: "2026-09-21" }]);
    expect(mentionTasksOf(null)).toEqual([]);
  });
});

describe("what your reply does to the task", () => {
  const open: TaskNow = { open: true, dueDate: null, remindAt: null, dueSaid: null };
  const says = (s: ReplyRead["says"], dueDate: string | null = null, dueSaid: string | null = null): ReplyRead => ({
    says: s,
    dueDate,
    dueSaid,
  });

  it("moves it to the day it names, keeping its words", () => {
    expect(taskAfterReply("do", says("when", "2026-09-22", "this afternoon"), open)).toEqual({
      to: "due",
      dueDate: "2026-09-22",
      dueSaid: "this afternoon",
    });
  });

  it("ticks it off when it says it's done", () => {
    expect(taskAfterReply("do", says("done"), open)).toEqual({ to: "done" });
  });

  it("ticks off a question once answered, and never a thing to do", () => {
    expect(taskAfterReply("question", says("answer"), open)).toEqual({ to: "done" });
    expect(taskAfterReply("do", says("answer"), open)).toBeNull();
  });

  it("changes nothing for a promise with no time, putting it off, or a reply about something else", () => {
    expect(taskAfterReply("do", says("later"), open)).toBeNull();
    expect(taskAfterReply("question", says("later"), open)).toBeNull();
    expect(taskAfterReply("do", says("none"), open)).toBeNull();
  });

  it("leaves a task that is done, or given an hour by hand, where it is", () => {
    expect(taskAfterReply("do", says("done"), { ...open, open: false })).toBeNull();
    expect(taskAfterReply("do", says("when", "2026-09-22", "today"), { ...open, remindAt: "2026-09-24T23:00:00Z" })).toBeNull();
  });

  it("says nothing new when it names the day and the words the task already has", () => {
    const moved: TaskNow = { ...open, dueDate: "2026-09-22", dueSaid: "this afternoon" };
    expect(taskAfterReply("do", says("when", "2026-09-22", "this afternoon"), moved)).toBeNull();
    expect(taskAfterReply("do", says("when", "2026-09-23", "tomorrow"), moved)).toEqual({
      to: "due",
      dueDate: "2026-09-23",
      dueSaid: "tomorrow",
    });
  });
});
