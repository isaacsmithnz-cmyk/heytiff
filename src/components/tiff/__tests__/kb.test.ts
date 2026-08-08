import { KB_CATEGORIES, filterKbDocs } from "../kb";
import { ICON_PATHS } from "@/components/shell/icon";

/* The four categories are product structure — they colour the rail cards, the
   library sections and the source chips, and the database carries the same
   CHECK. What's pinned here is that the config is complete and that the
   library's search box behaves the same on a row with no source as on one
   with. */

describe("knowledge base config", () => {
  it("has five categories with unique keys and real icons", () => {
    expect(KB_CATEGORIES).toHaveLength(5);
    const keys = KB_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of KB_CATEGORIES) {
      expect(ICON_PATHS[c.icon]).toBeTruthy();
      expect(c.color).toMatch(/^#/);
    }
  });

  it("matches title and source, case-insensitively", () => {
    const docs = [
      { title: "Mitsubishi fault codes", source: "Service handbook" },
      { title: "Warranty claim process", source: "Company SOP" },
    ];
    expect(filterKbDocs(docs, "MITSUBISHI")).toHaveLength(1);
    expect(filterKbDocs(docs, "handbook")).toHaveLength(1);
    expect(filterKbDocs(docs, "")).toHaveLength(2);
    expect(filterKbDocs(docs, "nothing-matches")).toHaveLength(0);
  });

  /* THE FILENAME IS HALF THE POINT OF THE BOX. `source` is the optional
     "Brand or author" field and is usually blank, so searching title+source
     was in practice a title search — while the name people remember is the
     file they dragged in, which used to be discarded at upload. */
  it("finds a document by the file it arrived as", () => {
    const docs = [
      {
        title: "Daikin VRV Diagnosis Manual",
        source: null,
        fileName: "daikin vrv diagnosis manual.pdf",
      },
      { title: "Install checklist", source: null, fileName: "PUZ-ZM250_install.pdf" },
    ];

    expect(filterKbDocs(docs, "puz-zm250")).toHaveLength(1);
    expect(filterKbDocs(docs, ".pdf")).toHaveLength(2);
    // and the title still wins on its own terms
    expect(filterKbDocs(docs, "diagnosis")).toHaveLength(1);
  });

  /* Real rows come from the database, where `source` and `file_name` are both
     nullable — every row uploaded before the filename was captured has none,
     and the same search has to work on both shapes. */
  it("searches a row that has no source without falling over", () => {
    const docs = [{ title: "Untitled upload", source: null }];
    expect(filterKbDocs(docs, "untitled")).toHaveLength(1);
    expect(filterKbDocs(docs, "mitsubishi")).toHaveLength(0);
  });
});
