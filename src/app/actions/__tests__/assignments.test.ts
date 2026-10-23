/* "Got it" stamps one column on your own task, and nothing else. */

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
      chain.or = note("or");
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

import { acknowledgeTask } from "../assignments";

beforeEach(() => {
  calls.length = 0;
  updates.length = 0;
  rows = {};
  lists = {};
  session = { user: { sub: "auth0|me" }, orgId: "org-1" };
  staffId = "staff-me";
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
