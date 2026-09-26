/**
 * @jest-environment node
 */

/* The other way round, for notes: the uuids ServiceM8's copy of one of
   HeyTiff's own notes carries — its create's own, and any it replaced — so
   the new Home's diary, which draws your reply as HeyTiff saved it, knows
   its copy when the sync brings it back (lib/dashboard/diary-reply). */

type Call = { columns: string; eq: Record<string, unknown>; in?: [string, string[]] };
type Row = { org_id: string; note_id: string; kind: string; op: string; remote_uuid: string | null; replaced_uuids: string[] | null };

let rows: Row[] = [];
let failWith: { code: string; message: string } | null = null;
let noReplacedColumn = false;
/** The read throws, as a dropped connection does, rather than answering. */
let throwOnRead = false;
const calls: Call[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "sm8_writes") throw new Error(`unexpected table ${table}`);
      const call: Call = { columns: "", eq: {} };
      calls.push(call);
      const q: Record<string, unknown> = {};
      q.select = (cols: string) => ((call.columns = cols), q);
      q.eq = (col: string, v: unknown) => ((call.eq[col] = v), q);
      q.in = async (col: string, list: string[]) => {
        call.in = [col, list];
        if (throwOnRead) throw new Error("socket hang up");
        if (failWith) return { data: null, error: failWith };
        if (noReplacedColumn && call.columns.includes("replaced_uuids")) {
          return { data: null, error: { code: "42703", message: "column replaced_uuids does not exist" } };
        }
        const got = rows.filter(
          (r) => r.org_id === call.eq.org_id && r.kind === call.eq.kind && r.op === call.eq.op && list.includes(r.note_id),
        );
        return {
          data: got.map((r) =>
            call.columns.includes("replaced_uuids")
              ? { note_id: r.note_id, remote_uuid: r.remote_uuid, replaced_uuids: r.replaced_uuids }
              : { note_id: r.note_id, remote_uuid: r.remote_uuid },
          ),
          error: null,
        };
      };
      return q;
    },
  },
}));

import { sm8CopiesOf } from "../sm8-echo";

/* in hex, as a uuid is: uuid(10) ends "…00a", so its capitals differ from it */
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const NOTE = uuid(1);
const OTHER = uuid(2);
const create = (over: Partial<Row>): Row => ({
  org_id: "org-1",
  note_id: NOTE,
  kind: "note",
  op: "create",
  remote_uuid: uuid(10),
  replaced_uuids: [],
  ...over,
});

beforeEach(() => {
  rows = [];
  failWith = null;
  noReplacedColumn = false;
  throwOnRead = false;
  calls.length = 0;
});

it("gives each note's create uuid and every uuid it replaced, lower case, from one read of this workspace's note creates", async () => {
  rows = [
    create({ remote_uuid: uuid(10).toUpperCase(), replaced_uuids: [uuid(11)] }),
    create({ note_id: OTHER, remote_uuid: uuid(20) }),
    // not a note's create: a take-back, a file, and another workspace's
    create({ op: "delete", remote_uuid: uuid(30) }),
    create({ kind: "attachment", remote_uuid: uuid(31) }),
    create({ org_id: "org-2", remote_uuid: uuid(32) }),
  ];
  // a copy that came back in capitals is still known by its lower case
  expect(uuid(10).toUpperCase()).not.toBe(uuid(10));
  const copies = await sm8CopiesOf("org-1", [NOTE, OTHER, NOTE]);
  expect([...copies].sort()).toEqual([uuid(10), uuid(11), uuid(20)]);
  expect(calls).toHaveLength(1);
  expect(calls[0].eq).toEqual({ org_id: "org-1", kind: "note", op: "create" });
  expect(calls[0].in).toEqual(["note_id", [NOTE, OTHER]]);
});

it("reads the uuid each create holds now where the database has no replaced_uuids yet", async () => {
  noReplacedColumn = true;
  rows = [create({ replaced_uuids: [uuid(11)] })];
  expect([...(await sm8CopiesOf("org-1", [NOTE]))]).toEqual([uuid(10)]);
  expect(calls.map((c) => c.columns)).toEqual(["note_id, remote_uuid, replaced_uuids", "note_id, remote_uuid"]);
});

it("knows no copy when the read fails, and says so in the log", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  failWith = { code: "08006", message: "connection lost" };
  rows = [create({})];
  expect((await sm8CopiesOf("org-1", [NOTE])).size).toBe(0);
  expect(spy).toHaveBeenCalled();
  spy.mockRestore();
});

it("knows no copy when the read throws, and says so in the log", async () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  throwOnRead = true;
  rows = [create({})];
  const copies = await sm8CopiesOf("org-1", [NOTE]);
  expect(copies.size).toBe(0);
  expect(spy).toHaveBeenCalledWith(expect.stringContaining("socket hang up"));
  spy.mockRestore();
});

it("reads nothing for no note, or for an id that isn't one", async () => {
  expect((await sm8CopiesOf("org-1", [])).size).toBe(0);
  expect((await sm8CopiesOf("org-1", ["not-a-uuid", "n1,remote_uuid.neq.x"])).size).toBe(0);
  expect(calls).toHaveLength(0);
});
