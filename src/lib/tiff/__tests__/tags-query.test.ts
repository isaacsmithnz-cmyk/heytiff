/**
 * @jest-environment node
 *
 * The server half of tags: reading them, seeding them, and setting which ones
 * a document wears.
 *
 * What these pin is the part a person would never see go wrong. `ensureKbSeedTags`
 * must be a no-op the second time (a manager who deleted a brand they never
 * touch is not handed it back on the next page load), and `setKbDocumentTags`
 * must be a DIFFERENCE rather than a delete-then-insert — the window between
 * those two writes is a window where the library renders the document as
 * untagged, and a failed insert after a successful delete would silently strip
 * a row.
 *
 * Supabase is mocked at the client boundary, so what is asserted is the QUERY
 * and the WRITE.
 */

type Call = {
  table: string;
  op: "select" | "insert" | "delete" | "upsert";
  eqs: Record<string, unknown>;
  ins: Record<string, unknown[]>;
  rows: unknown;
  opts: unknown;
  head: boolean;
};

const calls: Call[] = [];

/** table → what a select on it returns. */
let data: Record<string, unknown[]> = {};
let counts: Record<string, number> = {};
let failOn: { table: string; op: Call["op"] } | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, op: "select", eqs: {}, ins: {}, rows: null, opts: null, head: false };
      calls.push(call);

      const result = () => {
        if (failOn && failOn.table === call.table && failOn.op === call.op)
          return { data: null, error: { message: "nope" }, count: null };
        return {
          data: call.op === "select" ? (data[table] ?? []) : null,
          error: null,
          count: counts[table] ?? 0,
        };
      };

      const builder: Record<string, unknown> = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          call.head = Boolean(opts?.head);
          return builder;
        },
        insert: (rows: unknown) => {
          call.op = "insert";
          call.rows = rows;
          return builder;
        },
        upsert: (rows: unknown, opts: unknown) => {
          call.op = "upsert";
          call.rows = rows;
          call.opts = opts;
          return builder;
        },
        delete: () => {
          call.op = "delete";
          return builder;
        },
        eq: (col: string, value: unknown) => {
          call.eqs[col] = value;
          return builder;
        },
        in: (col: string, values: unknown[]) => {
          call.ins[col] = values;
          return builder;
        },
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return builder;
    },
  },
}));

import { KB_TAG_SEEDS } from "../tags";
import {
  ensureKbSeedTags,
  kbTagsByDocument,
  kbTagsForOrg,
  kbTagUsage,
  setKbDocumentTags,
} from "../tags-query";

const ORG = "org-1";

const row = (id: string, label: string, kind = "brand") => ({
  id,
  label,
  slug: label.toLowerCase(),
  color: "#2563eb",
  kind,
});

beforeEach(() => {
  calls.length = 0;
  data = {};
  counts = {};
  failOn = null;
});

const lastOf = (table: string, op: Call["op"]) =>
  [...calls].reverse().find((c) => c.table === table && c.op === op);

describe("reading the org's tags", () => {
  it("is scoped to the org, always", async () => {
    data.kb_tags = [row("t-1", "Daikin")];
    await kbTagsForOrg(ORG);
    expect(lastOf("kb_tags", "select")?.eqs).toEqual({ org_id: ORG });
  });

  it("falls back rather than rendering a tag with no colour or group", async () => {
    data.kb_tags = [{ id: "t-1", label: "Daikin", slug: "daikin", color: "chartreuse", kind: "vendor" }];
    const [tag] = await kbTagsForOrg(ORG);
    expect(tag.color).toBe("#475569");
    expect(tag.kind).toBe("topic");
  });
});

describe("which document wears which", () => {
  it("groups the join rows by document, alphabetically", async () => {
    data.kb_tags = [row("t-1", "VRV", "system"), row("t-2", "Daikin")];
    data.kb_document_tags = [
      { document_id: "d-1", tag_id: "t-1" },
      { document_id: "d-1", tag_id: "t-2" },
      { document_id: "d-2", tag_id: "t-2" },
    ];

    const byDoc = await kbTagsByDocument(ORG);
    expect(byDoc["d-1"].map((t) => t.label)).toEqual(["Daikin", "VRV"]);
    expect(byDoc["d-2"].map((t) => t.label)).toEqual(["Daikin"]);
  });

  /* A tag deleted in the same breath as this read: skip it rather than render
     a pill with no name on it. */
  it("drops a join row whose tag has gone", async () => {
    data.kb_tags = [row("t-1", "VRV", "system")];
    data.kb_document_tags = [
      { document_id: "d-1", tag_id: "t-1" },
      { document_id: "d-1", tag_id: "t-vanished" },
    ];

    expect((await kbTagsByDocument(ORG))["d-1"]).toHaveLength(1);
  });

  it("counts what each tag is on, and says nothing about the ones on nothing", async () => {
    data.kb_document_tags = [
      { tag_id: "t-1" },
      { tag_id: "t-1" },
      { tag_id: "t-2" },
    ];
    expect(await kbTagUsage(ORG)).toEqual({ "t-1": 2, "t-2": 1 });
  });
});

describe("the starter set", () => {
  it("goes in once, on an empty list", async () => {
    counts.kb_tags = 0;
    await ensureKbSeedTags(ORG);

    const write = lastOf("kb_tags", "upsert");
    expect((write?.rows as unknown[]).length).toBe(KB_TAG_SEEDS.length);
    // two people opening the library at once must not race into a duplicate
    expect(write?.opts).toEqual({ onConflict: "org_id,slug", ignoreDuplicates: true });
  });

  /* A manager who deleted "Bonaire" because they never touch one is not handed
     it back on the next page load. */
  it("never runs again once the org has any tag at all", async () => {
    counts.kb_tags = 1;
    await ensureKbSeedTags(ORG);
    expect(lastOf("kb_tags", "upsert")).toBeUndefined();
  });
});

describe("setting a document's tags", () => {
  it("adds only what's new and removes only what's gone", async () => {
    data.kb_document_tags = [{ tag_id: "t-keep" }, { tag_id: "t-drop" }];

    expect(await setKbDocumentTags(ORG, "d-1", ["t-keep", "t-add"])).toBe(true);

    expect(lastOf("kb_document_tags", "insert")?.rows).toEqual([
      { org_id: ORG, document_id: "d-1", tag_id: "t-add" },
    ]);
    const del = lastOf("kb_document_tags", "delete");
    expect(del?.ins.tag_id).toEqual(["t-drop"]);
    // the delete is scoped to both halves, so a leaked id can't reach across
    expect(del?.eqs).toEqual({ org_id: ORG, document_id: "d-1" });
  });

  /* Nothing changed is nothing written. A delete-then-insert would open a
     window where the row renders untagged for no reason at all. */
  it("writes nothing when the list is the same", async () => {
    data.kb_document_tags = [{ tag_id: "t-1" }];

    expect(await setKbDocumentTags(ORG, "d-1", ["t-1"])).toBe(true);
    expect(lastOf("kb_document_tags", "insert")).toBeUndefined();
    expect(lastOf("kb_document_tags", "delete")).toBeUndefined();
  });

  it("clears them all when handed an empty list", async () => {
    data.kb_document_tags = [{ tag_id: "t-1" }, { tag_id: "t-2" }];

    expect(await setKbDocumentTags(ORG, "d-1", [])).toBe(true);
    expect(lastOf("kb_document_tags", "delete")?.ins.tag_id).toEqual(["t-1", "t-2"]);
  });

  it("reports a refusal rather than claiming the tags were saved", async () => {
    data.kb_document_tags = [];
    failOn = { table: "kb_document_tags", op: "insert" };

    expect(await setKbDocumentTags(ORG, "d-1", ["t-1"])).toBe(false);
  });
});
