/**
 * @jest-environment node
 */

/* What's handed to Tiff is read only for the person who added it: the query
   says whose and which kinds, a bad id never reaches it, a file too big for
   the model's request is said to be left out, and a slot is a `tiff_file`. */

const filters: Record<string, unknown>[] = [];
let rows: { id: string; storage_ref: string; file_name: string; mime_type: string; size_bytes: number }[] = [];
let bytes = Buffer.from("x");
let opened: { kind: string; onJob?: string }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const f: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        in: (c: string, v: unknown) => ((f[c] = v), q),
        not: (c: string, _o: string, v: unknown) => ((f[`not ${c}`] = v), q),
        then: (res: (v: unknown) => unknown) => (filters.push(f), res({ data: rows, error: null })),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }) }) },
  },
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-1" }));
jest.mock("@/lib/images/for-claude", () => ({ imageForClaude: async (b: Buffer) => ({ bytes: b, mime: "image/jpeg" }) }));
jest.mock("@/lib/tiff/extract", () => ({
  openPdf: async () => ({ numPages: pages, pageText: async (n: number) => `words of ${n}`, destroy: async () => undefined }),
}));
jest.mock("@/lib/documents/upload-slots", () => ({
  openSlot: async (_o: string, _s: string, kind: string, _f: unknown, onJob?: string) => (
    opened.push({ kind, onJob }), { ok: true, documentId: "d1", signedUrl: "https://put" }
  ),
  landSlot: async () => ({ ok: true }),
}));
let pages = 3;

import { beginTiffFile, readTiffFiles } from "../tiff-files";
import type { MobileCtx } from "../auth";

const ctx = { orgId: "org-1", userId: "u1", role: null, caps: new Set(), orgIds: ["org-1"] } as MobileCtx;
const id = "00000000-0000-4000-8000-000000000001";
const row = (mime: string, name = "a.pdf") => ({ id, storage_ref: "org/org-1/x", file_name: name, mime_type: mime, size_bytes: 1 });

beforeEach(() => {
  filters.length = 0;
  opened = [];
  rows = [];
  bytes = Buffer.from("x");
  pages = 3;
});

it("reads only this person's own landed files of the kinds handed to her", async () => {
  await readTiffFiles(ctx, [id]);
  expect(filters[0]).toMatchObject({ org_id: "org-1", uploaded_by: "staff-1", id: [id], kind: ["tiff_file", "job_photo", "job_document"], "not uploaded_at": null });
});

it("asks for nothing with no ids or ids that aren't ids", async () => {
  expect(await readTiffFiles(ctx, ["../../etc/passwd", 7])).toEqual([]);
  expect(await readTiffFiles(ctx, null)).toEqual([]);
  expect(filters).toEqual([]);
});

it("sends a photo as an image and a PDF as a document", async () => {
  rows = [row("image/jpeg", "plate.jpg")];
  expect((await readTiffFiles(ctx, [id])).map((b) => b.type)).toEqual(["text", "image"]);
  rows = [row("application/pdf")];
  expect((await readTiffFiles(ctx, [id])).map((b) => b.type)).toEqual(["text", "document"]);
});

it("gives a PDF past the model's pages as its words, saying so", async () => {
  pages = 101;
  rows = [row("application/pdf")];
  const blocks = await readTiffFiles(ctx, [id]);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({ type: "text", text: expect.stringContaining("words only") });
});

it("says when a file is too big for the request", async () => {
  bytes = Buffer.alloc(21 * 1024 * 1024);
  rows = [row("image/jpeg", "huge.jpg")];
  const blocks = await readTiffFiles(ctx, [id]);
  expect(blocks).toEqual([{ type: "text", text: expect.stringContaining("left out") }]);
});

it("opens a slot as a tiff_file, on no job", async () => {
  const r = await beginTiffFile(ctx, { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 });
  expect(r).toMatchObject({ ok: true, value: { documentId: "d1", uploadUrl: "https://put" } });
  expect(opened).toEqual([{ kind: "tiff_file", onJob: undefined }]);
});
