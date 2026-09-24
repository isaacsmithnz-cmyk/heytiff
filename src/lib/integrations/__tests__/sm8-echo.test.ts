/**
 * @jest-environment node
 */

/* Which ServiceM8 records HeyTiff made itself. A file HeyTiff sends comes
   back in the mirror as one of ServiceM8's; its uuid is one HeyTiff minted,
   or one a write gave up for a fresh one, so it is ours whatever became of
   the write. The fake answers the two filters the module sends the way
   PostgREST would. */

type Row = { org_id: string; remote_uuid: string; status: string; replaced_uuids: string[] };

let rows: Row[] = [];
let failWith: { code: string; message: string } | null = null;
let noReplacedColumn = false;
const queries: { or?: string; in?: string[] }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "sm8_writes") throw new Error(`unexpected table ${table}`);
      let org = "";
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (col: string, v: string) => {
        if (col === "org_id") org = v;
        return q;
      };
      q.or = async (expr: string) => {
        queries.push({ or: expr });
        if (failWith) return { data: null, error: failWith };
        if (noReplacedColumn) return { data: null, error: { code: "42703", message: "column replaced_uuids does not exist" } };
        const m = /^remote_uuid\.in\.\(([^)]*)\),replaced_uuids\.ov\.\{([^}]*)\}$/.exec(expr);
        if (!m) throw new Error(`fake: can't read ${expr}`);
        const inList = m[1].split(",");
        const ovList = m[2].split(",");
        return {
          data: rows
            .filter((r) => r.org_id === org)
            .filter((r) => inList.includes(r.remote_uuid) || r.replaced_uuids.some((u) => ovList.includes(u))),
          error: null,
        };
      };
      q.in = async (_col: string, list: string[]) => {
        queries.push({ in: list });
        // the column isn't there to select: only the uuid each write holds now
        return {
          data: rows.filter((r) => r.org_id === org && list.includes(r.remote_uuid)).map((r) => ({ remote_uuid: r.remote_uuid })),
          error: null,
        };
      };
      return q;
    },
  },
}));

import { ECHO_CHUNK, sm8Ours, withoutOurs } from "../sm8-echo";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG = "org-1";

beforeEach(() => {
  rows = [];
  failWith = null;
  noReplacedColumn = false;
  queries.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("sm8Ours", () => {
  it("finds our uuids whatever became of the write", async () => {
    rows = ["sent", "failed", "cancelled", "queued", "trial"].map((status, i) => ({
      org_id: ORG,
      remote_uuid: uuid(i + 1),
      status,
      replaced_uuids: [],
    }));
    const ours = await sm8Ours(ORG, [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(99)]);
    expect([...ours].sort()).toEqual([uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)]);
  });

  it("finds a uuid a write gave up for a fresh one", async () => {
    rows = [{ org_id: ORG, remote_uuid: uuid(2), status: "sent", replaced_uuids: [uuid(1)] }];
    expect([...(await sm8Ours(ORG, [uuid(1), uuid(3)]))]).toEqual([uuid(1)]);
  });

  it("asks only this workspace's writes", async () => {
    rows = [{ org_id: "org-2", remote_uuid: uuid(1), status: "sent", replaced_uuids: [] }];
    expect((await sm8Ours(ORG, [uuid(1)])).size).toBe(0);
  });

  it("asks a hundred at a time, so the address stays short", async () => {
    expect(ECHO_CHUNK).toBe(100);
    rows = [{ org_id: ORG, remote_uuid: uuid(250), status: "sent", replaced_uuids: [] }];
    const asked = Array.from({ length: 250 }, (_, i) => uuid(i + 1));
    const ours = await sm8Ours(ORG, asked);
    expect([...ours]).toEqual([uuid(250)]);
    expect(queries).toHaveLength(3);
    for (const q of queries) expect(q.or!.length).toBeLessThan(8_000);
  });

  it("asks once per uuid, however often it is named", async () => {
    await sm8Ours(ORG, [uuid(1), uuid(1), uuid(1)]);
    expect(queries[0].or).toBe(`remote_uuid.in.(${uuid(1)}),replaced_uuids.ov.{${uuid(1)}}`);
  });

  it("falls back to the uuids the writes hold now on a database without replaced_uuids", async () => {
    noReplacedColumn = true;
    rows = [{ org_id: ORG, remote_uuid: uuid(1), status: "sent", replaced_uuids: [uuid(7)] }];
    const ours = await sm8Ours(ORG, [uuid(1), uuid(7)]);
    expect([...ours]).toEqual([uuid(1)]);
    expect(queries[1].in).toEqual([uuid(1), uuid(7)]);
  });

  it("a read that fails finds nothing ours, and says so in the log — a twin shown beats a broken card", async () => {
    failWith = { code: "57014", message: "canceling statement due to statement timeout" };
    expect((await sm8Ours(ORG, [uuid(1)])).size).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it("asks nothing when there is nothing to ask about", async () => {
    expect((await sm8Ours(ORG, [])).size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("never puts anything but a uuid into a filter", async () => {
    const ours = await sm8Ours(ORG, ["x),remote_uuid.neq.(", "not-a-uuid", "{a,b}", uuid(1)]);
    expect(ours.size).toBe(0);
    expect(queries).toHaveLength(1);
    expect(queries[0].or).toBe(`remote_uuid.in.(${uuid(1)}),replaced_uuids.ov.{${uuid(1)}}`);
    queries.length = 0;
    await sm8Ours(ORG, ["x),remote_uuid.neq.("]);
    expect(queries).toHaveLength(0);
  });
});

describe("withoutOurs", () => {
  it("leaves out only the rows whose uuid is ours", () => {
    const rowsIn = [{ uuid: "a" }, { uuid: "b" }, { uuid: "c" }];
    expect(withoutOurs(rowsIn, (r) => r.uuid, new Set(["b"]))).toEqual([{ uuid: "a" }, { uuid: "c" }]);
    expect(withoutOurs(rowsIn, (r) => r.uuid, new Set())).toEqual(rowsIn);
  });
});
