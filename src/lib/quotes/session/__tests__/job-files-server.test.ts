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

import { jobFiles, lookAt } from "../job-files-server";

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
