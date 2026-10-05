/**
 * @jest-environment node
 */

/* Workspace delete, re-decided on the server: HQ only, the typed name must
   match, and the database's answer is what the screen says. */

type Row = Record<string, unknown>;

let hq = true;
let org: Row | null = null;
let seats: Row[] = [];
let profiles: Row[] = [];
let rpcAnswer: { data: unknown; error: unknown } = { data: "deleted", error: null };
const rpcCalls: [string, unknown][] = [];

jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/hq/guard", () => ({
  requireHq: async () => {
    if (!hq) throw new Error("Not authorized");
    return { email: "hq@hey-tiff.com", userId: "auth0|hq" };
  },
}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return rpcAnswer;
    },
    from: (table: string) => {
      const filters: { col: string; op: string; v: unknown }[] = [];
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      for (const op of ["eq", "neq", "in"]) {
        chain[op] = (col: string, v: unknown) => {
          filters.push({ col, op, v });
          return chain;
        };
      }
      const rows = (): Row[] => {
        const all = table === "memberships" ? seats : table === "profiles" ? profiles : [];
        return all.filter((r) =>
          filters.every((f) =>
            f.op === "eq" ? r[f.col] === f.v
            : f.op === "neq" ? r[f.col] !== f.v
            : (f.v as unknown[]).includes(r[f.col])
          )
        );
      };
      chain.maybeSingle = async () => ({ data: table === "organizations" ? org : null, error: null });
      chain.then = (res: (v: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(res);
      return chain;
    },
  },
}));

import { deleteWorkspace } from "../hq-workspaces";

beforeEach(() => {
  hq = true;
  org = { name: "grok.test.1@hey-tiff-test.com" };
  seats = [
    { org_id: "org-test", user_id: "auth0|grok" },
    { org_id: "org-test", user_id: "auth0|both" },
    { org_id: "org-real", user_id: "auth0|both" },
  ];
  profiles = [
    { user_id: "auth0|grok", email: "grok.test.1@hey-tiff-test.com" },
    { user_id: "auth0|both", email: "both@example.com" },
  ];
  rpcAnswer = { data: "deleted", error: null };
  rpcCalls.length = 0;
});

test("only HQ staff reach it", async () => {
  hq = false;
  await expect(deleteWorkspace("org-test", "grok.test.1@hey-tiff-test.com")).rejects.toThrow();
  expect(rpcCalls).toHaveLength(0);
});

test("a name that doesn't match deletes nothing", async () => {
  const res = await deleteWorkspace("org-test", "grok.test");
  expect(res).toEqual({ ok: false, error: "The name doesn't match." });
  expect(rpcCalls).toHaveLength(0);
});

test("a workspace that is already gone says so", async () => {
  org = null;
  const res = await deleteWorkspace("org-test", "anything");
  expect(res.ok).toBe(false);
  expect(rpcCalls).toHaveLength(0);
});

test("the database decides, as the person deleting", async () => {
  const res = await deleteWorkspace("org-test", "  grok.test.1@hey-tiff-test.com ");
  expect(rpcCalls).toEqual([
    ["hq_delete_workspace", { p_org: "org-test", p_actor: "auth0|hq", p_actor_email: "hq@hey-tiff.com" }],
  ]);
  // a login with a seat elsewhere is not left over; the test's own is
  expect(res).toEqual({ ok: true, logins: ["grok.test.1@hey-tiff-test.com"] });
});

test.each([
  ["own", "You belong to this workspace, so it can't be deleted from here."],
  ["in_use", "It holds records now, so nothing was deleted."],
  ["not_found", "That workspace is already gone."],
  ["something new", "Couldn't delete it."],
])("the database's %s is what the screen says", async (answer, error) => {
  rpcAnswer = { data: answer, error: null };
  expect(await deleteWorkspace("org-test", "grok.test.1@hey-tiff-test.com")).toEqual({ ok: false, error });
});

test("a database error deletes nothing it can claim", async () => {
  rpcAnswer = { data: null, error: { message: "boom" } };
  expect(await deleteWorkspace("org-test", "grok.test.1@hey-tiff-test.com")).toEqual({
    ok: false,
    error: "Couldn't delete it.",
  });
});
