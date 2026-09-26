/* The reads behind the diary's conversations. What can go wrong here is
   reading the wrong person's mentions, reading the mirror for somebody it
   can't name, and showing HeyTiff's own notes back to it — each has a test
   that fails without its guard. */

type Call = {
  table: string;
  columns?: string;
  eq: Record<string, unknown>;
  in?: [string, string[]];
  ilike?: [string, string];
  gte?: [string, string];
  order?: [string, { ascending?: boolean }];
  limit?: number;
};

let tables: Record<string, Record<string, unknown>[]> = {};
let asksError: unknown = null;
let jobsError: unknown = null;
/** A read of this table fails with this. */
let tableErrors: Record<string, unknown> = {};
const calls: Call[] = [];

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => ((call.columns = cols), chain);
  chain.eq = (col: string, val: unknown) => ((call.eq[col] = val), chain);
  chain.in = (col: string, vals: string[]) => ((call.in = [col, vals]), chain);
  chain.ilike = (col: string, pat: string) => ((call.ilike = [col, pat]), chain);
  chain.gte = (col: string, val: string) => ((call.gte = [col, val]), chain);
  chain.order = (col: string, o: { ascending?: boolean }) => ((call.order = [col, o]), chain);
  chain.limit = (n: number) => ((call.limit = n), chain);
  chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
    if (name === "sm8_job_notes") {
      const key = call.ilike ? "asks" : "thread";
      return Promise.resolve({ data: call.ilike && asksError ? null : tables[key] ?? [], error: call.ilike ? asksError : null }).then(res);
    }
    if (name === "sm8_jobs" && jobsError) return Promise.resolve({ data: null, error: jobsError }).then(res);
    if (tableErrors[name]) return Promise.resolve({ data: null, error: tableErrors[name] }).then(res);
    return Promise.resolve({ data: tables[name] ?? [], error: null }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

/* As the real one answers: which of the uuids it was GIVEN are ours. */
const ours = new Set<string>();
const sm8Ours = jest.fn(async (_org: string, ids: readonly string[]) => new Set(ids.filter((id) => ours.has(id))));
/* The uuids ServiceM8's copies of HeyTiff's own notes carry, by note. */
const copiesOf = new Map<string, string[]>();
const sm8CopiesOf = jest.fn(async (_org: string, ids: readonly string[]) => new Set(ids.flatMap((id) => copiesOf.get(id) ?? [])));
jest.mock("@/lib/integrations/sm8-echo", () => ({
  sm8Ours: (...a: unknown[]) => sm8Ours(...(a as [string, string[]])),
  sm8CopiesOf: (...a: unknown[]) => sm8CopiesOf(...(a as [string, string[]])),
}));

import { listMyMentions, MENTION_LIMIT, THREAD_LIMIT } from "../mentions-query";
import type { OurReply } from "../diary-feed";

const STAFF = [
  { uuid: "u-isaac", first: "Isaac", last: "Smith" },
  { uuid: "u-luke", first: "Luke", last: "Ingold" },
  { uuid: "u-michael", first: "Michael", last: "Diamond" },
  { uuid: "u-brent", first: "Brent (Service)", last: "Gilmore" },
];

const row = (uuid: string, job: string, author: string, at: string, note: string, related: string | null = "job") => ({
  uuid,
  related_object: related,
  related_object_uuid: job,
  note,
  edit_by_staff_uuid: author,
  create_date: at,
});

const of = (t: string) => calls.filter((c) => c.table === t);
const notesReads = () => of("sm8_job_notes");

beforeEach(() => {
  tables = { sm8_staff: STAFF };
  asksError = null;
  jobsError = null;
  tableErrors = {};
  calls.length = 0;
  ours.clear();
  sm8Ours.mockClear();
  copiesOf.clear();
  sm8CopiesOf.mockClear();
});

it("reads the mentions of the viewer's own handle, from the link, and nobody else's", async () => {
  tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary")];
  tables.sm8_jobs = [{ uuid: "j-2041", generated_job_id: "2041", geo_city: "Wollstonecraft", active: 1 }];

  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");

  const [asks] = notesReads();
  expect(asks.eq).toEqual({ org_id: "org-1", active: 1 });
  expect(asks.ilike).toEqual(["note", "%@isaacsmith%"]);
  // sixty days back on the account's clock
  expect(asks.gte).toEqual(["create_date", "2026-07-27"]);
  expect(asks.order).toEqual(["create_date", { ascending: false }]);
  expect(asks.limit).toBe(MENTION_LIMIT);

  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    jobLabel: "2041 Wollstonecraft",
    jobLive: true,
    asker: { name: "Luke Ingold" },
    messages: [{ text: "Please call Mary" }],
  });
});

it("reads nothing from the mirror for a person the roster can't find", async () => {
  tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary")];
  expect(await listMyMentions("org-1", "u-not-in-servicem8", "2026-09-25")).toEqual([]);
  expect(notesReads()).toHaveLength(0);
});

it("reads nothing for a handle a mention can never be written with", async () => {
  /* "brent(service)gilmore" can't be matched by the mention regex, and its
     brackets have no place in a filter */
  expect(await listMyMentions("org-1", "u-brent", "2026-09-25")).toEqual([]);
  expect(notesReads()).toHaveLength(0);
});

it("reads the threads only on the asked jobs, from the earliest ask on, and labels those jobs", async () => {
  tables.asks = [
    row("n2", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
    row("n1", "j-2749", "u-luke", "2026-09-09 10:00:00", "@isaacsmith can you advise Holly"),
  ];
  tables.thread = [row("n3", "j-2041", "u-isaac", "2026-09-22 15:10:00", "@lukeingold calling her this afternoon")];

  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");

  const thread = notesReads()[1];
  expect(thread.in).toEqual(["related_object_uuid", ["j-2041", "j-2749"]]);
  expect(thread.gte).toEqual(["create_date", "2026-09-09 10:00:00"]);
  expect(thread.eq).toEqual({ org_id: "org-1", active: 1 });
  expect(thread.limit).toBe(THREAD_LIMIT);
  expect(of("sm8_jobs")[0].in).toEqual(["uuid", ["j-2041", "j-2749"]]);
  expect(of("sm8_jobs")[0].eq).toEqual({ org_id: "org-1" });

  expect(out.find((c) => c.jobUuid === "j-2041")?.messages.map((m) => m.from)).toEqual(["them", "you"]);
});

it("makes no thread read when nothing is really an ask", async () => {
  tables.asks = [
    // the ILIKE lets these through; neither is Luke asking Isaac
    row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmithy grab the gauges"),
    row("n2", "j-2041", "u-isaac", "2026-09-21 13:45:00", "@isaacsmith note to self"),
  ];
  expect(await listMyMentions("org-1", "u-isaac", "2026-09-25")).toEqual([]);
  expect(notesReads()).toHaveLength(1);
  expect(of("sm8_jobs")).toHaveLength(0);
});

it("leaves out what HeyTiff wrote itself, mirrored back, asking only about the conversations' messages", async () => {
  tables.asks = [
    row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
    row("n-echo", "j-3294", "u-luke", "2026-09-22 09:00:00", "@isaacsmith sent from HeyTiff"),
  ];
  tables.thread = [
    // on the asked jobs, but in no conversation: never asked about
    row("n-other", "j-2041", "u-luke", "2026-09-21 14:00:00", "@michaeldiamond grab the ladder"),
    row("n-mine", "j-2041", "u-isaac", "2026-09-21 16:00:00", "Unit tested, all good"),
  ];
  ours.add("n-echo");

  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");

  expect(sm8Ours).toHaveBeenCalledTimes(1);
  expect([...sm8Ours.mock.calls[0][1]].sort()).toEqual(["n-echo", "n1"]);
  expect(out.map((c) => c.askNoteUuid)).toEqual(["n1"]);
});

it("asks again only about a note that joins once an echo is out", async () => {
  /* HeyTiff posted "@lukeingold done" as Isaac. Without it the ask is
     unanswered, so Luke's note the next day follows on, and that note has
     not been asked about yet. */
  tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-23 10:00:00", "@isaacsmith call Mary")];
  tables.thread = [
    row("n-echo", "j-2041", "u-isaac", "2026-09-24 10:00:00", "@lukeingold done"),
    row("n-next", "j-2041", "u-luke", "2026-09-25 08:00:00", "Invoice sent to client"),
  ];
  ours.add("n-echo");

  const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25");

  expect(sm8Ours.mock.calls.map((call) => [...call[1]].sort())).toEqual([["n-echo", "n1"], ["n-next"]]);
  expect(c.messages.map((m) => m.id)).toEqual(["n1", "n-next"]);
  expect(c).toMatchObject({ answered: false, fresh: true });
});

/* YOUR REPLY FROM HEYTIFF (two-way phase 2): the diary hands in your
   replies as your entries come back; each is threaded where the note it
   answers is, and its copy, known from HeyTiff's side, is never drawn
   beside it — even when sm8Ours knows nothing (its read failed). */
describe("your replies from HeyTiff", () => {
  const REPLY: OurReply = {
    id: "wn-1",
    to: "n1",
    jobUuid: "j-2041",
    words: "@lukeingold on my way",
    at: "2026-09-24 10:00:00",
    savedAt: "2026-09-24T00:00:00.000000+00:00",
    line: { text: "In ServiceM8", tone: "ok", again: null, ask: null },
  };
  const page = () => {
    tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-23 10:00:00", "@isaacsmith call Mary")];
    tables.thread = [row("r-copy", "j-2041", "u-isaac", "2026-09-24 10:00:05", "@lukeingold on my way")];
  };

  it("are threaded as HeyTiff saved them, and their copy is left out whatever sm8Ours says", async () => {
    page();
    copiesOf.set("wn-1", ["r-copy"]);
    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { replies: Promise.resolve([REPLY]) });
    expect(c.messages.map((m) => [m.id, m.from, m.text])).toEqual([
      ["n1", "them", "call Mary"],
      ["wn-1", "you", "on my way"],
    ]);
    expect(c.messages[1].ours).toEqual({ jobUuid: "j-2041", line: REPLY.line });
    // one read of their copies, by HeyTiff's rows
    expect(sm8CopiesOf.mock.calls.map((call) => call[1])).toEqual([["wn-1"]]);
    // HeyTiff's own row, and the copy already known, are never asked about
    expect(sm8Ours.mock.calls.flatMap((call) => [...call[1]])).toEqual(["n1"]);
  });

  it("read no copies, and ask sm8Ours as before, when there are none", async () => {
    page();
    ours.add("r-copy");
    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { replies: Promise.resolve([]) });
    expect(sm8CopiesOf).not.toHaveBeenCalled();
    expect(c.messages.map((m) => m.id)).toEqual(["n1"]);
    await listMyMentions("org-1", "u-isaac", "2026-09-25");
    expect(sm8CopiesOf).not.toHaveBeenCalled();
  });

  it("leave the conversations as they were when their read failed", async () => {
    page();
    ours.add("r-copy");
    /* rejected only when asked, so nothing is left unhandled meanwhile */
    const failed: PromiseLike<OurReply[]> = {
      then: (_ok, fail) => Promise.resolve(fail?.(new Error("boom"))) as never,
    };
    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { replies: failed });
    expect(c.messages.map((m) => m.id)).toEqual(["n1"]);
    expect(sm8CopiesOf).not.toHaveBeenCalled();
  });
});

it("says a job ServiceM8 deleted isn't live, so it gets no Reply", async () => {
  tables.asks = [row("n1", "j-2749", "u-luke", "2026-09-09 10:00:00", "@isaacsmith can you advise Holly")];
  tables.sm8_jobs = [{ uuid: "j-2749", generated_job_id: 2749, geo_city: "Woolloomooloo", active: 0 }];
  const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25");
  expect(c).toMatchObject({ jobLabel: "2749 Woolloomooloo", jobLive: false });
});

/* Only the copy saying so makes a job gone: a read that failed, or a job
   it holds no row for, would otherwise say "That job isn't in ServiceM8's
   copy any more." over every conversation, and take their doors away. */
it("keeps every job live when the jobs read fails, and says so in the log", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  jobsError = { message: "boom" };
  tables.asks = [
    row("n2", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
    row("n1", "j-2749", "u-luke", "2026-09-09 10:00:00", "@isaacsmith can you advise Holly"),
  ];
  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");
  expect(out.map((c) => [c.jobUuid, c.jobLive, c.jobLabel])).toEqual([
    ["j-2041", true, null],
    ["j-2749", true, null],
  ]);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

it("keeps a job the copy holds no row for live, and names the one it does", async () => {
  tables.asks = [
    row("n2", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
    row("n1", "j-2749", "u-luke", "2026-09-09 10:00:00", "@isaacsmith can you advise Holly"),
  ];
  tables.sm8_jobs = [{ uuid: "j-2041", generated_job_id: 2041, geo_city: "Wollstonecraft", active: 1 }];
  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");
  expect(out.map((c) => [c.jobUuid, c.jobLive, c.jobLabel])).toEqual([
    ["j-2041", true, "2041 Wollstonecraft"],
    ["j-2749", true, null],
  ]);
});

it("takes only notes on a job", async () => {
  tables.asks = [
    row("n1", "c-1", "u-luke", "2026-09-21 13:42:10", "@isaacsmith the client rang", "company"),
    row("n2", "j-2041", "u-luke", "2026-09-21 13:43:00", "@isaacsmith Please call Mary", "JOB"),
  ];
  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");
  expect(out.map((c) => c.askNoteUuid)).toEqual(["n2"]);
});

it("shows nothing, and says so in the log, when the mentions read fails", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  asksError = { message: "boom" };
  tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary")];
  expect(await listMyMentions("org-1", "u-isaac", "2026-09-25")).toEqual([]);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

/* H18: each ask of you is one task, and the diary says so under the
   conversation. The tasks are the viewer's own, read with the workspace. */
describe("the tasks the asks made", () => {
  beforeEach(() => {
    tables.asks = [row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary")];
    tables.thread = [row("n2", "j-2041", "u-luke", "2026-09-23 08:00:00", "@isaacsmith did you get hold of her?")];
  });

  it("are read for the viewer's own staff card, for this conversation's asks, and only the ones read", async () => {
    tables.mention_asks = [
      {
        sm8_note_uuid: "n1",
        kind: "do",
        task_id: "t-mary",
        due_said: "this afternoon",
        due_said_on: "2026-09-25",
        due_said_for: "2026-09-25",
      },
    ];
    tables.tasks = [{ id: "t-mary", status: "open", due_date: "2026-09-25", assigned_to: "s-isaac" }];

    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });

    const [asked] = of("mention_asks");
    expect(asked.eq).toEqual({ org_id: "org-1", staff_id: "s-isaac", status: "read" });
    expect(asked.in).toEqual(["sm8_note_uuid", ["n1", "n2"]]);
    const [task] = of("tasks");
    expect(task.eq).toEqual({ org_id: "org-1" });
    expect(task.in).toEqual(["id", ["t-mary"]]);
    expect(c.tasks).toEqual([
      { noteId: "n1", taskId: "t-mary", done: false, dueSaid: "this afternoon", ownerId: "s-isaac" },
    ]);
  });

  /* "Calling her this afternoon", said on Thursday: on Friday the task is
     late, and the door says so plainly rather than "this afternoon". And a
     task given to Leo since is Leo's. */
  it("say the words for when only on the day they were said, and whose the task is now", async () => {
    tables.mention_asks = [
      {
        sm8_note_uuid: "n1",
        kind: "do",
        task_id: "t-mary",
        due_said: "this afternoon",
        due_said_on: "2026-09-24",
        due_said_for: "2026-09-24",
      },
    ];
    tables.tasks = [{ id: "t-mary", status: "open", due_date: "2026-09-24", assigned_to: "s-leo" }];
    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });
    expect(of("tasks")[0].columns).toBe("id, status, due_date, assigned_to");
    expect(c.tasks).toEqual([{ noteId: "n1", taskId: "t-mary", done: false, dueSaid: null, ownerId: "s-leo" }]);
  });

  it("are not read at all without a staff card to read them for", async () => {
    const [c] = await listMyMentions("org-1", "u-isaac", "2026-09-25");
    expect(of("mention_asks")).toHaveLength(0);
    expect(c.tasks).toEqual([]);
  });

  it("are none, quietly, before the table exists; and none, in the log, when a read fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    tableErrors = { mention_asks: { code: "PGRST205" } };
    const [before] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });
    expect(before.tasks).toEqual([]);
    expect(spy).not.toHaveBeenCalled();

    /* a task whose state can't be read is not said to be gone, or done */
    tableErrors = { tasks: { message: "boom" } };
    tables.mention_asks = [
      { sm8_note_uuid: "n1", kind: "do", task_id: "t-mary", due_said: null, due_said_on: null, due_said_for: null },
    ];
    const [after] = await listMyMentions("org-1", "u-isaac", "2026-09-25", { staffId: "s-isaac" });
    expect(after.tasks).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reads no roster when the caller already has it", async () => {
    await listMyMentions("org-1", "u-isaac", "2026-09-25", {
      people: [
        { uuid: "u-isaac", handle: "isaacsmith", name: "Isaac Smith", first: "Isaac" },
        { uuid: "u-luke", handle: "lukeingold", name: "Luke Ingold", first: "Luke" },
      ],
    });
    expect(of("sm8_staff")).toHaveLength(0);
    expect(notesReads()[0].ilike).toEqual(["note", "%@isaacsmith%"]);
  });
});
