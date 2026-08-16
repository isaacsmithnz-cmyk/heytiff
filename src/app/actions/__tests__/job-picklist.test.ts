/* The HeyTiff job-card picklist. Server Functions are reachable by direct
   POST, so the absent button is not a gate — this file is about the gate, the
   org scope, and the one rule that decides whether the feature is usable in a
   warehouse: a SECOND push must not double the list.

   The idempotency is by NAME, not by name+qty, on purpose. If the design has
   changed since the first push, the line somebody has already picked against
   stays as it was ordered — re-pushing adds what is MISSING, it never
   rewrites a number under the picker. */

const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const deletes: Record<string, unknown>[] = [];

/** rows the select for existing items finds */
let existingRows: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      const self = () => chain;

      chain.select = self;
      chain.eq = (col: string, value: unknown) => {
        eqs[col] = value;
        return chain;
      };
      chain.order = () => ({
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: existingRows, error: null }).then(res),
      });
      // the bare `select().eq().eq()` read in pushPicklistToJob
      chain.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: existingRows, error: null }).then(res);

      chain.insert = (payload: Record<string, unknown>[]) => {
        inserts.push({ table, rows: payload });
        return Promise.resolve({ error: null });
      };
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, value: unknown) => {
          eqs[col] = value;
          return sub;
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch, eqs: { ...eqs } });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.delete = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, value: unknown) => {
          eqs[col] = value;
          return sub;
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          deletes.push({ table, eqs: { ...eqs } });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

let caps = new Set<string>(["studio", "workboard"]);
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async (capability?: string) => {
    if (capability && !caps.has(capability))
      throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|me" };
  },
}));

import {
  listJobPicklist,
  pushPicklistToJob,
  removePicklistItem,
  setPicklistItemPicked,
} from "../job-picklist";

const rows = [
  { name: "PUHY-P200YNW-A1", sub: "outdoor unit", qty: "1" },
  { name: "MSZ-AP25VGD", sub: "wall mounted indoor", qty: "3" },
  { name: "ø9.52 / ø15.88 pair coil", sub: "liquid / gas mm", qty: "52 m" },
];

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  existingRows = [];
  caps = new Set(["studio", "workboard"]);
});

describe("pushPicklistToJob", () => {
  it("writes every line, org-scoped and positioned in order", async () => {
    const r = await pushPicklistToJob("job-uuid", "dsn_1", rows);
    expect(r).toEqual({ added: 3, alreadyThere: 0 });
    const written = inserts[0].rows as Record<string, unknown>[];
    expect(written).toHaveLength(3);
    expect(written.map((w) => w.name)).toEqual(rows.map((x) => x.name));
    expect(written.map((w) => w.position)).toEqual([0, 1, 2]);
    for (const w of written) {
      expect(w.org_id).toBe("org-1");
      expect(w.sm8_job_uuid).toBe("job-uuid");
      expect(w.design_id).toBe("dsn_1");
      expect(w.added_by).toBe("auth0|me");
    }
  });

  it("a second push adds nothing — the list does not double", async () => {
    existingRows = rows.map((r, i) => ({ name: r.name, position: i }));
    const r = await pushPicklistToJob("job-uuid", "dsn_1", rows);
    expect(r).toEqual({ added: 0, alreadyThere: 3 });
    expect(inserts).toHaveLength(0);
  });

  it("a re-push adds only what is missing, after what is there", async () => {
    existingRows = [{ name: "PUHY-P200YNW-A1", position: 0 }];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", rows);
    expect(r).toEqual({ added: 2, alreadyThere: 1 });
    const written = inserts[0].rows as Record<string, unknown>[];
    // appended AFTER the existing line, never interleaved through a list
    // somebody is working down
    expect(written.map((w) => w.position)).toEqual([1, 2]);
  });

  it("keeps the ordered quantity when the design has since changed", async () => {
    existingRows = [{ name: "MSZ-AP25VGD", position: 0 }];
    await pushPicklistToJob("job-uuid", "dsn_1", [
      { name: "MSZ-AP25VGD", sub: "wall mounted indoor", qty: "9" },
    ]);
    // the qty differs, but the line is already picked against — untouched
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("needs BOTH studio and workboard", async () => {
    caps = new Set(["studio"]);
    await expect(pushPicklistToJob("job-uuid", "dsn_1", rows)).rejects.toThrow(
      /Insufficient permissions/
    );
    caps = new Set(["workboard"]);
    await expect(pushPicklistToJob("job-uuid", "dsn_1", rows)).rejects.toThrow(
      /Insufficient permissions/
    );
  });

  it("refuses a job it cannot name, and shrugs at an empty list", async () => {
    await expect(pushPicklistToJob("  ", "dsn_1", rows)).rejects.toThrow(
      /No job/
    );
    expect(await pushPicklistToJob("job-uuid", "dsn_1", [])).toEqual({
      added: 0,
      alreadyThere: 0,
    });
    expect(inserts).toHaveLength(0);
  });
});

describe("the rest of the list", () => {
  it("reads a job's items in position order, org-scoped", async () => {
    existingRows = [
      {
        id: "i1",
        name: "PUHY",
        sub: "",
        qty: "1",
        picked: false,
        picked_at: null,
        picked_by: null,
        design_id: "dsn_1",
        added_at: "2026-08-16T00:00:00Z",
      },
    ];
    const items = await listJobPicklist("job-uuid");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "i1", picked: false, designId: "dsn_1" });
  });

  it("ticking stamps who and when; unticking clears both", async () => {
    await setPicklistItemPicked("i1", true);
    expect(updates[0].patch).toMatchObject({ picked: true, picked_by: "auth0|me" });
    expect((updates[0].patch as { picked_at: string }).picked_at).toBeTruthy();

    await setPicklistItemPicked("i1", false);
    expect(updates[1].patch).toMatchObject({
      picked: false,
      picked_at: null,
      picked_by: null,
    });
  });

  it("ticking and removing are org-scoped and need workboard", async () => {
    await setPicklistItemPicked("i1", true);
    expect(updates[0].eqs).toMatchObject({ org_id: "org-1", id: "i1" });
    await removePicklistItem("i1");
    expect(deletes[0].eqs).toMatchObject({ org_id: "org-1", id: "i1" });

    caps = new Set(["studio"]);
    await expect(setPicklistItemPicked("i1", true)).rejects.toThrow(
      /Insufficient permissions/
    );
    await expect(removePicklistItem("i1")).rejects.toThrow(
      /Insufficient permissions/
    );
    await expect(listJobPicklist("job-uuid")).rejects.toThrow(
      /Insufficient permissions/
    );
  });
});
