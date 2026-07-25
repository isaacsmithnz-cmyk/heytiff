/* MAX_NOTICE_FILES is a cap on the NOTICE, not on the request.

   Editing a notice claims only the files added that time round, so capping the
   incoming list let another six through on every save. The claim now counts
   what is already on the post and takes only the room that is left. */

const update = jest.fn();
const inFilter = jest.fn();
const selectHead = jest.fn();

let existingCount = 0;
let noticeRow: Record<string, unknown> | null = { posted_by: "staff-1" };

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = self;
  chain.is = self;
  chain.not = self;
  chain.order = self;
  chain.limit = self;
  chain.select = (cols: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) selectHead(name);
    return chain;
  };
  chain.maybeSingle = async () => ({ data: noticeRow, error: null });
  chain.insert = () => ({
    select: () => ({ maybeSingle: async () => ({ data: { id: "notice-1", revision: 1 }, error: null }) }),
  });
  chain.upsert = async () => ({ error: null });
  chain.update = (row: unknown) => {
    update(name, row);
    return chain;
  };
  chain.delete = self;
  chain.in = (col: string, ids: string[]) => {
    inFilter(name, ids);
    return Promise.resolve({ error: null });
  };
  // the count read: awaiting the builder yields { count }
  chain.then = (res: (v: { count: number; data: unknown; error: null }) => unknown) =>
    Promise.resolve({ count: existingCount, data: [], error: null }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (n: string) => table(n), storage: { from: () => ({ remove: async () => ({ error: null }) }) } },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => true) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { editNotice } from "../dashboard";
import { MAX_NOTICE_FILES } from "@/lib/documents/files";

const sixMore = ["d1", "d2", "d3", "d4", "d5", "d6"];

beforeEach(() => {
  [update, inFilter, selectHead].forEach((m) => m.mockClear());
  existingCount = 0;
  noticeRow = { posted_by: "staff-1", title: "t", body: null, revision: 1, kind: "notice" };
});

const claimedIds = () => {
  const call = inFilter.mock.calls.find(([t]) => t === "documents");
  return call ? (call[1] as string[]) : [];
};

describe("claimDocuments — the cap counts what is already attached", () => {
  it("claims all six on an empty notice", async () => {
    existingCount = 0;
    await editNotice({ noticeId: "notice-1", title: "t", documentIds: sixMore });
    expect(claimedIds()).toHaveLength(MAX_NOTICE_FILES);
  });

  it("claims only the remaining room when some are already on the post", async () => {
    existingCount = 4;
    await editNotice({ noticeId: "notice-1", title: "t", documentIds: sixMore });
    expect(claimedIds()).toEqual(["d1", "d2"]);
  });

  it("claims nothing once the notice is already full", async () => {
    existingCount = MAX_NOTICE_FILES;
    await editNotice({ noticeId: "notice-1", title: "t", documentIds: sixMore });
    expect(claimedIds()).toEqual([]);
  });

  it("claims nothing when somehow over the cap", async () => {
    existingCount = MAX_NOTICE_FILES + 3;
    await editNotice({ noticeId: "notice-1", title: "t", documentIds: sixMore });
    expect(claimedIds()).toEqual([]);
  });
});
