/* What the knowledge base will take, and where it puts it.

   The bucket enforces the same two numbers, but this is the check that happens
   BEFORE a slot is handed out — a refused file never reaches storage at all. */

import {
  asKbCategory,
  checkKbUpload,
  fmtResets,
  isLargeKb,
  KB_LARGE_PER_MONTH,
  MAX_KB_LARGE_BYTES,
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
        error: "The library takes PDFs only.",
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

/* A whole data book (Isaac, 2026-09-30): up to 150 MB, owners only, twice a
   month for the org. */
describe("large uploads", () => {
  const pdf = (size: number) => ({ type: "application/pdf", size });
  const owner = (left: number) => ({ left, resetsOn: "2026-11-01" });

  it("lets an owner with a turn left bring in up to 150 MB, and no further", () => {
    expect(MAX_KB_LARGE_BYTES).toBe(150 * 1024 * 1024);
    expect(KB_LARGE_PER_MONTH).toBe(2);
    expect(checkKbUpload(pdf(131 * 1024 * 1024), owner(2)).ok).toBe(true);
    expect(checkKbUpload(pdf(MAX_KB_LARGE_BYTES), owner(1)).ok).toBe(true);
    const over = checkKbUpload(pdf(MAX_KB_LARGE_BYTES + 1), owner(2));
    expect(over.ok === false && over.error).toBe("That file is too big — 150 MB is the most the library takes.");
  });

  it("tells everyone else the 50 MB limit, and that an owner can go bigger", () => {
    const r = checkKbUpload(pdf(60 * 1024 * 1024), null);
    expect(r.ok === false && r.error).toBe(
      "That file is too big — 50 MB is the limit. An owner can add one up to 150 MB."
    );
  });

  it("says when the month's two are used, and when more come", () => {
    const r = checkKbUpload(pdf(60 * 1024 * 1024), owner(0));
    expect(r.ok === false && r.error).toBe(
      "That's over 50 MB, and this month's 2 large uploads are used. More from 1 November."
    );
  });

  it("never touches an ordinary upload, whoever makes it", () => {
    expect(checkKbUpload(pdf(MAX_KB_BYTES), null).ok).toBe(true);
    expect(checkKbUpload(pdf(MAX_KB_BYTES), owner(0)).ok).toBe(true);
    expect(isLargeKb(MAX_KB_BYTES)).toBe(false);
    expect(isLargeKb(MAX_KB_BYTES + 1)).toBe(true);
  });

  it("names the reset day the way a person says it", () => {
    expect(fmtResets("2026-11-01")).toBe("1 November");
    expect(fmtResets("2027-01-01")).toBe("1 January");
  });
});

describe("categories", () => {
  it("narrows to the five the database also checks — field is the crew's shelf", () => {
    expect([...KB_CATEGORIES]).toEqual(["install", "faults", "specs", "sops", "field"]);
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
