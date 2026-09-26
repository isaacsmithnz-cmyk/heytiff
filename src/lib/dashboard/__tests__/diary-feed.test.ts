/* The diary's two pure halves: threading ServiceM8 notes into conversations,
   and putting those beside your own entries in one column.

   The people and the jobs are the real ones the design was drawn from
   (Luke's asks of Isaac in September 2026); the words after the first are
   examples. */

import {
  buildConversations,
  diaryFeed,
  FOLLOW_ON_DAYS,
  MENTION_DAYS,
  jobDoorLabel,
  sortStamp,
  type DiaryConversation,
  type MentionNote,
  type OurReply,
} from "../diary-feed";
import type { DiaryEntry } from "../journal";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";

const ISAAC: Sm8Person = { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" };
const LUKE: Sm8Person = { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" };
const MICHAEL: Sm8Person = { uuid: "u-michael", handle: "michaeldiamond", name: "Michael Diamond", first: "Michael" };
const SMITHY: Sm8Person = { uuid: "u-smithy", handle: "isaacsmithy", name: "Isaac Smithy", first: "Isaac" };
const people = [ISAAC, LUKE, MICHAEL, SMITHY];
const me = { uuid: ISAAC.uuid, handle: ISAAC.handle };

const JOBS = new Map([
  ["j-2041", { label: "2041 Wollstonecraft", live: true }],
  ["j-3294", { label: "3294 Rozelle", live: true }],
  ["j-2749", { label: "2749 Woolloomooloo", live: false }],
]);

let n = 0;
const note = (jobUuid: string, author: string | null, at: string, text: string): MentionNote => ({
  uuid: `n${++n}`,
  jobUuid,
  author,
  at,
  text,
});

const build = (notes: MentionNote[], today = "2026-09-25") =>
  buildConversations({ notes, me, people, jobs: JOBS, today });

beforeEach(() => {
  n = 0;
});

describe("buildConversations", () => {
  it("opens a conversation on a note that mentions you, with the handle taken out", () => {
    const [c] = build([note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss")]);
    expect(c).toMatchObject({
      key: "j-2041:u-luke",
      jobUuid: "j-2041",
      jobLabel: "2041 Wollstonecraft",
      jobLive: true,
      asker: { name: "Luke Ingold", first: "Luke", handle: "lukeingold" },
      askNoteUuid: "n1",
      openedAt: "2026-09-21 13:42:10",
      answered: false,
      fresh: false,
    });
    expect(c.messages).toEqual([
      {
        id: "n1",
        from: "them",
        addressed: true,
        text: "Please call Mary to discuss",
        named: "Isaac Please call Mary to discuss",
        at: "2026-09-21 13:42:10",
      },
    ]);
  });

  it("is only the two of you on that job, in time order", () => {
    const out = build([
      note("j-2041", ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon"),
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary to discuss"),
      // Luke to somebody else, on the same job — not to you
      note("j-2041", LUKE.uuid, "2026-09-21 14:00:00", "@michaeldiamond grab the ladder"),
      // you to somebody else
      note("j-2041", ISAAC.uuid, "2026-09-21 14:05:00", "@michaeldiamond thanks"),
      // you to Luke, but on another job
      note("j-3294", ISAAC.uuid, "2026-09-22 09:00:00", "@lukeingold see the fans"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].messages.map((m) => [m.from, m.text])).toEqual([
      ["them", "Please call Mary to discuss"],
      ["you", "calling her this afternoon"],
    ]);
  });

  it("sorts by the asker's newest message, so your reply never moves it", () => {
    const out = build([
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-3294", LUKE.uuid, "2026-09-15 08:00:00", "@isaacsmith how many fans for this to be finalised"),
      // you answer the older one last
      note("j-3294", ISAAC.uuid, "2026-09-24 16:00:00", "@lukeingold four"),
    ]);
    expect(out.map((c) => c.jobUuid)).toEqual(["j-2041", "j-3294"]);
    expect(out[1]).toMatchObject({ lastTheirs: "2026-09-15 08:00:00", lastYours: "2026-09-24 16:00:00", answered: true });
  });

  it("his answer after yours brings it into today, fresh, and the header keeps the ask's date", () => {
    const notes = [
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-2041", ISAAC.uuid, "2026-09-22 15:10:00", "@lukeingold calling her this afternoon"),
    ];
    const before = build(notes)[0];
    expect(before).toMatchObject({ answered: true, fresh: false, lastTheirs: "2026-09-21 13:42:10" });

    const after = build([
      ...notes,
      note("j-2041", LUKE.uuid, "2026-09-25 08:15:00", "@isaacsmith thanks, she's expecting you"),
    ])[0];
    expect(after).toMatchObject({
      openedAt: "2026-09-21 13:42:10",
      lastTheirs: "2026-09-25 08:15:00",
      answered: false,
      fresh: true,
    });
  });

  it("an ask made today and not yet answered is fresh; one from before today is not", () => {
    expect(build([note("j-2041", LUKE.uuid, "2026-09-25 07:00:00", "@isaacsmith call Mary")])[0].fresh).toBe(true);
    expect(build([note("j-2041", LUKE.uuid, "2026-09-24 23:59:00", "@isaacsmith call Mary")])[0].fresh).toBe(false);
  });

  it("an ask made today and answered today is answered, and not fresh", () => {
    const [c] = build([
      note("j-2041", LUKE.uuid, "2026-09-25 07:00:00", "@isaacsmith call Mary"),
      note("j-2041", ISAAC.uuid, "2026-09-25 09:00:00", "@lukeingold done"),
    ]);
    expect(c).toMatchObject({ lastTheirs: "2026-09-25 07:00:00", answered: true, fresh: false });
  });

  it("quotes the ask less its addressing, and names anybody else it asks about", () => {
    const quote = (text: string) =>
      build([note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", text)])[0].messages[0].text;
    expect(quote("Hi @isaacsmith, can you ask @michaeldiamond to bring the ladder")).toBe(
      "Hi, can you ask Michael to bring the ladder",
    );
    expect(quote("@isaacsmith and @michaeldiamond please sort the invoice")).toBe("please sort the invoice");
  });

  it("quotes your reply less the asker's handle, and names the rest", () => {
    const [c] = build([
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-2041", ISAAC.uuid, "2026-09-21 14:00:00", "Rang her, thanks @lukeingold. @michaeldiamond has the key"),
    ]);
    expect(c.messages[1]).toMatchObject({ from: "you", text: "Rang her, thanks. Michael has the key" });
  });

  /* What Tiff reads when she makes an ask a task. The real read of
     2026-09-26 was given the quote, and Alex's note to Luke and to Isaac
     became one task for Isaac with Luke's half in it. */
  it("gives Tiff each message as written: nothing taken out, everybody by name, you by your first", () => {
    const [c] = build([
      note(
        "j-2041",
        LUKE.uuid,
        "2026-09-21 13:42:10",
        "@michaeldiamond can you please book in 6 monthly service\n\n@isaacsmith can you please organise a time to show the girls",
      ),
      note("j-2041", ISAAC.uuid, "2026-09-21 14:00:00", "Will do @lukeingold. @michaeldiamond has the key"),
      note("j-2041", LUKE.uuid, "2026-09-21 15:00:00", "@isaacsmith can you and @isaacsmithy go"),
    ]);
    expect(c.messages.map((m) => m.named)).toEqual([
      "Michael can you please book in 6 monthly service\n\nIsaac can you please organise a time to show the girls",
      "Will do Luke. Michael has the key",
      // you by your first, though another Isaac is said in full
      "Isaac can you and Isaac Smithy go",
    ]);
    // the diary still quotes them less their addressing, which is why Tiff
    // can't read the quote: whose each ask is has gone from it
    expect(c.messages[0].text).toBe("can you please book in 6 monthly service\n\ncan you please organise a time to show the girls");
  });

  it("says a person by full name when another on the roster shares the first", () => {
    const [c] = build([note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith can you and @isaacsmithy go")]);
    expect(c.messages[0].text).toBe("can you and Isaac Smithy go");
  });

  it("makes two conversations when two people ask you on one job", () => {
    const out = build([
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-2041", MICHAEL.uuid, "2026-09-21 13:50:00", "@isaacsmith is the unit in?"),
    ]);
    expect(out.map((c) => c.key).sort()).toEqual(["j-2041:u-luke", "j-2041:u-michael"]);
  });

  it("one note of yours can answer both of them", () => {
    const out = build([
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-2041", MICHAEL.uuid, "2026-09-21 13:50:00", "@isaacsmith is the unit in?"),
      note("j-2041", ISAAC.uuid, "2026-09-21 14:00:00", "@lukeingold @michaeldiamond on it, and yes"),
    ]);
    for (const c of out)
      expect(c.messages[c.messages.length - 1]).toMatchObject({ from: "you", text: "on it, and yes" });
  });

  it("does not count @isaacsmithy as you, or a note of yours that names yourself", () => {
    expect(
      build([
        note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmithy grab the gauges"),
        note("j-2041", ISAAC.uuid, "2026-09-21 13:45:00", "@isaacsmith reminder to self: gauges"),
      ])
    ).toEqual([]);
  });

  it("skips an author the roster can't name", () => {
    expect(build([note("j-2041", "u-gone", "2026-09-21 13:42:10", "@isaacsmith call Mary")])).toEqual([]);
    expect(build([note("j-2041", null, "2026-09-21 13:42:10", "@isaacsmith call Mary")])).toEqual([]);
  });

  it(`takes the asker's follow-up that names nobody within ${FOLLOW_ON_DAYS} days, and not later`, () => {
    const ask = note("j-2749", LUKE.uuid, "2026-09-09 10:00:00", "@isaacsmith can you advise Holly");
    const soon = note("j-2749", LUKE.uuid, "2026-09-11 09:42:00", "Holly's number is on the job card");
    const late = note("j-2749", LUKE.uuid, "2026-09-16 09:00:00", "unit delivered");
    const [c] = build([ask, soon, late]);
    expect(c.messages.map((m) => m.id)).toEqual([ask.uuid, soon.uuid]);
  });

  /* The diary says "Luke Ingold to you" over what he wrote to you, and
     just "Luke Ingold" over a note he wrote on the job that names nobody. */
  it("marks what was written to the other side, and his follow-up that names nobody as not", () => {
    const ask = note("j-2749", LUKE.uuid, "2026-09-09 10:00:00", "@isaacsmith can you advise Holly");
    const soon = note("j-2749", LUKE.uuid, "2026-09-11 09:42:00", "Holly's number is on the job card");
    const yours = note("j-2749", ISAAC.uuid, "2026-09-11 10:00:00", "@lukeingold rang her");
    const again = note("j-2749", LUKE.uuid, "2026-09-12 08:00:00", "@isaacsmith thanks");
    const [c] = build([ask, soon, yours, again]);
    expect(c.messages.map((m) => [m.from, m.addressed])).toEqual([
      ["them", true],
      ["them", false],
      ["you", true],
      ["them", true],
    ]);
  });

  it("measures a follow-up from his last mention of you, so status notes can't chain on", () => {
    const ask = note("j-2749", LUKE.uuid, "2026-09-09 10:00:00", "@isaacsmith can you advise Holly");
    const soon = note("j-2749", LUKE.uuid, "2026-09-11 09:42:00", "Holly's number is on the job card");
    // within 3 days of "soon", but not of the ask
    const chain = note("j-2749", LUKE.uuid, "2026-09-14 09:00:00", "she'll be home after 3");
    expect(build([ask, soon, chain])[0].messages.map((m) => m.id)).toEqual([ask.uuid, soon.uuid]);
    // a new mention starts the window again
    const again = note("j-2749", LUKE.uuid, "2026-09-13 09:00:00", "@isaacsmith any luck?");
    expect(build([ask, soon, again, chain])[0].messages.map((m) => m.id)).toEqual([
      ask.uuid,
      soon.uuid,
      again.uuid,
      chain.uuid,
    ]);
  });

  it("does not take his note that names nobody once you have answered", () => {
    const [c] = build([
      note("j-2041", LUKE.uuid, "2026-09-23 10:00:00", "@isaacsmith call Mary"),
      note("j-2041", ISAAC.uuid, "2026-09-24 10:00:00", "@lukeingold done"),
      note("j-2041", LUKE.uuid, "2026-09-25 08:00:00", "Invoice sent to client"),
    ]);
    expect(c.messages.map((m) => m.text)).toEqual(["call Mary", "done"]);
    expect(c).toMatchObject({ lastTheirs: "2026-09-23 10:00:00", answered: true, fresh: false });
  });

  it("does not take a note of yours that names nobody — a job note is not an answer", () => {
    const [c] = build([
      note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
      note("j-2041", ISAAC.uuid, "2026-09-21 16:00:00", "Unit tested, all good"),
    ]);
    expect(c.messages).toHaveLength(1);
    expect(c.answered).toBe(false);
  });

  it("keeps a deleted job's conversation and says it isn't live; an unknown job has no label", () => {
    const out = build([
      note("j-2749", LUKE.uuid, "2026-09-09 10:00:00", "@isaacsmith can you advise Holly"),
      note("j-9999", LUKE.uuid, "2026-09-10 10:00:00", "@isaacsmith and this one"),
    ]);
    expect(out.find((c) => c.jobUuid === "j-2749")).toMatchObject({ jobLabel: "2749 Woolloomooloo", jobLive: false });
    expect(out.find((c) => c.jobUuid === "j-9999")).toMatchObject({ jobLabel: null, jobLive: false });
  });

  it("drops a note with no date, ServiceM8's '0000-00-00', and a repeat of the same note", () => {
    const ask = note("j-2041", LUKE.uuid, "2026-09-21 13:42:10", "@isaacsmith Please call Mary");
    const out = build([ask, { ...ask }, note("j-3294", LUKE.uuid, "0000-00-00 00:00:00", "@isaacsmith fans?")]);
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(1);
  });
});

describe("diaryFeed", () => {
  const entry = (id: string, stamp: string): DiaryEntry => ({
    id,
    said: `said ${id}`,
    day: stamp.slice(0, 10),
    at: "",
    outcomes: [],
    spoken: false,
    stamp,
    routed: true,
    taskFor: {},
    turns: [],
    undo: false,
    undone: false,
  });
  const conversation = (key: string, lastTheirs: string, lastYours: string | null = null): DiaryConversation =>
    ({ key, lastTheirs, lastYours, messages: [] }) as unknown as DiaryConversation;
  const feedOf = (over: Partial<Parameters<typeof diaryFeed>[0]>) =>
    diaryFeed({ entries: [], conversations: [], day: "2026-09-25", mentions: true, entriesCut: false, syncedAt: null, ...over });

  it("puts journal stamps and ServiceM8 stamps in one order, and splits at today", () => {
    const feed = diaryFeed({
      entries: [entry("e-today", "2026-09-25 08:42"), entry("e-old", "2026-09-08 20:42")],
      conversations: [
        conversation("j-2041:u-luke", "2026-09-25 08:41:59"),
        conversation("j-3294:u-luke", "2026-09-25 08:42:30"),
        conversation("j-2749:u-luke", "2026-09-11 09:42:00"),
      ],
      day: "2026-09-25",
      mentions: true,
      entriesCut: false,
      syncedAt: null,
    });
    expect(feed.today.map((i) => i.key)).toEqual(["mention:j-3294:u-luke", "entry:e-today", "mention:j-2041:u-luke"]);
    expect(feed.earlier.map((i) => i.key)).toEqual(["mention:j-2749:u-luke", "entry:e-old"]);
  });

  it("with no mentions is your own entries, on the day it is given", () => {
    const feed = diaryFeed({
      entries: [entry("e1", "2026-09-24 21:00")],
      conversations: [],
      day: "2026-09-25",
      mentions: false,
      entriesCut: false,
      syncedAt: null,
    });
    expect(feed).toEqual({
      day: "2026-09-25",
      today: [],
      earlier: [expect.objectContaining({ kind: "entry", key: "entry:e1" })],
      mentions: false,
      syncedAt: null,
    });
  });

  it("counts a stamp ahead of our clock as today's", () => {
    const feed = diaryFeed({
      entries: [entry("ahead", "2026-09-26 00:10")],
      conversations: [],
      day: "2026-09-25",
      mentions: false,
      entriesCut: false,
      syncedAt: null,
    });
    expect(feed.today).toHaveLength(1);
  });

  it("places a conversation by his newest message, however recently you replied", () => {
    const feed = feedOf({
      entries: [entry("e-22", "2026-09-22 12:00"), entry("e-18", "2026-09-18 12:00")],
      conversations: [conversation("j-2041:u-luke", "2026-09-20 10:00:00", "2026-09-25 09:00:00")],
    });
    expect(feed.today).toEqual([]);
    expect(feed.earlier.map((i) => i.key)).toEqual(["entry:e-22", "mention:j-2041:u-luke", "entry:e-18"]);
  });

  it("stops at your oldest entry when the entry read was cut, so no stretch is mentions alone", () => {
    const entries = [entry("e-24", "2026-09-24 12:00"), entry("e-20", "2026-09-20 12:00")];
    const conversations = [
      conversation("j-2041:u-luke", "2026-09-21 10:00:00"),
      conversation("j-3294:u-luke", "2026-09-19 10:00:00"),
    ];
    const keys = (f: ReturnType<typeof diaryFeed>) => [...f.today, ...f.earlier].map((i) => i.key);
    expect(keys(feedOf({ entries, conversations, entriesCut: true }))).toEqual([
      "entry:e-24",
      "mention:j-2041:u-luke",
      "entry:e-20",
    ]);
    // a read that wasn't cut holds every entry there is, so the older mention stays
    expect(keys(feedOf({ entries, conversations, entriesCut: false }))).toContain("mention:j-3294:u-luke");
  });

  it(`stops at ${MENTION_DAYS} days when mentions were read, so no stretch is entries alone`, () => {
    // 2026-07-27 is sixty days before the 25th
    const entries = [entry("e-in", "2026-07-27 06:00"), entry("e-out", "2026-07-26 23:59")];
    expect([...feedOf({ entries }).earlier].map((i) => i.key)).toEqual(["entry:e-in"]);
    // without mentions the diary is your entries, as far back as they were read
    expect([...feedOf({ entries, mentions: false }).earlier].map((i) => i.key)).toEqual(["entry:e-in", "entry:e-out"]);
  });
});

describe("the small helpers", () => {
  it("jobDoorLabel says the number and the suburb, whichever exist", () => {
    expect(jobDoorLabel("2041", "Wollstonecraft")).toBe("2041 Wollstonecraft");
    expect(jobDoorLabel("2041", null)).toBe("2041");
    expect(jobDoorLabel(null, " ")).toBeNull();
  });

  it("sortStamp puts a minute and a second in one shape, and refuses a non-date", () => {
    expect(sortStamp("2026-09-21 13:42")).toBe("2026-09-21 13:42:00");
    expect(sortStamp("2026-09-21T13:42:10")).toBe("2026-09-21 13:42:10");
    expect(sortStamp("2026-09-21")).toBe("2026-09-21 00:00:00");
    expect(sortStamp("0000-00-00 00:00:00")).toBe("");
    expect(sortStamp(null)).toBe("");
  });
});

/* YOUR REPLY FROM HEYTIFF (two-way phase 2): a reply sent from a job card,
   or a task's Done, is HeyTiff's own row, queued to ServiceM8 as you, whose
   copy the sync brings back into the mirror. The diary shows it ONCE, in
   the conversation holding the note it answers, from the moment it is
   saved; the copy is the same message. */
describe("your reply from HeyTiff", () => {
  const ASK = { uuid: "n-ask", jobUuid: "j-2041", author: LUKE.uuid, at: "2026-09-25 08:40:00", text: "@isaacsmith Please call Mary" };
  const line = { text: "Sending to ServiceM8…", tone: null, again: null, ask: null } as const;
  const reply = (over: Partial<OurReply> = {}): OurReply => ({
    id: "wn-reply",
    to: "n-ask",
    jobUuid: "j-2041",
    words: "@lukeingold calling her now",
    at: "2026-09-25 09:10",
    line,
    ...over,
  });
  /* ServiceM8's copy of it, as the sync brings it back: signed as you, its
     uuid the one HeyTiff minted for the write */
  const ECHO = { uuid: "R-COPY", jobUuid: "j-2041", author: ISAAC.uuid, at: "2026-09-25 09:10:04", text: "@lukeingold calling her now" };
  const withReplies = (notes: MentionNote[], replies: OurReply[], copies?: string[]) =>
    buildConversations({ notes, me, people, jobs: JOBS, today: "2026-09-25", replies, ...(copies ? { copies: new Set(copies) } : {}) });
  const entryOf = (id: string, stamp: string): DiaryEntry => ({
    id,
    said: "calling her now",
    day: stamp.slice(0, 10),
    at: "",
    outcomes: [],
    spoken: false,
    stamp,
    routed: false,
    taskFor: {},
    turns: [],
    undo: false,
    undone: false,
  });
  const feedWith = (entries: DiaryEntry[], conversations: DiaryConversation[]) =>
    diaryFeed({ entries, conversations, day: "2026-09-25", mentions: true, entriesCut: false, syncedAt: null });
  const keysOf = (f: ReturnType<typeof diaryFeed>) => [...f.today, ...f.earlier].map((i) => i.key);

  it("is threaded under the note it answers from the moment it is saved, before the sync, with its line", () => {
    const [c] = withReplies([ASK], [reply()]);
    expect(c.messages.map((m) => [m.id, m.from, m.text])).toEqual([
      ["n-ask", "them", "Please call Mary"],
      ["wn-reply", "you", "calling her now"],
    ]);
    expect(c.messages[1]).toMatchObject({ addressed: true, at: "2026-09-25 09:10:00", ours: { jobUuid: "j-2041", line } });
    // it answered him: nothing is lit
    expect(c).toMatchObject({ answered: true, fresh: false, lastYours: "2026-09-25 09:10:00" });
  });

  it("is drawn once after the sync: ServiceM8's copy of it is the same message, whatever its case", () => {
    const [c] = withReplies([ASK, ECHO], [reply()], ["r-copy"]);
    expect(c.messages.map((m) => m.id)).toEqual(["n-ask", "wn-reply"]);
    // the copy's words join by name alone; without knowing it, it would be drawn twice
    expect(withReplies([ASK, ECHO], [reply()])[0].messages.map((m) => m.id)).toEqual(["n-ask", "wn-reply", "R-COPY"]);
  });

  it("is not drawn again as your entry once a conversation holds it", () => {
    const conversations = withReplies([ASK], [reply()]);
    const feed = feedWith([entryOf("wn-reply", "2026-09-25 09:10"), entryOf("wn-other", "2026-09-25 09:00")], conversations);
    // and it sorts by his ask, as a reply of yours never moves a conversation
    expect(keysOf(feed)).toEqual(["entry:wn-other", "mention:j-2041:u-luke"]);
  });

  it("stays your entry when no conversation holds the note it answers", () => {
    const conversations = withReplies([ASK], [reply({ to: "n-removed-in-servicem8" })]);
    expect(conversations[0].messages.map((m) => m.id)).toEqual(["n-ask"]);
    expect(conversations[0]).toMatchObject({ answered: false, fresh: true });
    expect(keysOf(feedWith([entryOf("wn-reply", "2026-09-25 09:10")], conversations))).toEqual([
      "entry:wn-reply",
      "mention:j-2041:u-luke",
    ]);
  });

  it("goes by what it answers, not its words: a Done, and a plain Done. that names nobody", () => {
    const later = { uuid: "n-later", jobUuid: "j-2041", author: LUKE.uuid, at: "2026-09-25 08:50:00", text: "@isaacsmith the filters too" };
    const [c] = withReplies(
      [ASK, later],
      [
        reply({ id: "wn-done", to: "n-ask", words: "@lukeingold Done.", at: "2026-09-25 09:00" }),
        reply({ id: "wn-plain", to: "n-later", words: "Done.", at: "2026-09-25 09:05" }),
      ],
    );
    expect(c.messages.map((m) => [m.id, m.text])).toEqual([
      ["n-ask", "Please call Mary"],
      ["n-later", "the filters too"],
      ["wn-done", "Done."],
      ["wn-plain", "Done."],
    ]);
  });

  it("comes after the note it answers when HeyTiff's clock is behind ServiceM8's, and has answered it", () => {
    // saved at 08:39 on HeyTiff's clock, answering a note ServiceM8 stamped 08:40:00
    const [c] = withReplies([ASK], [reply({ at: "2026-09-25 08:39" })]);
    expect(c.messages.map((m) => [m.id, m.at])).toEqual([
      ["n-ask", "2026-09-25 08:40:00"],
      ["wn-reply", "2026-09-25 08:40:00"],
    ]);
    expect(c).toMatchObject({ answered: true, fresh: false });
  });

  it("is your answer: his note after it that names nobody is on the job, not part of the ask", () => {
    const status = { uuid: "n-status", jobUuid: "j-2041", author: LUKE.uuid, at: "2026-09-25 11:00:00", text: "Invoice sent to client" };
    expect(withReplies([ASK, status], [reply()])[0].messages.map((m) => m.id)).toEqual(["n-ask", "wn-reply"]);
    // without it, his note would follow on, as it does before you answer
    expect(withReplies([ASK, status], [])[0].messages.map((m) => m.id)).toEqual(["n-ask", "n-status"]);
  });

  /* The entry read came back full, and its oldest is your reply: the
     entries reach back to it, wherever it is drawn. */
  const cutFeed = (conversations: DiaryConversation[]) =>
    diaryFeed({
      entries: [entryOf("wn-reply", "2026-09-24 09:10"), entryOf("e-new", "2026-09-25 07:00")],
      conversations,
      day: "2026-09-25",
      mentions: true,
      entriesCut: true,
      syncedAt: null,
    });

  it("still marks how far back your entries were read when the read was cut", () => {
    const asked = { ...ASK, at: "2026-09-24 09:00:00" };
    // his answer at 10:00 brings the conversation to then; another ask of you at noon, on another job
    const answer = { uuid: "n-answer", jobUuid: "j-2041", author: LUKE.uuid, at: "2026-09-24 10:00:00", text: "@isaacsmith thanks" };
    const noon = { uuid: "n-noon", jobUuid: "j-3294", author: LUKE.uuid, at: "2026-09-24 12:00:00", text: "@isaacsmith fans?" };
    const feed = cutFeed(withReplies([asked, answer, noon], [reply({ at: "2026-09-24 09:10" })]));
    // both are inside the reach your reply marks, and the reply is drawn once, in its conversation
    expect(keysOf(feed)).toEqual(["entry:e-new", "mention:j-3294:u-luke", "mention:j-2041:u-luke"]);
  });

  it("is your entry when its conversation is past the reach, never dropped", () => {
    // his ask, and so the conversation, is older than the oldest entry read
    const asked = { ...ASK, at: "2026-09-24 09:00:00" };
    const feed = cutFeed(withReplies([asked], [reply({ at: "2026-09-24 09:10" })]));
    expect(keysOf(feed)).toEqual(["entry:e-new", "entry:wn-reply"]);
  });
});
