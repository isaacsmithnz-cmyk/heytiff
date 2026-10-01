/* The browser half of an upload (upload-client.ts), run for real: the drawer's
   tests mock it whole, which is how a large file passed the drawer and was
   then refused here before the server was ever asked (2026-10-01). */

const beginKbUpload = jest.fn(async () => ({ ok: true, documentId: "doc-1", bucket: "kb", ref: "org/o/kb/doc-1.pdf", token: "t" }));
const confirmKbUpload = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/kb", () => ({
  beginKbUpload: (...a: unknown[]) => beginKbUpload(...(a as [])),
  confirmKbUpload: (...a: unknown[]) => confirmKbUpload(...(a as [])),
}));
const uploadToSignedUrl = jest.fn(async () => ({ error: null }));
jest.mock("@/lib/supabase-browser", () => ({
  supabaseBrowser: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));

import { uploadKbFile } from "../upload-client";

const book = () => {
  const f = new File([new Uint8Array(8)], "2024_M-S-P_DATA_BOOK.pdf", { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: 131 * 1024 * 1024 });
  return f;
};

beforeEach(() => jest.clearAllMocks());

describe("uploading a whole data book", () => {
  it("goes through for an owner with a turn left", async () => {
    const res = await uploadKbFile(book(), {
      title: "2024 M-S-P Data Book",
      category: "specs",
      large: { left: 2, resetsOn: "2026-11-01" },
    });
    expect(res).toEqual({ ok: true, documentId: "doc-1" });
    expect(beginKbUpload).toHaveBeenCalled();
    expect(uploadToSignedUrl).toHaveBeenCalled();
  });

  it("is refused before a slot is asked for when there is no allowance", async () => {
    const res = await uploadKbFile(book(), { title: "2024 M-S-P Data Book", category: "specs" });
    expect(res.ok).toBe(false);
    expect(beginKbUpload).not.toHaveBeenCalled();
  });
});
