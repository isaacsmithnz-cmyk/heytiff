import { KB_CATEGORIES, filterKbDocs, kbCounts, type KbDoc } from "../kb";
import { ICON_PATHS } from "@/components/shell/icon";

// A small local sample — one doc per category. Used to exercise kbCounts and
// the category config. (There is no demo library any more; real uploads land
// with the Documents/storage track.)
const sampleDocs: KbDoc[] = [
  { id: "s1", category: "install", title: "Ducted install checklist", kind: "PDF", source: "HeyTiff", updated: "May 2026" },
  { id: "s2", category: "faults", title: "City Multi fault codes", kind: "PDF", source: "Service handbook", updated: "Jun 2026" },
  { id: "s3", category: "specs", title: "PEAD-M datasheets", kind: "PDF", source: "Mitsubishi", updated: "May 2026" },
  { id: "s4", category: "sops", title: "Warranty claim process", kind: "Doc", source: "Company SOP", updated: "Jun 2026" },
  { id: "s5", category: "faults", title: "VRV error index", kind: "PDF", source: "Daikin", updated: "Mar 2026" },
];

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

  it("every sample doc belongs to a defined category", () => {
    const keys = new Set(KB_CATEGORIES.map((c) => c.key));
    for (const d of sampleDocs) expect(keys.has(d.category)).toBe(true);
  });

  it("kbCounts covers every category and sums to the doc total", () => {
    const counts = kbCounts(sampleDocs);
    for (const c of KB_CATEGORIES) {
      expect(typeof counts[c.key]).toBe("number");
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(sampleDocs.length);
    expect(counts.faults).toBe(2);
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
