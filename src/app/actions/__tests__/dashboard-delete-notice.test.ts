/* Deleting a notice has to take its attachments out of the BUCKET as well.

   documents.notice_id is ON DELETE CASCADE, so dropping the notice drops the
   only rows that name the stored objects. Anything left behind is unreachable
   — no row points at it, so nothing will ever list, sign or delete it — and
   still billable, which is the exact outcome deleteDocument() goes out of its
   way to avoid. */

const storageRemove = jest.fn().mockResolvedValue({ error: null });
const del = jest.fn();

let noticeRow: Record<string, unknown> | null = { posted_by: "staff-1" };
let documentRows: Record<string, unknown>[] = [];

const table = (name: string) => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.eq = self;
  chain.select = () => chain;
  chain.maybeSingle = async () => ({ data: noticeRow });
  chain.delete = () => {
    del(name);
    return chain;
  };
  // documents is read as a list (no maybeSingle) — awaiting the builder resolves it
  chain.then = (res: (v: { data: unknown; error: null }) => unknown) =>
    Promise.resolve({ data: name === "documents" ? documentRows : [], error: null }).then(res);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (n: string) => table(n),
    storage: { from: () => ({ remove: (refs: string[]) => storageRemove(refs) }) },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn().mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" }) },
}));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => true) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-1") }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { deleteNotice } from "../dashboard";

beforeEach(() => {
  storageRemove.mockClear();
  del.mockClear();
  noticeRow = { posted_by: "staff-1" };
  documentRows = [];
});

describe("deleteNotice — attachments leave the bucket too", () => {
  it("removes every attached object before dropping the notice", async () => {
    documentRows = [
      { storage_ref: "org/org-1/notice_attachment/doc-1.jpg" },
      { storage_ref: "org/org-1/notice_attachment/doc-2.pdf" },
    ];

    const res = await deleteNotice("notice-1");

    expect(res).toEqual({ ok: true });
    expect(storageRemove).toHaveBeenCalledWith([
      "org/org-1/notice_attachment/doc-1.jpg",
      "org/org-1/notice_attachment/doc-2.pdf",
    ]);
    expect(del).toHaveBeenCalledWith("notices");
  });

  it("costs no storage call when the notice carries no files", async () => {
    documentRows = [];
    await deleteNotice("notice-1");
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("ignores a ref that doesn't belong to this org", async () => {
    // an id proves nothing — the path carries the org, so a foreign ref is
    // never handed to storage.remove()
    documentRows = [{ storage_ref: "org/other-org/notice_attachment/doc-9.jpg" }];
    await deleteNotice("notice-1");
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("does not touch storage when the caller may not delete the notice", async () => {
    noticeRow = null; // notice gone / not in this org
    documentRows = [{ storage_ref: "org/org-1/notice_attachment/doc-1.jpg" }];

    const res = await deleteNotice("notice-1");

    expect(res.ok).toBe(false);
    expect(storageRemove).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
