/* The probe's two pure parts.

   The candidate URLs are pinned because the probe's whole value is knowing
   WHICH shape was tried — a shape quietly dropped or misspelled would turn "no
   download endpoint exists" into a wrong conclusion we'd then build around.

   The sniff is pinned because it is the difference between "answered 200" and
   "answered with a file", and the failures it exists to catch (an HTML error
   page, a JSON error body) both arrive with an encouraging status. */

import {
  attachmentFileCandidates,
  looksLikeFile,
  sniffFileKind,
} from "../sm8-attachment-probe";

const UUID = "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809";

describe("attachmentFileCandidates", () => {
  it("tries all three shapes ServiceM8's own surface suggests", () => {
    expect(attachmentFileCandidates(UUID).map((c) => c.shape)).toEqual([
      "Attachment/{uuid}.file",
      "attachment/{uuid}.file",
      "dboattachment/{uuid}.file",
    ]);
  });

  it("builds them against the live API base, uuid intact", () => {
    const urls = attachmentFileCandidates(UUID).map((c) => c.url);
    expect(urls).toEqual([
      `https://api.servicem8.com/api_1.0/Attachment/${UUID}.file`,
      `https://api.servicem8.com/api_1.0/attachment/${UUID}.file`,
      `https://api.servicem8.com/api_1.0/dboattachment/${UUID}.file`,
    ]);
  });

  it("keeps the api_1.0 segment — a relative URL would eat it", () => {
    /* new URL("Attachment/x.file", base) only keeps /api_1.0/ because the base
       ends in a slash. Drop that slash and every candidate silently becomes
       api.servicem8.com/Attachment/… — a 404 that reads as "no such endpoint"
       and would end the whole media feature on a wrong answer. */
    for (const c of attachmentFileCandidates(UUID)) {
      expect(c.url).toContain("/api_1.0/");
    }
  });
});

describe("sniffFileKind", () => {
  const head = (...bytes: number[]) => new Uint8Array(bytes);

  it("knows a PDF", () => {
    expect(sniffFileKind(head(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31))).toBe("pdf");
  });

  it("knows the image types a job's photos actually arrive as", () => {
    expect(sniffFileKind(head(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffFileKind(head(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("png");
    expect(sniffFileKind(head(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("gif");
  });

  it("knows a webp, which needs bytes 8-11 and not just the RIFF", () => {
    const webp = head(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
    expect(sniffFileKind(webp)).toBe("webp");
    // RIFF with something else at 8 is a wav or avi, not an image.
    const wav = head(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45);
    expect(sniffFileKind(wav)).toBeNull();
  });

  it("knows the mp4/HEIC family by its ftyp box", () => {
    expect(sniffFileKind(head(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70))).toBe("isobmff");
  });

  it("catches an HTML error page dressed as a 200", () => {
    expect(sniffFileKind(head(0x3c, 0x21, 0x44, 0x4f))).toBe("markup-or-html"); // <!DO
    expect(looksLikeFile("markup-or-html")).toBe(false);
  });

  it("catches a JSON error body dressed as a 200", () => {
    expect(sniffFileKind(head(0x7b, 0x22, 0x65, 0x72))).toBe("json"); // {"er
    expect(sniffFileKind(head(0x5b, 0x5d))).toBe("json"); // []
    expect(looksLikeFile("json")).toBe(false);
  });

  it("does not treat bytes it can't name as a failure", () => {
    // A HEIC variant, a raw camera format, an old TIFF — unrecognised is a
    // real answer for a probe asking "are these bytes?", not a red flag.
    expect(sniffFileKind(head(0x49, 0x49, 0x2a, 0x00))).toBeNull();
    expect(looksLikeFile(null)).toBe(true);
  });

  it("doesn't read past a body shorter than the magic number", () => {
    // An empty or one-byte body must not throw, and must not match.
    expect(sniffFileKind(head())).toBeNull();
    expect(sniffFileKind(head(0x25))).toBeNull(); // '%' alone is not %PDF
    expect(sniffFileKind(head(0x52, 0x49, 0x46, 0x46))).toBeNull(); // RIFF, no room for WEBP
  });
});
