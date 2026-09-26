/**
 * @jest-environment node
 */

/* THE JOB CARD'S STRIP GOES QUIET ON AN ASK TIFF MADE A TASK OF (H18). The
   strip offers a note that @mentions somebody as a task to make; once the
   new Home has made that ask one person's task, offering it again would
   make a second. So the note is answered, and the task stands on the strip
   as a task row instead — the one it is, whoever it is on. A deleted task
   is still an ask somebody dealt with. An ask read as asking nothing, or a
   table not there yet, leaves the strip as it was. */

type Call = { table: string; eq: Record<string, unknown>; in?: [string, unknown[]] };
const calls: Call[] = [];
let tables: Record<string, Record<string, unknown>[]> = {};
let errors: Record<string, unknown> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, eq: {} };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => ((call.eq[c] = v), q);
      q.in = (c: string, v: unknown[]) => ((call.in = [c, v]), q);
      q.order = () => q;
      q.limit = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve(
          errors[table] ? { data: null, error: errors[table] } : { data: tables[table] ?? [], error: null },
        ).then(res);
      return q;
    },
  },
}));
jest.mock("@/lib/integrations/links", () => ({ sm8StaffLinkMap: async () => new Map([["u-isaac", "s-isaac"]]) }));
jest.mock("@/lib/integrations/sm8-echo", () => ({ sm8Ours: async () => new Set<string>() }));
jest.mock("@/lib/dashboard/tasks-query", () => ({
  NAME_COLUMNS: "id, first_name, last_name, full_name, preferred_name",
  mentionableStaff: async () => [],
}));

import { readJobAttention } from "../job-notes-query";

const ORG = "org-1";
const JOB = "j-2041";
/* Luke's real ask of Isaac, 21 September 2026. */
const ASK = {
  remoteId: "n-mary",
  text: "@isaacsmith Please call Mary to discuss",
  writtenBy: "Luke Ingold",
  writtenAt: "2026-09-21 13:42:10",
  actionRequired: false,
};
const read = () => readJobAttention(ORG, JOB, { notes: [ASK], jobOpen: true, today: "2026-09-25" });
const kinds = (r: Awaited<ReturnType<typeof read>>) => r.attention.items.map((i) => `${i.kind}:${"title" in i ? i.title : i.key}`);

beforeEach(() => {
  calls.length = 0;
  errors = {};
  tables = {
    sm8_staff: [
      { uuid: "u-isaac", first: "Isaac", last: "Smith" },
      { uuid: "u-luke", first: "Luke", last: "Ingold" },
    ],
    staff_profiles: [{ id: "s-isaac", first_name: "Isaac", last_name: "Smith" }],
  };
});

it("offers the ask as a mention while nothing has been made of it", async () => {
  expect(kinds(await read())).toEqual(["mention:mention:n-mary"]);
});

it("goes quiet on an ask Tiff made a task of, and shows that task instead", async () => {
  tables.mention_asks = [{ sm8_note_uuid: "n-mary", task_id: "t-mary" }];
  tables.tasks = [{ id: "t-mary", title: "Call Mary about 2041 Wollstonecraft", due_date: null, assigned_to: "s-isaac" }];

  expect(kinds(await read())).toEqual(["task:Call Mary about 2041 Wollstonecraft"]);

  const [asked] = calls.filter((c) => c.table === "mention_asks");
  expect(asked.eq).toEqual({ org_id: ORG, sm8_job_uuid: JOB, status: "read" });
  expect(asked.in).toEqual(["kind", ["do", "question"]]);
  expect(calls.filter((c) => c.table === "mention_asks")).toHaveLength(1);
  expect(calls.find((c) => c.table === "tasks")?.in).toEqual(["id", ["t-mary"]]);
});

it("stays quiet on an ask whose task was deleted since: somebody dealt with it", async () => {
  tables.mention_asks = [{ sm8_note_uuid: "n-mary", task_id: null }];
  expect(kinds(await read())).toEqual([]);
});

it("is as it was before the table exists", async () => {
  errors = { mention_asks: { code: "PGRST205", message: "no table" } };
  expect(kinds(await read())).toEqual(["mention:mention:n-mary"]);
});
