/* THE BELL GROUP IS A FILTER, so the filter is what these pin.

   There is no scheduler and no delivery state — "does this ring" is decided
   fresh on every read by four clauses, and getting any one of them wrong is
   invisible until somebody's bell either never rings or never stops. */

const calls: { table: string; op: string; args: unknown[] }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};
let lists: Record<string, Record<string, unknown>[]> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const note =
        (op: string) =>
        (...args: unknown[]) => {
          calls.push({ table, op, args });
          return chain;
        };
      chain.select = note("select");
      chain.eq = note("eq");
      chain.neq = note("neq");
      chain.is = note("is");
      chain.in = note("in");
      chain.order = note("order");
      chain.limit = note("limit");
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.then = (res: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: lists[table] ?? [], error: null }).then(res);
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let session: unknown = { user: { sub: "auth0|me" }, orgId: "org-1" };
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
let staffId: string | null = "staff-me";
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => staffId }));

import { acknowledgeTask, myNewAssignments } from "../assignments";

const clause = (op: string, ...args: unknown[]) =>
  calls.some(
    (c) => c.op === op && args.every((a, i) => JSON.stringify(c.args[i]) === JSON.stringify(a)),
  );

beforeEach(() => {
  calls.length = 0;
  updates.length = 0;
  rows = {};
  lists = {};
  session = { user: { sub: "auth0|me" }, orgId: "org-1" };
  staffId = "staff-me";
});

describe("myNewAssignments", () => {
  it("asks for OPEN, MINE, UNACKNOWLEDGED work that somebody ELSE made", async () => {
    await myNewAssignments();
    expect(clause("eq", "org_id", "org-1")).toBe(true);
    expect(clause("eq", "assigned_to", "staff-me")).toBe(true);
    expect(clause("eq", "status", "open")).toBe(true);
    expect(clause("is", "acknowledged_at", null)).toBe(true);
    /* A SELF-TASK NEVER RINGS — you were there when it was made, and a bell
       that reads back what you just typed is what teaches people to ignore
       the bell. */
    expect(clause("neq", "created_by", "staff-me")).toBe(true);
  });

  it("resolves the giver's display name, and shrugs when there isn't one", async () => {
    lists.tasks = [
      { id: "t-1", title: "Order the box", detail: null, created_by: "staff-luke", due_date: "2026-09-04", created_at: "2026-08-28T09:00:00.000Z" },
      { id: "t-2", title: "Ring the builder", detail: null, created_by: null, due_date: null, created_at: "2026-08-28T08:00:00.000Z" },
    ];
    lists.staff_profiles = [{ id: "staff-luke", first_name: "Luke", last_name: "Ingold" }];

    const out = await myNewAssignments();
    expect(out[0]).toMatchObject({ taskId: "t-1", fromName: "Luke Ingold", dueDate: "2026-09-04" });
    /* A task whose author has no staff card is still work somebody gave you. */
    expect(out[1]).toMatchObject({ taskId: "t-2", fromName: null, dueDate: null });
  });

  it("answers empty rather than throwing for someone with no staff card", async () => {
    /* This drives a badge in the topbar on every screen — a topbar that
       throws is a worse answer than a topbar with nothing on it. */
    staffId = null;
    expect(await myNewAssignments()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("answers empty when nobody is signed in", async () => {
    session = null;
    expect(await myNewAssignments()).toEqual([]);
  });
});

describe("acknowledgeTask", () => {
  it("stamps the column the bell reads and nothing else", async () => {
    rows.tasks = { assigned_to: "staff-me", status: "open" };
    const res = await acknowledgeTask("t-1");
    expect(res).toEqual({ ok: true });
    const patch = updates[0].patch;
    /* ACKNOWLEDGING IS NOT DOING: the status, the due date and the reminder
       are all left exactly where they were. */
    expect(Object.keys(patch).sort()).toEqual(["acknowledged_at", "updated_at"]);
  });

  it("refuses somebody else's task — a bell is not a team object", async () => {
    rows.tasks = { assigned_to: "staff-someone-else", status: "open" };
    const res = await acknowledgeTask("t-1");
    expect(res).toEqual({ ok: false, error: "That task isn't yours." });
    expect(updates).toHaveLength(0);
  });

  it("refuses a task that isn't in this workspace", async () => {
    rows.tasks = null;
    expect((await acknowledgeTask("t-1")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    session = null;
    expect((await acknowledgeTask("t-1")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
