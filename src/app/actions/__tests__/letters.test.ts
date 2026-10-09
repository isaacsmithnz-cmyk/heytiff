/* Letters in Admin: admin and up; a letter is changed by whoever wrote it,
   whoever signs it, or the owner; and a signature goes on only when its
   owner saves the letter, and comes off when anyone else does. */

let role = "admin";
let staffId: string | null = "staff-1";
let existing: Record<string, unknown> | null = null;
let signerCard: Record<string, unknown> | null = { id: "staff-2" };

type Op = { table: string; op: string; values?: Record<string, unknown>; filters: [string, string, unknown][] };
const ops: Op[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const op: Op = { table, op: "select", filters: [] };
      ops.push(op);
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.insert = (values: Record<string, unknown>) => {
        op.op = "insert";
        op.values = values;
        return q;
      };
      q.update = (values: Record<string, unknown>) => {
        op.op = "update";
        op.values = values;
        return q;
      };
      q.delete = () => {
        op.op = "delete";
        return q;
      };
      q.eq = (col: string, val: unknown) => {
        op.filters.push(["eq", col, val]);
        return q;
      };
      q.maybeSingle = async () => ({ data: table === "staff_profiles" ? signerCard : existing });
      q.single = async () => ({ data: { id: "new-letter" }, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
      return q;
    },
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(async () => ({ orgId: "org-1", userId: "auth0|u" })),
  getDbRole: jest.fn(async () => role),
}));
jest.mock("@/lib/workboard/projects-query", () => ({ staffIdFor: jest.fn(async () => staffId) }));

import { deleteLetter, saveLetter } from "../letters";

const row = (over: Record<string, unknown> = {}) => ({
  id: "l-1",
  title: "",
  letter_date: "2026-10-09",
  recipient: "",
  subject: "Employment confirmation",
  body: { type: "doc", content: [] },
  signer_staff_id: "staff-2",
  with_signature: true,
  created_by_staff_id: "staff-2",
  updated_at: "2026-10-09T00:00:00Z",
  ...over,
});
const input = (over: Record<string, unknown> = {}) => ({
  id: null,
  title: "",
  date: "2026-10-09",
  recipient: "Department of Home Affairs",
  subject: "Employment confirmation",
  body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
  signerStaffId: "staff-1",
  withSignature: true,
  ...over,
});
const writes = () => ops.filter((o) => o.op !== "select");

beforeEach(() => {
  role = "admin";
  staffId = "staff-1";
  existing = null;
  signerCard = { id: "staff-1" };
  ops.length = 0;
});

it("keeps Letters to admins and the owner", async () => {
  role = "staff";
  expect(await saveLetter(input())).toEqual({ ok: false, error: "Letters are in Admin, for admins and the owner." });
  expect(writes()).toEqual([]);
});

it("saves a new letter in the writer's name, with their own signature when they sign it", async () => {
  const res = await saveLetter(input());
  expect(res).toEqual(expect.objectContaining({ ok: true, id: "new-letter", withSignature: true }));
  const [w] = writes();
  expect(w).toEqual(expect.objectContaining({ table: "letters", op: "insert" }));
  expect(w.values).toEqual(expect.objectContaining({ org_id: "org-1", created_by_staff_id: "staff-1", signer_staff_id: "staff-1", with_signature: true }));
});

it("never puts on somebody else's signature", async () => {
  signerCard = { id: "staff-2" };
  const res = await saveLetter(input({ signerStaffId: "staff-2", withSignature: true }));
  expect(res).toEqual(expect.objectContaining({ ok: true, withSignature: false }));
  expect(writes()[0].values?.with_signature).toBe(false);
});

it("takes a signature off when anyone but its owner saves the letter", async () => {
  existing = row({ created_by_staff_id: "staff-1", signer_staff_id: "staff-2", with_signature: true });
  signerCard = { id: "staff-2" };
  await saveLetter(input({ id: "l-1", signerStaffId: "staff-2", withSignature: true }));
  const [w] = writes();
  expect(w.op).toBe("update");
  expect(w.values?.with_signature).toBe(false);
  expect(w.filters).toEqual(expect.arrayContaining([["eq", "org_id", "org-1"], ["eq", "id", "l-1"]]));
});

it("refuses a signer who isn't on this workspace's staff", async () => {
  signerCard = null;
  expect(await saveLetter(input({ signerStaffId: "staff-x" }))).toEqual({ ok: false, error: "That signer isn't on this workspace's staff." });
  expect(writes()).toEqual([]);
});

it("lets only the writer, the signer or the owner change or delete a letter", async () => {
  existing = row({ created_by_staff_id: "staff-3", signer_staff_id: "staff-4" });
  expect(await saveLetter(input({ id: "l-1" }))).toEqual({
    ok: false,
    error: "Only whoever wrote it, whoever signs it, or the owner can change this letter.",
  });
  expect(await deleteLetter("l-1")).toEqual({ ok: false, error: "Only whoever wrote it, whoever signs it, or the owner can delete this letter." });
  expect(writes()).toEqual([]);

  role = "owner";
  expect(await deleteLetter("l-1")).toEqual({ ok: true });
  expect(writes().map((w) => [w.table, w.op])).toEqual([["letters", "delete"]]);
});

it("says so when the letter is already gone", async () => {
  expect(await deleteLetter("l-9")).toEqual({ ok: false, error: "That letter is already gone." });
});
