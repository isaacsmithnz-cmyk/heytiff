import {
  asDocumentKind,
  checkUpload,
  displayName,
  fmtBytes,
  isImage,
  MAX_BYTES,
  refIsOrgs,
  storageRef,
} from "../files";

const ORG = "11111111-1111-1111-1111-111111111111";
const DOC = "22222222-2222-2222-2222-222222222222";

describe("asDocumentKind", () => {
  it("passes the kinds we store through", () => {
    expect(asDocumentKind("notice_attachment")).toBe("notice_attachment");
    expect(asDocumentKind("receipt")).toBe("receipt");
    expect(asDocumentKind("org_logo")).toBe("org_logo");
  });

  it("has no default — an unknown kind must not become a stored file", () => {
    expect(asDocumentKind("payslip")).toBeNull();
    expect(asDocumentKind(null)).toBeNull();
  });
});

describe("checkUpload", () => {
  const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: "site.jpg",
    type: "image/jpeg",
    size: 1024,
    ...over,
  });

  it("accepts a photo and says what to call it", () => {
    expect(checkUpload(file())).toEqual({ ok: true, ext: "jpg" });
  });

  it("accepts a PDF", () => {
    expect(checkUpload(file({ name: "invoice.pdf", type: "application/pdf" }))).toEqual({
      ok: true,
      ext: "pdf",
    });
  });

  it("is not fooled by the case of the mime type", () => {
    expect(checkUpload(file({ type: "IMAGE/PNG" }))).toEqual({ ok: true, ext: "png" });
  });

  it("refuses anything else, by type and not by extension", () => {
    // the name says jpg; the type is what actually matters
    const res = checkUpload(file({ name: "sneaky.jpg", type: "application/x-msdownload" }));
    expect(res.ok).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(checkUpload(file({ size: 0 })).ok).toBe(false);
  });

  it("refuses one over the limit, and allows one exactly on it", () => {
    expect(checkUpload(file({ size: MAX_BYTES })).ok).toBe(true);
    expect(checkUpload(file({ size: MAX_BYTES + 1 })).ok).toBe(false);
  });

  it("refuses a file with no name", () => {
    expect(checkUpload(file({ name: "   " })).ok).toBe(false);
  });
});

describe("storageRef", () => {
  it("puts every object under its org, and names it by id", () => {
    expect(storageRef(ORG, "notice_attachment", DOC, "jpg")).toBe(
      `org/${ORG}/notice_attachment/${DOC}.jpg`,
    );
  });

  it("never uses the file name, so a name can't become a path", () => {
    const ref = storageRef(ORG, "receipt", DOC, "pdf");
    expect(ref).not.toContain("..");
    expect(ref.split("/")).toHaveLength(4);
  });
});

describe("refIsOrgs", () => {
  it("recognises this org's own objects", () => {
    expect(refIsOrgs(`org/${ORG}/receipt/${DOC}.pdf`, ORG)).toBe(true);
  });

  it("rejects another org's, and anything not under org/", () => {
    expect(refIsOrgs(`org/99999999-9999-9999-9999-999999999999/receipt/x.pdf`, ORG)).toBe(false);
    expect(refIsOrgs(`${ORG}/receipt/x.pdf`, ORG)).toBe(false);
    expect(refIsOrgs("", ORG)).toBe(false);
  });
});

describe("isImage", () => {
  it("knows a photo from a document", () => {
    expect(isImage("image/png")).toBe(true);
    expect(isImage("IMAGE/HEIC")).toBe(true);
    expect(isImage("application/pdf")).toBe(false);
  });
});

describe("displayName", () => {
  it("tidies whitespace and never returns nothing", () => {
    expect(displayName("  site photo.jpg ")).toBe("site photo.jpg");
    expect(displayName("   ")).toBe("Untitled");
  });

  it("flattens newlines that would break a one-line label", () => {
    expect(displayName("two\nlines.jpg")).toBe("two lines.jpg");
  });

  it("truncates a name nobody could read", () => {
    const long = `${"a".repeat(200)}.jpg`;
    expect(displayName(long)).toHaveLength(78);
    expect(displayName(long).endsWith("…")).toBe(true);
  });
});

describe("fmtBytes", () => {
  it("reads sizes the way people say them", () => {
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(2048)).toBe("2 KB");
    expect(fmtBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(fmtBytes(MAX_BYTES)).toBe("10 MB");
  });
});
