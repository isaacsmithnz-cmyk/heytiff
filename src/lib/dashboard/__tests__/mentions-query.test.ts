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
    return Promise.resolve({ data: tables[name] ?? [], error: null }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

const ours = new Set<string>();
const sm8Ours = jest.fn(async () => ours);
jest.mock("@/lib/integrations/sm8-echo", () => ({ sm8Ours: (...a: unknown[]) => sm8Ours(...(a as [])) }));

import { listMyMentions, MENTION_LIMIT, THREAD_LIMIT } from "../mentions-query";

const STAFF = [
  { uuid: "u-isaac", first: "Isaac", last: "Smith" },
  { uuid: "u-luke", first: "Luke", last: "Ingold" },
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
  calls.length = 0;
  ours.clear();
  sm8Ours.mockClear();
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

it("leaves out what HeyTiff wrote itself, mirrored back", async () => {
  tables.asks = [
    row("n1", "j-2041", "u-luke", "2026-09-21 13:42:10", "@isaacsmith Please call Mary"),
    row("n-echo", "j-3294", "u-luke", "2026-09-22 09:00:00", "@isaacsmith sent from HeyTiff"),
  ];
  ours.add("n-echo");

  const out = await listMyMentions("org-1", "u-isaac", "2026-09-25");

  expect(sm8Ours).toHaveBeenCalledWith("org-1", expect.arrayContaining(["n1", "n-echo"]));
  expect(out.map((c) => c.askNoteUuid)).toEqual(["n1"]);
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
