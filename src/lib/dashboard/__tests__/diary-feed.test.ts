/* The diary's two pure halves: threading ServiceM8 notes into conversations,
   and putting those beside your own entries in one column.

   The people and the jobs are the real ones the design was drawn from
   (Luke's asks of Isaac in September 2026); the words after the first are
   examples. */

import {
  buildConversations,
  diaryFeed,
  FOLLOW_ON_DAYS,
  jobDoorLabel,
  sortStamp,
  type DiaryConversation,
  type MentionNote,
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
    expect(c.messages).toEqual([{ id: "n1", from: "them", text: "Please call Mary to discuss", at: "2026-09-21 13:42:10" }]);
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
    // measured from HIS previous message, so a chain of follow-ups carries on
    const chain = note("j-2749", LUKE.uuid, "2026-09-14 09:00:00", "she'll be home after 3");
    expect(build([ask, soon, chain])[0].messages.map((m) => m.id)).toEqual([ask.uuid, soon.uuid, chain.uuid]);
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
    isDebrief: false,
    stamp,
    routed: true,
    taskFor: {},
  });
  const conversation = (key: string, lastTheirs: string): DiaryConversation =>
    ({ key, lastTheirs }) as DiaryConversation;

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
      syncedAt: null,
    });
    expect(feed.today).toHaveLength(1);
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
