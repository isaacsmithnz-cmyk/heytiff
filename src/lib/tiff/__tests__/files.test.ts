/* What the knowledge base will take, and where it puts it.

   The bucket enforces the same two numbers, but this is the check that happens
   BEFORE a slot is handed out — a refused file never reaches storage at all. */

import {
  asKbCategory,
  checkKbUpload,
  KB_BUCKET,
  KB_CATEGORIES,
  kbRefIsOrgs,
  kbStorageRef,
  kbTitle,
  MAX_KB_BYTES,
} from "../files";

describe("what may be stored", () => {
  it("takes a PDF inside the limit", () => {
    expect(checkKbUpload({ type: "application/pdf", size: 4_000_000 })).toEqual({ ok: true });
  });

  /* A browser sends `application/pdf; charset=binary` often enough, and an
     uppercase type comes off some Windows uploads. Neither is a different
     file. */
  it("reads the mime type the way browsers actually send it", () => {
    expect(checkKbUpload({ type: "APPLICATION/PDF", size: 10 }).ok).toBe(true);
    expect(checkKbUpload({ type: "application/pdf; charset=binary", size: 10 }).ok).toBe(true);
  });

  it("refuses everything that isn't a PDF — v1 reads text layers only", () => {
    for (const type of ["image/png", "application/msword", "text/plain", "", "application/pdfx"]) {
      expect(checkKbUpload({ type, size: 1000 })).toEqual({
        ok: false,
        error: "The knowledge base takes PDFs only.",
      });
    }
  });

  it("refuses an empty file and a nonsense size", () => {
    expect(checkKbUpload({ type: "application/pdf", size: 0 }).ok).toBe(false);
    expect(checkKbUpload({ type: "application/pdf", size: NaN }).ok).toBe(false);
    expect(checkKbUpload({ type: "application/pdf", size: -1 }).ok).toBe(false);
  });

  /* 50 MB, not the documents bucket's 10 — that ceiling is the whole reason
     this track has its own bucket. */
  it("allows 50 MB and refuses a byte past it", () => {
    expect(MAX_KB_BYTES).toBe(50 * 1024 * 1024);
    expect(checkKbUpload({ type: "application/pdf", size: MAX_KB_BYTES }).ok).toBe(true);
    const over = checkKbUpload({ type: "application/pdf", size: MAX_KB_BYTES + 1 });
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.error).toContain("50 MB");
  });
});

describe("categories", () => {
  it("narrows to the four the database also checks", () => {
    expect([...KB_CATEGORIES]).toEqual(["install", "faults", "specs", "sops"]);
    for (const cat of KB_CATEGORIES) expect(asKbCategory(cat)).toBe(cat);
  });

  it("refuses anything else rather than guessing one", () => {
    for (const junk of ["Install", "manuals", "", null, 7, ["install"], undefined]) {
      expect(asKbCategory(junk)).toBeNull();
    }
  });
});

describe("the object key", () => {
  it("carries the org, the bucket's shelf and the document id", () => {
    expect(kbStorageRef("org-1", "doc-9")).toBe("org/org-1/kb/doc-9.pdf");
    expect(KB_BUCKET).toBe("kb");
  });

  /* The file's own name is never in the path, so "../../secrets.pdf" can't
     become one and two people uploading "manual.pdf" don't collide. */
  it("never contains the uploaded file's name", () => {
    expect(kbStorageRef("org-1", "doc-9")).not.toContain("manual");
  });

  it("recognises this org's refs and only this org's", () => {
    expect(kbRefIsOrgs("org/org-1/kb/doc-9.pdf", "org-1")).toBe(true);
    expect(kbRefIsOrgs("org/org-2/kb/doc-9.pdf", "org-1")).toBe(false);
    expect(kbRefIsOrgs("org/org-11/kb/doc-9.pdf", "org-1")).toBe(false);
    expect(kbRefIsOrgs("", "org-1")).toBe(false);
  });
});

describe("titles", () => {
  it("trims, flattens and never returns empty", () => {
    expect(kbTitle("  City Multi install guide \n")).toBe("City Multi install guide");
    expect(kbTitle("a\tb")).toBe("a b");
    expect(kbTitle("   ")).toBe("Untitled");
  });

  it("caps a pasted essay", () => {
    const long = kbTitle("x".repeat(400));
    expect(long).toHaveLength(158); // 157 + the ellipsis
    expect(long.endsWith("…")).toBe(true);
  });
});
