/* What the diary says over, in and under a ServiceM8 conversation, and
   which item a door from another face names. The people and the jobs are
   the real ones the design was drawn from (Luke's asks of Isaac in
   September 2026); the replies are examples. */

import {
  conversationHead,
  conversationUnder,
  diaryHolds,
  diaryItemOf,
  JOB_GONE_LINE,
  litMessage,
  messageHead,
  SOURCE_LINE,
  stampWhen,
} from "../diary-conversation";
import { buildConversations, diaryFeed, type DiaryConversation, type MentionNote } from "../diary-feed";
import type { DiaryEntry } from "../journal";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";

const ISAAC: Sm8Person = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
const LUKE: Sm8Person = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
const TODAY = "2026-09-25";
const J2041 = "3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11";
const J2749 = "7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

let n = 0;
const note = (jobUuid: string, author: string, at: string, text: string): MentionNote => ({
  uuid: `n${++n}`,
  jobUuid,
  author,
  at,
  text,
});
const talk = (notes: MentionNote[], jobs = new Map([[J2041, { label: "2041 Wollstonecraft", live: true }]])) =>
  buildConversations({
    notes,
    me: { uuid: ISAAC.uuid, handle: ISAAC.handle },
    people: [ISAAC, LUKE],
    jobs,
    today: TODAY,
  });

beforeEach(() => {
  n = 0;
});

describe("when", () => {
  it("is the time alone today, and the date and the time before it", () => {
    expect(stampWhen(`${TODAY} 08:15:00`, TODAY)).toBe("8:15 am");
    expect(stampWhen("2026-09-21 13:42:10", TODAY)).toBe("Mon 21 Sept, 1:42 pm");
    expect(stampWhen("2026-09-21 00:05:00", TODAY)).toBe("Mon 21 Sept, 12:05 am");
    expect(stampWhen("2026-09-21 12:00:00", TODAY)).toBe("Mon 21 Sept, 12:00 pm");
    expect(stampWhen("", TODAY)).toBe("");
  });
});

describe("over the ask and in the thread", () => {
  const [c] = talk([
    note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss"),
    note(J2041, LUKE.uuid, "2026-09-22 09:42:00", "her number is on the card"),
    note(J2041, ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon"),
    note(J2041, LUKE.uuid, `${TODAY} 08:15:00`, "@isaacsmith thanks, she's expecting you"),
  ]);

  it("heads the conversation with who asked and when they asked, whatever came after", () => {
    expect(conversationHead(c!, TODAY)).toEqual({ who: "Luke Ingold", rest: " to you, Mon 21 Sept, 1:42 pm" });
  });

  it("says who each later message was to: you to him, him to you, and his note on the job to nobody", () => {
    const heads = c!.messages.slice(1).map((m) => messageHead(m, c!, TODAY));
    expect(heads).toEqual([
      { who: "Luke Ingold", rest: ", Tue 22 Sept, 9:42 am" },
      { who: "You", rest: " to Luke, Tue 22 Sept, 3:10 pm" },
      { who: "Luke Ingold", rest: " to you, 8:15 am" },
    ]);
  });
});

describe("what is lit", () => {
  it("is his answer, while it is today's and yours hasn't followed it", () => {
    const notes = [
      note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note(J2041, ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon"),
      note(J2041, LUKE.uuid, `${TODAY} 08:15:00`, "@isaacsmith thanks"),
    ];
    const [c] = talk(notes);
    expect(litMessage(c!)).toEqual({ head: false, id: "n3" });
    const [answered] = talk([...notes, note(J2041, ISAAC.uuid, `${TODAY} 09:00:00`, "@lukeingold done")]);
    expect(litMessage(answered!)).toBeNull();
  });

  it("is the whole conversation when the ask itself is today's", () => {
    const [c] = talk([note(J2041, LUKE.uuid, `${TODAY} 07:00:00`, "@isaacsmith call Mary")]);
    expect(litMessage(c!)).toEqual({ head: true });
  });

  it("is nothing for a conversation from before today", () => {
    const [c] = talk([note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith call Mary")]);
    expect(litMessage(c!)).toBeNull();
  });
});

describe("under it", () => {
  it("is the job's door, Reply to the job in ServiceM8, and where it came from", () => {
    const [c] = talk([note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith call Mary")]);
    expect(conversationUnder(c!)).toEqual({
      job: { uuid: J2041, label: "2041 Wollstonecraft" },
      tasks: null,
      reply: `https://go.servicem8.com/OpenJob/${J2041}`,
      lines: [SOURCE_LINE],
    });
    expect(SOURCE_LINE).toBe("A job note in ServiceM8.");
  });

  /* #809: nothing goes to a job its business deleted. The Diary spec's
     words, verbatim: the ones the desk's card says for a job that has
     gone, whatever the job was called. */
  it("is no door and no Reply for a deleted job, and says it has gone, in #809's words exactly", () => {
    const [c] = talk(
      [note(J2749, LUKE.uuid, "2026-09-09 10:04:00", "@isaacsmith can you advise Holly")],
      new Map([[J2749, { label: "2749 Woolloomooloo", live: false }]]),
    );
    expect(conversationUnder(c!)).toEqual({
      job: null,
      tasks: null,
      reply: null,
      lines: [SOURCE_LINE, "That job isn't in ServiceM8's copy any more."],
    });
    expect(JOB_GONE_LINE).toBe("That job isn't in ServiceM8's copy any more.");
  });

  it("offers no Reply for a job whose id ServiceM8 could not open", () => {
    const [c] = talk([note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith call Mary")], new Map([
      ["j-2041", { label: "2041 Wollstonecraft", live: true }],
    ]));
    expect(conversationUnder(c!)).toMatchObject({ job: { uuid: "j-2041" }, reply: null });
  });
});

/* H18: each ask is ONE task for you, and the conversation has a door to
   it — the Diary spec's words, verbatim. */
describe("the task an ask made", () => {
  const asked = (tasks: DiaryConversation["tasks"], jobs?: Map<string, { label: string; live: boolean }>) => {
    const [c] = talk([note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith call Mary")], jobs);
    return { ...c!, tasks };
  };
  const t = (over: Partial<DiaryConversation["tasks"][number]> = {}) => ({
    noteId: "n1",
    taskId: "t-mary",
    done: false,
    dueSaid: null,
    ...over,
  });

  it("is a door to it, between the job and Reply: '1 task for you'", () => {
    expect(conversationUnder(asked([t()]))).toEqual({
      job: { uuid: J2041, label: "2041 Wollstonecraft" },
      tasks: { text: "1 task for you", ids: ["t-mary"] },
      reply: `https://go.servicem8.com/OpenJob/${J2041}`,
      lines: [SOURCE_LINE],
    });
  });

  it("says when once your reply said when, and 'Task done' once it is ticked", () => {
    expect(conversationUnder(asked([t({ dueSaid: "this afternoon" })])).tasks).toEqual({
      text: "1 task for you, this afternoon",
      ids: ["t-mary"],
    });
    expect(conversationUnder(asked([t({ done: true })])).tasks).toEqual({ text: "Task done", ids: ["t-mary"] });
  });

  it("counts the open ones when two asks made two, and names no one time for two", () => {
    const two = asked([t(), t({ noteId: "n2", taskId: "t-fans", dueSaid: "tomorrow" })]);
    expect(conversationUnder(two).tasks).toEqual({ text: "2 tasks for you", ids: ["t-mary", "t-fans"] });
    const oneDone = asked([t({ done: true }), t({ noteId: "n2", taskId: "t-fans" })]);
    expect(conversationUnder(oneDone).tasks).toEqual({ text: "1 task for you", ids: ["t-fans"] });
  });

  it("says a task since deleted as a sentence, as an entry does", () => {
    expect(conversationUnder(asked([t({ taskId: null })]))).toMatchObject({
      tasks: null,
      lines: ["1 task removed.", SOURCE_LINE],
    });
  });

  it("is a sentence, not a door, when no row on the page holds the task", () => {
    expect(conversationUnder(asked([t()]), new Set(["t-other"]))).toMatchObject({
      tasks: null,
      lines: ["1 task for you.", SOURCE_LINE],
    });
    expect(conversationUnder(asked([t()]), new Set(["t-mary"])).tasks).toEqual({ text: "1 task for you", ids: ["t-mary"] });
  });

  it("keeps its task door on a job its business deleted: the task is yours either way", () => {
    const gone = asked([t()], new Map([[J2041, { label: "2041 Wollstonecraft", live: false }]]));
    expect(conversationUnder(gone)).toMatchObject({
      job: null,
      reply: null,
      tasks: { text: "1 task for you", ids: ["t-mary"] },
    });
  });
});

describe("the item a door names", () => {
  const entry: DiaryEntry = {
    id: "e1",
    said: "Van booked in for Tuesday",
    day: TODAY,
    at: "7:30 am",
    outcomes: [],
    spoken: false,
    stamp: `${TODAY} 07:30:00`,
    routed: false,
    taskFor: {},
    turns: [],
    undo: false,
    undone: false,
  };
  /* built in each test, after the note numbers start again */
  const feedOf = () => {
    const conversations: DiaryConversation[] = talk([
      note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note(J2041, ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her"),
      note(J2041, LUKE.uuid, "2026-09-23 08:00:00", "@isaacsmith and the quote?"),
    ]);
    return diaryFeed({ entries: [entry], conversations, day: TODAY, mentions: true, entriesCut: false, syncedAt: null });
  };

  it("finds an entry by its id, and a conversation by any of its notes", () => {
    const feed = feedOf();
    expect(diaryItemOf(feed, { kind: "entry", ids: ["e1"] })).toBe("entry:e1");
    expect(diaryItemOf(feed, { kind: "conversation", ids: ["n1"] })).toBe(`mention:${J2041}:u-luke`);
    // a second ask of his, which joined the first one's conversation
    expect(diaryItemOf(feed, { kind: "conversation", ids: ["n3"] })).toBe(`mention:${J2041}:u-luke`);
  });

  it("finds nothing the diary does not hold, or of another kind", () => {
    const feed = feedOf();
    expect(diaryItemOf(feed, { kind: "conversation", ids: ["gone"] })).toBeNull();
    expect(diaryItemOf(feed, { kind: "conversation", ids: ["e1"] })).toBeNull();
    expect(diaryItemOf(feed, { kind: "entry", ids: ["n1"] })).toBeNull();
    expect(diaryItemOf(feed, { kind: "entry", ids: [] })).toBeNull();
  });
});

describe("what a door can land on", () => {
  const entryOn = (id: string, day: string): DiaryEntry => ({
    id,
    said: "Van booked in for Tuesday",
    day,
    at: "7:30 am",
    outcomes: [],
    spoken: false,
    stamp: `${day} 07:30:00`,
    routed: false,
    taskFor: {},
    turns: [],
    undo: false,
    undone: false,
  });

  /* With mentions read, the column reaches back sixty days and no further,
     whatever the page's journal holds: an entry from before then has no
     place to land, and neither has an ask the diary holds no conversation
     for. */
  it("is every entry and every note the diary holds, and nothing past its horizon", () => {
    const conversations = talk([
      note(J2041, LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note(J2041, ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her"),
    ]);
    const feed = diaryFeed({
      entries: [entryOn("e-now", TODAY), entryOn("e-july", "2026-07-20")],
      conversations,
      day: TODAY,
      mentions: true,
      entriesCut: false,
      syncedAt: null,
    });
    const holds = diaryHolds(feed);
    expect([...holds.entries]).toEqual(["e-now"]);
    expect([...holds.notes].sort()).toEqual(["n1", "n2"]);
  });

  it("is nothing without a diary", () => {
    const holds = diaryHolds(null);
    expect(holds.entries.size + holds.notes.size).toBe(0);
  });
});
