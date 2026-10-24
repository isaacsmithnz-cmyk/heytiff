import { buildConversations, type DiaryFeed } from "../diary-feed";
import { feedEventsOf } from "../feed-events";
import type { TodoRow } from "../todo";
import { inFilter, yourFeed } from "../your-feed";

/* Your feed (Isaac, 20 October 2026: in place of Activity, built as the
   board drew it). What it holds, in what order, and what each item does. */

const TODAY = "2026-10-20";
const JOB = "3f2b8c1e-0d4a-4b6f-9a2e-1c5d7e9f0a11";

const talk = (notes: { uuid: string; text: string; author: string; at: string }[]) =>
  buildConversations({
    notes: notes.map((n) => ({ ...n, jobUuid: JOB })),
    me: { uuid: "u-isaac", handle: "isaacsmith" },
    people: [
      { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" },
      { uuid: "u-luke", handle: "lukep", name: "Luke Parker", first: "Luke" },
    ],
    jobs: new Map([[JOB, { label: "2674 Clovelly", live: true }]]),
    today: TODAY,
  });

const diaryOf = (conversations: ReturnType<typeof talk>): DiaryFeed => ({
  day: TODAY,
  today: conversations.map((c) => ({ kind: "conversation" as const, key: c.key, sortAt: c.lastTheirs, conversation: c })),
  earlier: [],
  mentions: true,
  syncedAt: null,
});

const row = (key: string, name: string, over: Partial<TodoRow> = {}): TodoRow => ({
  key,
  source: "alert",
  col: "activity",
  tone: "look",
  name,
  line: "",
  lineTone: false,
  tick: null,
  act: { kind: "link", label: "Review", href: "/x" },
  ...over,
});

const feed = (input: Partial<Parameters<typeof yourFeed>[0]> = {}) =>
  yourFeed({ rows: [], diary: null, events: [], today: TODAY, now: "2026-10-20 13:05:00", since: "2026-10-13", ...input });

describe("to you", () => {
  it("is a mention, with their words, its time, new until you answer, and Reply on the note that asked", () => {
    const [item] = feed({ diary: diaryOf(talk([{ uuid: "n1", text: "@isaacsmith can you order two grille filters?", author: "u-luke", at: "2026-10-20 12:52:00" }])) });
    expect(item).toMatchObject({
      filter: "you",
      who: { name: "Luke Parker", sm8: false },
      what: "mentioned you on 2674 Clovelly",
      said: "can you order two grille filters?",
      when: "12:52 pm",
      unread: true,
      reply: { jobUuid: JOB, sourceNoteUuid: "n1", closesTaskId: null },
      act: { kind: "link", label: "Open the job" },
    });
  });

  it("shows your last word under theirs once you've answered, and is no longer new", () => {
    const [item] = feed({
      diary: diaryOf(
        talk([
          { uuid: "n1", text: "@isaacsmith can you order two grille filters?", author: "u-luke", at: "2026-10-20 12:52:00" },
          { uuid: "n2", text: "@lukep ordering them now", author: "u-isaac", at: "2026-10-20 12:58:00" },
        ]),
      ),
    });
    expect(item).toMatchObject({ unread: false, yours: "ordering them now" });
  });

  it("leaves out a conversation gone quiet for more than a week", () => {
    expect(feed({ diary: diaryOf(talk([{ uuid: "n1", text: "@isaacsmith ring Mary", author: "u-luke", at: "2026-10-01 09:00:00" }])) })).toEqual([]);
  });

  it("counts work given to you as to you, new, with Got it", () => {
    const [item] = feed({ rows: [row("assignment:t1", "Order the PEAD", { source: "assignment", act: { kind: "gotit", taskId: "t1" } })] });
    expect(item).toMatchObject({ filter: "you", unread: true, act: { kind: "gotit", taskId: "t1" } });
  });
});

describe("approvals and jobs", () => {
  it("files leave, timesheets and certificate wording under Approvals, ServiceM8's refusals under Jobs", () => {
    const items = feed({
      rows: [
        row("alert:leave-queue:1", "Leave to approve"),
        row("timesheets", "Timesheets", { source: "timesheets" }),
        row("alert:cert-wording:1", "Certificate wording"),
        row("alert:sm8-writes:1", "ServiceM8 didn't take a note"),
      ],
    });
    expect(inFilter(items, "approvals").map((i) => i.who.name)).toEqual(["Leave to approve", "Timesheets", "Certificate wording"]);
    expect(inFilter(items, "jobs").map((i) => i.who.name)).toEqual(["ServiceM8 didn't take a note"]);
  });

  it("says what came in from ServiceM8: a new job, a check-in, photos counted per person", () => {
    const events = feedEventsOf({
      jobs: [{ uuid: "j1", generated_job_id: "3444", geo_city: "Stanmore", job_description: "Construction project\nlevel 2", date: "2026-10-20 10:02:00", work_order_date: null, quote_date: null, status: "Quote" }],
      acts: [{ uuid: "a1", job_uuid: "j2", staff_uuid: "s-luke", start_date: "2026-10-20 07:30:00" }, { uuid: "a2", job_uuid: "j2", staff_uuid: "s-luke", start_date: "2026-10-20 12:30:00" }],
      atts: [1, 2, 3].map((i) => ({ uuid: `p${i}`, related_object_uuid: "j2", created_by_staff_uuid: "s-luke", timestamp: `2026-10-20 1${i}:00:00`, file_type: ".jpg" })),
      label: (id) => (id === "j1" ? "3444 Stanmore" : "2674 Clovelly"),
      nameOf: new Map([["s-luke", "Luke Parker"]]),
      since: "2026-10-19",
    });
    const items = feed({ events });
    expect(items.map((i) => [i.who.name, i.what, i.when])).toEqual([
      ["Luke Parker", "added 3 photos to 2674 Clovelly", "1:00 pm"],
      ["New job", "3444 Stanmore", "10:02 am"],
      ["Luke Parker", "checked in at 2674 Clovelly", "7:30 am"],
    ]);
    expect(items.find((i) => i.who.name === "New job")).toMatchObject({ said: "Construction project", filter: "jobs" });
  });
});

/* Isaac, 24 October 2026: "Everything on that feed and notes should be interactive" */
describe("what an item opens", () => {
  it("opens a mention's job, an approval's page, work given as its task, and what came in on its job", () => {
    const [talkItem] = feed({ diary: diaryOf(talk([{ uuid: "n1", text: "@isaacsmith ring Mary", author: "u-luke", at: "2026-10-20 12:52:00" }])) });
    expect(talkItem.open).toEqual({ href: `/dashboard/jobs/${JOB}` });
    const rows = feed({
      rows: [
        row("alert:leave-queue:1", "Leave to approve", { act: { kind: "link", label: "Review", href: "/dashboard/team?view=leave" } }),
        row("assignment:t1", "Order the PEAD", { source: "assignment", act: { kind: "gotit", taskId: "t1" } }),
        row("issue:i1", "Ute 2's reverse camera is out again", { act: { kind: "issue", issueId: "i1", title: "Ute 2's reverse camera is out again" } }),
      ],
    });
    expect(rows.find((i) => i.key === "alert:leave-queue:1")?.open).toEqual({ href: "/dashboard/team?view=leave" });
    expect(rows.find((i) => i.key === "assignment:t1")?.open).toEqual({ taskId: "t1" });
    expect(rows.find((i) => i.key === "issue:i1")?.open).toBeNull();
    const events = feedEventsOf({
      jobs: [],
      acts: [{ uuid: "a1", job_uuid: "j2", staff_uuid: "s-luke", start_date: "2026-10-20 07:30:00" }],
      atts: [{ uuid: "p1", related_object_uuid: "j2", created_by_staff_uuid: "s-luke", timestamp: "2026-10-20 11:00:00", file_type: ".jpg" }],
      label: () => "2674 Clovelly",
      nameOf: new Map([["s-luke", "Luke Parker"]]),
      since: "2026-10-19",
    });
    expect(feed({ events }).map((i) => i.open)).toEqual([{ href: "/dashboard/jobs/j2?tab=photos" }, { href: "/dashboard/jobs/j2" }]);
  });
});

/* New › Note (Isaac, 24 October 2026): a note to you or the office is to
   you, with Reply and Done; a note is never made a task */
describe("a note", () => {
  const msg = (id: string, authorId: string, name: string, body: string, at: string) => ({ id, authorId, name, body, at });
  const thread = (over: Partial<import("../shared-notes").NoteThread> = {}): import("../shared-notes").NoteThread => ({
    threadId: "t-1",
    rootAuthorId: "s-david",
    jobUuid: null,
    jobLabel: null,
    toOffice: true,
    viaOffice: true,
    messages: [msg("n1", "s-david", "David Hann", "Ute 2's reverse camera is out again", "2026-10-20 09:42")],
    ...over,
  });

  it("to the office says so, with their words, new today, and the note's own Reply and Done", () => {
    const [item] = feed({ notes: [thread()], me: "s-isaac" });
    expect(item).toMatchObject({
      key: "note:t-1",
      filter: "you",
      who: { name: "David Hann", sm8: false },
      what: "wrote to the office",
      said: "Ute 2's reverse camera is out again",
      yours: null,
      when: "9:42 am",
      unread: true,
      act: null,
      reply: null,
      open: null,
      note: "t-1",
    });
  });

  it("to you by name, on a job, opens the job", () => {
    const [item] = feed({ notes: [thread({ toOffice: false, viaOffice: false, jobUuid: "j-3450", jobLabel: "3450 Kingsford" })], me: "s-isaac" });
    expect(item).toMatchObject({ what: "wrote to you on 3450 Kingsford", open: { href: "/dashboard/jobs/j-3450" } });
  });

  it("an answer to your own note comes back to you, your words under theirs", () => {
    const answered = thread({
      viaOffice: false,
      messages: [
        msg("n1", "s-david", "David Hann", "Ute 2's reverse camera is out again", "2026-10-19 09:42"),
        msg("n2", "s-isaac", "Isaac Smith", "Booked it in for Tuesday", "2026-10-20 10:05"),
      ],
    });
    const [item] = feed({ notes: [answered], me: "s-david" });
    expect(item).toMatchObject({ who: { name: "Isaac Smith" }, what: "answered your note", said: "Booked it in for Tuesday", yours: "Ute 2's reverse camera is out again" });
  });

  it("is left out when every word in it is yours", () => {
    expect(feed({ notes: [thread()], me: "s-david" })).toEqual([]);
  });
});

describe("the order", () => {
  it("is newest first, with what waits on you now at the top of today", () => {
    const items = feed({
      rows: [row("timesheets", "Timesheets", { source: "timesheets" })],
      diary: diaryOf(talk([{ uuid: "n1", text: "@isaacsmith ring Mary", author: "u-luke", at: "2026-10-20 09:00:00" }])),
    });
    expect(items.map((i) => i.who.name)).toEqual(["Timesheets", "Luke Parker"]);
  });
});
