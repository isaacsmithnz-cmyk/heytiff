/* The linked job's uuid is MIRRORED OUT of the document into its own column
   on every save — that column is the only reason the link is answerable
   ("which designs are for this job?") rather than a note inside a jsonb blob.

   So the thing worth testing is the write: it happens, it tracks the document
   including an unlink, and a malformed link leaves the column null instead of
   throwing away somebody's save. */

let permissions: Record<string, boolean> = {};
const upserts: Record<string, unknown>[] = [];

function chain(result: unknown) {
  const node: Record<string, unknown> = {
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve),
  };
  for (const m of ["select", "eq", "in", "order", "update", "delete", "insert"]) {
    node[m] = () => node;
  }
  node.upsert = (row: Record<string, unknown>) => {
    upserts.push(row);
    return node;
  };
  return node;
}

const from = jest.fn((table: string) => {
  if (table === "memberships") {
    const node: Record<string, unknown> = {
      maybeSingle: async () => ({ data: { role: "staff", permissions }, error: null }),
    };
    node.select = () => node;
    node.eq = () => node;
    return node;
  }
  if (table === "organizations") {
    const node: Record<string, unknown> = {
      maybeSingle: async () => ({
        data: { primary_owner_user_id: "auth0|owner", trading_name: null, logo_url: null },
        error: null,
      }),
    };
    node.select = () => node;
    node.eq = () => node;
    return node;
  }
  return chain([]);
});

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (...a: unknown[]) => from(...(a as [string])),
    storage: { from: () => ({}) },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn(async () => ({ user: { sub: "auth0|u1" }, orgId: "org-1" })),
  },
}));

import { saveStudioDesign } from "../studio";
import { createDesign } from "@/lib/studio/document";

/** The row the design lands in — contributor writes go to another table. */
const designRow = () => upserts.find((r) => "schema_version" in r);

beforeEach(() => {
  permissions = {};
  upserts.length = 0;
});

describe("saveStudioDesign mirrors the job link out to its own column", () => {
  it("writes the uuid for a design started from a job", async () => {
    const doc = createDesign({
      name: "12/3 Wallace St",
      mode: "blank",
      jobNumber: "3151",
      job: { remoteId: "sm8-uuid-1", jobNumber: "3151" },
    });
    await saveStudioDesign(doc);
    expect(designRow()?.sm8_job_uuid).toBe("sm8-uuid-1");
  });

  it("writes null for a design named by hand", async () => {
    await saveStudioDesign(createDesign({ name: "Farran St", mode: "blank" }));
    expect(designRow()?.sm8_job_uuid).toBeNull();
  });

  /* The column is rewritten every save rather than only set once, so the
     document stays the source of truth: drop the link there and the next save
     drops it here. A write-once column would leave a design claiming a job it
     no longer names. */
  it("follows an unlink rather than leaving the old uuid behind", async () => {
    const doc = createDesign({
      name: "x",
      mode: "blank",
      job: { remoteId: "sm8-uuid-1", jobNumber: "3151" },
    });
    await saveStudioDesign(doc);
    expect(designRow()?.sm8_job_uuid).toBe("sm8-uuid-1");

    upserts.length = 0;
    await saveStudioDesign({ ...doc, jobLink: null });
    expect(designRow()?.sm8_job_uuid).toBeNull();
  });

  /* A save arrives as `unknown` and is only shape-checked at the top level.
     Whatever a malformed link is, it is never a reason to refuse the save —
     the design is the thing being protected. */
  it.each([
    ["not an object", "sm8-uuid-1"],
    ["another provider", { provider: "xero", remoteId: "x-1" }],
    ["no remoteId", { provider: "servicem8", jobNumber: "3151" }],
    ["a blank remoteId", { provider: "servicem8", remoteId: "   " }],
    ["a non-string remoteId", { provider: "servicem8", remoteId: 3151 }],
  ])("stores null when the link is %s, and still saves", async (_label, jobLink) => {
    const doc = { ...createDesign({ name: "x", mode: "blank" }), jobLink };
    await expect(saveStudioDesign(doc)).resolves.toBeUndefined();
    expect(designRow()?.sm8_job_uuid).toBeNull();
    expect(designRow()?.name).toBe("x");
  });
});
