/**
 * @jest-environment node
 */

/* A PDF given to Tiff goes into the Library only for the person who added it, as a
   copy between the two buckets, and only once: a file already in gives back its
   manual with nothing started, and a copy that fails leaves no row behind. */

const asked: Record<string, unknown>[] = [];
const deleted: string[] = [];
const updates: Record<string, unknown>[] = [];
const removed: string[][] = [];
let pdf: Record<string, unknown> | null;
let manual: Record<string, unknown> | null;
let copyError: unknown;
let claimError: unknown;
let raceWinner: Record<string, unknown> | null;
let confirm: { ok: boolean; error?: string };
const copies: { from: string; to: string; bucket?: string; source: string }[] = [];
const begun: Record<string, unknown>[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const f: Record<string, unknown> = { table };
      let write: "update" | "delete" | null = null;
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        in: (c: string, v: unknown) => ((f[c] = v), q),
        not: () => q,
        update: (v: Record<string, unknown>) => ((write = "update"), updates.push(v), q),
        delete: () => ((write = "delete"), q),
        maybeSingle: async () => (asked.push(f), { data: table === "documents" ? pdf : manual }),
        then: (res: (v: unknown) => unknown) => {
          if (write === "delete") deleted.push(String(f.id));
          if (write === "update" && claimError) manual = raceWinner;
          return res({ error: write === "update" ? claimError : null });
        },
      };
      return q;
    },
    storage: {
      from: (source: string) => ({
        copy: async (from: string, to: string, o?: { destinationBucket?: string }) => (copies.push({ from, to, bucket: o?.destinationBucket, source }), { error: copyError }),
        remove: async (r: string[]) => (removed.push(r), { error: null }),
      }),
    },
  },
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-1" }));
jest.mock("@/lib/documents/query", () => ({ DOCUMENTS_BUCKET: "documents" }));
jest.mock("@/lib/tiff/large", () => ({ kbLargeAllowance: async () => null }));
jest.mock("@/lib/tiff/tags-query", () => ({ ensureKbSeedTags: async () => undefined, kbTagsForOrg: async () => [] }));
jest.mock("@/app/actions/kb", () => ({
  beginKbUpload: async (i: Record<string, unknown>) => (begun.push(i), { ok: true, documentId: "kb-1", ref: "org/org-1/kb/kb-1.pdf", token: "t", bucket: "kb" }),
  confirmKbUpload: async () => confirm,
}));
jest.mock("../auth", () => ({ actAsPhoneUser: (_c: unknown, run: () => unknown) => run() }));

import { addFileToLibrary, manualFromFile } from "../library-from-file";
import type { MobileCtx } from "../auth";

const ctx = { orgId: "org-1", userId: "u1", role: null, caps: new Set(), orgIds: ["org-1"] } as MobileCtx;
const id = "00000000-0000-4000-8000-000000000001";
const choice = { title: "Install manual", category: "install", tagIds: ["t1"] };

beforeEach(() => {
  for (const a of [asked, deleted, updates, removed, copies, begun]) a.length = 0;
  pdf = { id, storage_ref: "org/org-1/tiff_file/a.pdf", file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 1000 };
  manual = null;
  copyError = null;
  claimError = null;
  raceWinner = null;
  confirm = { ok: true };
});

test("copies the file into the Library's bucket and says it's being read", async () => {
  const r = await addFileToLibrary(ctx, id, choice);
  expect(r).toEqual({ ok: true, value: { id: "kb-1", title: "Install manual", category: "install", status: "processing" } });
  expect(copies).toEqual([{ source: "documents", from: "org/org-1/tiff_file/a.pdf", to: "org/org-1/kb/kb-1.pdf", bucket: "kb" }]);
  expect(begun[0]).toMatchObject({ title: "Install manual", tagIds: ["t1"], fileName: "a.pdf", sizeBytes: 1000 });
  expect(updates).toEqual([{ source_document: id }]);
});

test("asks only for a file this person added, of the kinds that come from her box", async () => {
  await addFileToLibrary(ctx, id, choice);
  expect(asked[0]).toMatchObject({ table: "documents", org_id: "org-1", id, uploaded_by: "staff-1", kind: ["tiff_file", "job_document"] });
});

test("someone else's file, a photo or a bad id goes nowhere", async () => {
  pdf = null;
  expect(await addFileToLibrary(ctx, id, choice)).toMatchObject({ ok: false, status: 404 });
  pdf = { id, storage_ref: "x", file_name: "a.jpg", mime_type: "image/jpeg", size_bytes: 1 };
  expect(await addFileToLibrary(ctx, id, choice)).toMatchObject({ ok: false, status: 404 });
  expect(await addFileToLibrary(ctx, "nope", choice)).toMatchObject({ ok: false, status: 404 });
  expect(begun).toHaveLength(0);
  expect(await manualFromFile("org-1", "nope")).toBeNull();
});

test("a file already in gives back its manual and starts nothing", async () => {
  manual = { id: "kb-0", title: "Old", category: "install", status: "ready" };
  expect(await addFileToLibrary(ctx, id, choice)).toEqual({ ok: true, value: manual });
  expect(begun).toHaveLength(0);
  expect(copies).toHaveLength(0);
});

test("a second press gives way to the first", async () => {
  claimError = { code: "23505" };
  /* nothing there when it looks, the first press's manual once it lost the race */
  raceWinner = { id: "kb-0", title: "First", category: "install", status: "processing" };
  expect(await addFileToLibrary(ctx, id, choice)).toEqual({ ok: true, value: raceWinner });
  expect(deleted).toEqual(["kb-1"]);
  expect(copies).toHaveLength(0);
});

test("a copy that fails leaves no manual behind", async () => {
  copyError = { message: "nope" };
  expect(await addFileToLibrary(ctx, id, choice)).toMatchObject({ ok: false, status: 409 });
  expect(deleted).toEqual(["kb-1"]);
});

test("a copy that can't be confirmed takes its bytes and its row back out", async () => {
  confirm = { ok: false, error: "Couldn't finish that upload." };
  expect(await addFileToLibrary(ctx, id, choice)).toEqual({ ok: false, error: "Couldn't finish that upload.", status: 409 });
  expect(removed).toEqual([["org/org-1/kb/kb-1.pdf"]]);
  expect(deleted).toEqual(["kb-1"]);
});
