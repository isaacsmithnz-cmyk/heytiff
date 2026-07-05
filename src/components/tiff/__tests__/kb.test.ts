import { KB_CATEGORIES, filterKbDocs, kbCounts, type KbDoc } from "../kb";
import { demoKbDocs } from "@/mock/demo";
import { ICON_PATHS } from "@/components/shell/icon";

describe("knowledge base config", () => {
  it("has four categories with unique keys and real icons", () => {
    expect(KB_CATEGORIES).toHaveLength(4);
    const keys = KB_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of KB_CATEGORIES) {
      expect(ICON_PATHS[c.icon]).toBeTruthy();
      expect(c.color).toMatch(/^#/);
    }
  });

  it("every demo doc belongs to a defined category", () => {
    const keys = new Set(KB_CATEGORIES.map((c) => c.key));
    for (const d of demoKbDocs) expect(keys.has(d.category)).toBe(true);
  });

  it("kbCounts covers every category and sums to the doc total", () => {
    const counts = kbCounts(demoKbDocs);
    for (const c of KB_CATEGORIES) {
      expect(typeof counts[c.key]).toBe("number");
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(demoKbDocs.length);
  });

  it("kbCounts returns zeros for an empty library", () => {
    const counts = kbCounts([]);
    for (const c of KB_CATEGORIES) expect(counts[c.key]).toBe(0);
  });

  it("filterKbDocs matches title and source, case-insensitively", () => {
    const docs: KbDoc[] = [
      { id: "a", category: "faults", title: "Mitsubishi fault codes", kind: "PDF", source: "Service handbook", updated: "Jun 2026" },
      { id: "b", category: "sops", title: "Warranty claim process", kind: "Doc", source: "Company SOP", updated: "Jun 2026" },
    ];
    expect(filterKbDocs(docs, "MITSUBISHI")).toHaveLength(1);
    expect(filterKbDocs(docs, "handbook")).toHaveLength(1);
    expect(filterKbDocs(docs, "")).toHaveLength(2);
    expect(filterKbDocs(docs, "nothing-matches")).toHaveLength(0);
  });
});
