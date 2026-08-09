/* The tag writes. Server Functions are reachable by direct POST, so the absent
   button on the screen is not a gate — this file is about the gate, the
   dedupe, and the two ways a name can already be taken.

   THE SLUG IS THE IDENTITY, and both halves of this module have to agree with
   the database's unique index on it: creating "daikin" when "Daikin" exists
   must FIND the existing tag (a create that quietly did nothing would have the
   manager typing it again), and renaming one tag onto another's name must be
   refused rather than half-merged. */

const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const deletes: Record<string, unknown>[] = [];

/** Rows a `.maybeSingle()` finds, consumed in order — one per lookup. */
let lookups: (Record<string, unknown> | null)[] = [];
let tagCount = 0;
let insertFails = false;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      const self = () => chain;

      chain.select = (_cols: string, opts?: { head?: boolean }) =>
        opts?.head
          ? {
              eq: () => ({
                then: (res: (v: unknown) => unknown) =>
                  Promise.resolve({ count: tagCount, error: null }).then(res),
              }),
            }
          : chain;
      chain.eq = (col: string, value: unknown) => {
        eqs[col] = value;
        return chain;
      };
      chain.neq = self;
      chain.order = self;
      chain.maybeSingle = async () => ({ data: lookups.length ? lookups.shift()! : null, error: null });

      chain.insert = (payload: Record<string, unknown>) => {
        inserts.push({ table, ...payload });
        return {
          select: () => ({
            maybeSingle: async () =>
              insertFails
                ? { data: null, error: { message: "duplicate key" } }
                : { data: { id: "t-new", ...payload }, error: null },
          }),
        };
      };

      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, value: unknown) => {
          eqs[col] = value;
          return sub;
        };
        sub.select = () => sub;
        sub.maybeSingle = async () => {
          updates.push({ table, patch, eqs: { ...eqs } });
          return { data: { id: eqs.id, ...patch }, error: null };
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

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let caps = new Set<string>(["tiff_manage"]);
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async (capability?: string) => {
    if (capability && !caps.has(capability)) throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|me" };
  },
  getDbRole: async () => "owner",
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-me" }));

import { createKbTag, deleteKbTag, updateKbTag } from "../kb-tags";
import { KB_TAGS_PER_ORG_MAX } from "@/lib/tiff/tags";

const existing = (over: Record<string, unknown> = {}) => ({
  id: "t-daikin",
  label: "Daikin",
  slug: "daikin",
  color: "#2563eb",
  kind: "brand",
  ...over,
});

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  lookups = [];
  tagCount = 3;
  insertFails = false;
  caps = new Set(["tiff_manage"]);
});

describe("the gate", () => {
  it("refuses every write without tiff_manage, before any row is touched", async () => {
    caps = new Set(["tiff"]); // reading the library is the staff tier

    expect(await createKbTag({ label: "Daikin" })).toMatchObject({ ok: false });
    expect(await updateKbTag("t-1", { label: "x" })).toMatchObject({ ok: false });
    expect(await deleteKbTag("t-1")).toMatchObject({ ok: false });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});

describe("creating one", () => {
  it("stores the cleaned label, its slug and the org", async () => {
    const res = await createKbTag({ label: "  mitsubishi electric ", kind: "brand" });

    expect(res.ok).toBe(true);
    expect(inserts[0]).toMatchObject({
      table: "kb_tags",
      org_id: "org-1",
      label: "Mitsubishi Electric",
      slug: "mitsubishi-electric",
      kind: "brand",
      created_by: "staff-me",
    });
  });

  it("puts a trade acronym back into capitals", async () => {
    await createKbTag({ label: "vrf" });
    expect(inserts[0]).toMatchObject({ label: "VRF", slug: "vrf" });
  });

  /* Typing a name that already exists is not an error and is not a second
     tag — it is a request for the one that's there. */
  it("hands back the existing tag rather than making a second", async () => {
    lookups = [existing()];

    const res = await createKbTag({ label: "DAIKIN" });

    expect(res).toEqual({ ok: true, tag: expect.objectContaining({ id: "t-daikin", label: "Daikin" }) });
    expect(inserts).toHaveLength(0);
  });

  /* Two people typing the same new tag in the same second: the read saw
     nothing for either of them and the unique index caught the loser. It reads
     the winner's row rather than reporting an error for a tag that now exists
     and is exactly what was asked for. */
  it("survives losing the race to the unique index", async () => {
    insertFails = true;
    lookups = [null, existing({ id: "t-winner" })];

    const res = await createKbTag({ label: "Daikin" });

    expect(res).toEqual({ ok: true, tag: expect.objectContaining({ id: "t-winner" }) });
  });

  it("refuses a name with nothing in it", async () => {
    expect(await createKbTag({ label: "   " })).toMatchObject({ ok: false });
    expect(await createKbTag({ label: "—-" })).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("refuses an unknown kind by falling back rather than storing it", async () => {
    await createKbTag({ label: "Hydronic", kind: "vendor" });
    expect(inserts[0]).toMatchObject({ kind: "topic" });
  });

  it("stops at the ceiling, and says how to get past it", async () => {
    tagCount = KB_TAGS_PER_ORG_MAX;
    const res = await createKbTag({ label: "One more" });

    expect(res).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  /* Finding an existing tag is not creating one — a full library must still be
     able to tag a document with something it already has. */
  it("still finds an existing tag at the ceiling", async () => {
    tagCount = KB_TAGS_PER_ORG_MAX;
    lookups = [existing()];

    expect(await createKbTag({ label: "Daikin" })).toMatchObject({ ok: true });
  });
});

describe("changing one", () => {
  it("renames, recolours and regroups in one write", async () => {
    lookups = [null]; // nothing else answers to the new name

    const res = await updateKbTag("t-1", { label: "vrv systems", color: "#EA580C", kind: "system" });

    expect(res.ok).toBe(true);
    expect(updates[0]).toMatchObject({
      table: "kb_tags",
      patch: expect.objectContaining({
        label: "VRV Systems",
        slug: "vrv-systems",
        color: "#ea580c",
        kind: "system",
      }),
      eqs: { org_id: "org-1", id: "t-1" },
    });
  });

  /* A rename onto a name that already exists is a MERGE wearing a rename's
     clothes, and merging means rewriting every document that wears either.
     Refused plainly rather than half-done. */
  it("refuses a rename onto a name that's taken", async () => {
    lookups = [{ id: "t-other" }];

    const res = await updateKbTag("t-1", { label: "Daikin" });

    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("already a tag") });
    expect(updates).toHaveLength(0);
  });

  it("refuses a colour that isn't one", async () => {
    expect(await updateKbTag("t-1", { color: "chartreuse" })).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});

describe("removing one", () => {
  it("is scoped to the org as well as the id", async () => {
    expect(await deleteKbTag("t-1")).toEqual({ ok: true });
    expect(deletes[0]).toEqual({ table: "kb_tags", eqs: { org_id: "org-1", id: "t-1" } });
  });
});
