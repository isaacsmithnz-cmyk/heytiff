/* The HeyTiff job-card picklist. Server Functions are reachable by direct
   POST, so the absent button is not a gate — this file is about the gate, the
   org scope, and the one rule that decides whether the feature is usable in a
   warehouse: a SECOND push must not double the list.

   Idempotency is by NAME, so a second push never doubles the list. What a
   re-push then does with a CHANGED figure is the whole design of this thing:
   a row nobody has touched is corrected (a stale 3.1 m where the run is now
   18 m is a wrong number, not caution), a row already picked is left exactly
   as it was and REPORTED, and nothing is ever deleted. */

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

/** a row already on the job, as the push's own select sees it */
const onJob = (
  r: { name: string; sub?: string; qty?: string },
  over: { position?: number; picked?: boolean; design_id?: string | null } = {}
) => ({
  id: `id-${r.name}`,
  name: r.name,
  sub: r.sub ?? "",
  qty: r.qty ?? "1",
  picked: false,
  design_id: "dsn_1",
  position: 0,
  ...over,
});

const NIL = { added: 0, updated: 0, heldBack: 0, orphaned: 0, unchanged: 0 };

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
    expect(r).toEqual({ ...NIL, added: 3 });
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
    existingRows = rows.map((r, i) => onJob(r, { position: i }));
    const r = await pushPicklistToJob("job-uuid", "dsn_1", rows);
    expect(r).toEqual({ ...NIL, unchanged: 3 });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("a re-push adds only what is missing, after what is there", async () => {
    existingRows = [onJob(rows[0], { position: 0 })];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", rows);
    expect(r).toEqual({ ...NIL, added: 2, unchanged: 1 });
    const written = inserts[0].rows as Record<string, unknown>[];
    // appended AFTER the existing line, never interleaved through a list
    // somebody is working down
    expect(written.map((w) => w.position)).toEqual([1, 2]);
  });

  it("corrects a changed quantity on a row NOBODY has picked", async () => {
    /* the whole reason re-push exists: the run grew, and leaving 3.1 m on the
       job card is a wrong number rather than caution */
    existingRows = [onJob({ name: "coil", sub: "liquid / gas mm", qty: "3.1 m" })];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", [
      { name: "coil", sub: "liquid / gas mm", qty: "18 m" },
    ]);
    expect(r).toEqual({ ...NIL, updated: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toMatchObject({ qty: "18 m" });
    expect(updates[0].eqs).toMatchObject({ org_id: "org-1", id: "id-coil" });
  });

  it("NEVER rewrites a figure under a row already picked — it reports it", async () => {
    existingRows = [
      onJob({ name: "coil", sub: "liquid / gas mm", qty: "3.1 m" }, { picked: true }),
    ];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", [
      { name: "coil", sub: "liquid / gas mm", qty: "18 m" },
    ]);
    expect(r).toEqual({ ...NIL, heldBack: 1 });
    expect(updates).toHaveLength(0); // somebody stood in a warehouse and acted on 3.1
  });

  it("never rewrites a line another design put on the job", async () => {
    existingRows = [
      onJob({ name: "coil", qty: "3.1 m" }, { design_id: "dsn_OTHER" }),
    ];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", [
      { name: "coil", sub: "", qty: "18 m" },
    ]);
    expect(r).toEqual({ ...NIL, heldBack: 1 });
    expect(updates).toHaveLength(0);
  });

  it("reports a line the design has dropped, and deletes nothing", async () => {
    existingRows = [
      onJob(rows[0], { position: 0 }),
      onJob({ name: "Isolator · 20 A", qty: "1" }, { position: 1 }),
    ];
    const r = await pushPicklistToJob("job-uuid", "dsn_1", [rows[0]]);
    expect(r).toEqual({ ...NIL, orphaned: 1, unchanged: 1 });
    expect(deletes).toHaveLength(0); // it may already be picked, ordered, or on a van
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
    expect(await pushPicklistToJob("job-uuid", "dsn_1", [])).toEqual(NIL);
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
