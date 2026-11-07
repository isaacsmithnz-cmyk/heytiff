/**
 * @jest-environment node
 */

/* What's handed to Tiff is read only for the person who added it: the query
   says whose and which kinds, a bad id never reaches it, a file too big for
   the model's request is said to be left out, and a slot is a `tiff_file`. */

const filters: Record<string, unknown>[] = [];
const moved: Record<string, unknown>[] = [];
let note: { target_kind: string; target_id: string | null } | null = null;
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
        update: (v: Record<string, unknown>) => (moved.push(v), q),
        maybeSingle: async () => ({ data: note }),
        then: (res: (v: unknown) => unknown) => (filters.push(f), res({ data: rows, error: null })),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }) }) },
  },
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-1" }));
jest.mock("@/lib/images/for-claude", () => ({ imageForClaude: async (b: Buffer) => ({ bytes: b, mime: "image/jpeg" }) }));
jest.mock("@/app/actions/job-sm8", () => ({ sendJobPhotoAs: async (_p: unknown, i: { documentId: string }) => (sent.push(i.documentId), { ok: true }) }));
jest.mock("@/lib/tiff/ocr", () => ({ slicePdf: async (_b: Uint8Array, p: number[]) => (slices.push(p), new Uint8Array(sliceSize)) }));
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
const sent: string[] = [];
const slices: number[][] = [];
let sliceSize = 10;

import { beginTiffFile, fileWithNote, pagesFor, readTiffFiles, wordsToFind } from "../tiff-files";
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
  sent.length = 0;
  slices.length = 0;
  sliceSize = 10;
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

it("shows a PDF past the model's pages by the pages that matter, with its words, saying which", async () => {
  pages = 101;
  rows = [row("application/pdf")];
  const blocks = await readTiffFiles(ctx, [id], "look at page 40");
  expect(blocks.map((b) => b.type)).toEqual(["text", "document"]);
  expect(slices[0]).toEqual([40]);
  expect(blocks[0]).toMatchObject({ text: expect.stringContaining("only pages 40") });
});

it("halves the pages until they fit, and says when only the words could go", async () => {
  pages = 101;
  rows = [row("application/pdf")];
  sliceSize = 21 * 1024 * 1024;
  const blocks = await readTiffFiles(ctx, [id], "");
  expect(slices.map((s) => s.length)).toEqual([30, 15, 7, 3, 1]);
  expect(blocks).toEqual([{ type: "text", text: expect.stringContaining("only have its words") }]);
});

describe("pagesFor", () => {
  const texts = ["cover", "contents", "wiring PUMY-P200", "fault 4220 means", "more", "the end"];
  it("takes the words worth finding, not the small ones", () => {
    expect(wordsToFind("What does fault 4220 mean on the PUMY-P200?")).toEqual(["fault", "4220", "mean", "pumy-p200"]);
  });
  it("finds the pages saying the question's words, with the pages beside them, in order", () => {
    expect(pagesFor("what is fault 4220", texts, 3)).toEqual([3, 4, 5]);
  });
  it("takes a page or a range it names", () => {
    expect(pagesFor("show me pages 2 to 3", texts)).toEqual([2, 3]);
    expect(pagesFor("page 99", texts, 2)).toEqual([1, 2]);
  });
  it("falls back to the first pages with nothing to find", () => {
    expect(pagesFor("have a look", texts, 2)).toEqual([1, 2]);
  });
});

describe("fileWithNote", () => {
  const press = { orgId: "org-1", userId: "u1" } as never;
  const pdf = { ...row("application/pdf"), id: "d-pdf" };
  const photo = { ...row("image/jpeg", "plate.jpg"), id: "d-photo" };
  beforeEach(() => {
    moved.length = 0;
  });

  it("puts them on the job the note went on, a photo on to ServiceM8 and a PDF not", async () => {
    rows = [pdf, photo];
    note = { target_kind: "job", target_id: "job-1" };
    expect(await fileWithNote(ctx, press, "n1", [id])).toBeNull();
    expect(moved).toEqual([
      { kind: "job_document", sm8_job_uuid: "job-1" },
      { kind: "job_photo", sm8_job_uuid: "job-1" },
    ]);
    expect(sent).toEqual(["d-photo"]);
  });

  it("says so when there's no job for them to go on, and moves nothing", async () => {
    rows = [photo];
    note = { target_kind: "none", target_id: null };
    expect(await fileWithNote(ctx, press, "n1", [id])).toContain("plate.jpg isn't with it");
    expect(moved).toEqual([]);
  });

  it("does nothing for files already on a job, which aren't hers to move", async () => {
    rows = [];
    expect(await fileWithNote(ctx, press, "n1", [id])).toBeNull();
  });
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
