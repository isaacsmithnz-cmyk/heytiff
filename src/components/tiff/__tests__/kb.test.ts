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

  /* Real rows come from the database, where `source` is nullable — the same
     search has to work on both shapes, which is why it is generic. */
  it("searches a row that has no source without falling over", () => {
    const docs = [{ title: "Untitled upload", source: null }];
    expect(filterKbDocs(docs, "untitled")).toHaveLength(1);
    expect(filterKbDocs(docs, "mitsubishi")).toHaveLength(0);
  });
});
