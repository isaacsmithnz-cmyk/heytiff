/**
 * @jest-environment node
 */
/* What Tiff looks at (4.6): the job's cached photos and documents, a
   picture resized as the plate reader sends it, a PDF as a document, and
   what she can't read said so. */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: jest.fn(async () => []) }));
const groups = jest.fn();
jest.mock("@/lib/workboard/job-media-query", () => ({ readJobMediaGroups: (...a: unknown[]) => groups(...a) }));
jest.mock("@/lib/images/for-claude", () => ({ imageForClaude: jest.fn(async () => ({ bytes: Buffer.from("jpg"), mime: "image/jpeg" })) }));

/* pdfjs is hard ESM jest can't load (extract.ts says so): a PDF's pages, faked */
let pages: string[] = [];
jest.mock("@/lib/tiff/extract", () => ({
  isScannedPage: (t: string) => t.trim().length < 40,
  openPdf: async () => ({ numPages: pages.length, pageText: async (n: number) => pages[n - 1] ?? "", destroy: async () => undefined }),
}));
import { jobFiles, lookAt, pdfWords } from "../job-files-server";

const item = (o: Record<string, unknown>) => ({ remoteId: "x", name: "x", fileType: null, kind: "photo", origin: null, takenAt: null, url: "https://store/x", width: null, height: null, fromClaim: null, ...o });

beforeEach(() => {
  groups.mockResolvedValue({
    photos: [item({ remoteId: "p1", name: "Switchboard", fileType: "jpg" }), item({ remoteId: "v1", name: "Walkthrough", kind: "video" }), item({ remoteId: "p2", name: "Not cached", url: null })],
    documents: [item({ remoteId: "d1", name: "Plan.pdf", kind: "document", fileType: "pdf" }), item({ remoteId: "d2", name: "Notes.docx", kind: "document", fileType: "docx" })],
    elsewhere: [],
    truncated: false,
  });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8), headers: new Map([["content-type", "image/jpeg"]]) }));
});

it("lists the cached photos and documents, no video", async () => {
  expect((await jobFiles("org", "job")).map((f) => [f.id, f.kind])).toEqual([
    ["p1", "photo"],
    ["d1", "document"],
    ["d2", "document"],
  ]);
});

it("hands her a picture as an image, a PDF as a document, and says what it can't", async () => {
  expect(await lookAt("org", "job", "p1")).toEqual([{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from("jpg").toString("base64") } }]);
  expect((await lookAt("org", "job", "d1")) as unknown[]).toMatchObject([{ type: "document", source: { media_type: "application/pdf" } }]);
  expect(await lookAt("org", "job", "d2")).toBe("She can look at pictures and PDFs only.");
  expect(await lookAt("org", "job", "p2")).toBe("That file isn't on the job, or isn't here yet.");
});

/* 3421, 21 October: she looked at ServiceM8's quote twice, the file gone by
   the round she wrote in each time, and said she couldn't read its figures */
it("hands her a PDF's own text beside it, which stays once the file is dropped", async () => {
  pages = ["SCOPE OF WORKS: Option 1 ducted 10 kW. Option 1 $9,100.00, Option 2 zoning upgrade $1,150.00, 6kw high wall $3,600.00"];
  const seen = (await lookAt("org", "job", "d1")) as { type: string; text?: string }[];
  expect(seen.map((b) => b.type)).toEqual(["document", "text"]);
  expect(seen[1]!.text).toContain("[page 1]\nSCOPE OF WORKS: Option 1 ducted 10 kW. Option 1 $9,100.00");
  /* a scan has no text to keep: the picture alone */
  pages = ["  "];
  expect(((await lookAt("org", "job", "d1")) as { type: string }[]).map((b) => b.type)).toEqual(["document"]);
});

it("keeps the pages with text, says where it stopped, and nothing for a scan", () => {
  const long = "x".repeat(200);
  expect(pdfWords(["", long])).toBe(`The PDF's own text, which stays with you after the file is dropped:\n[page 2]\n${long}`);
  expect(pdfWords([long], true)).toContain("[The rest isn't kept here: look at the file again for it.]");
  expect(pdfWords(["y".repeat(13_000)])).toContain("[The rest isn't kept here");
  expect(pdfWords(["", " "])).toBe("");
});
