import fs from "fs";
import path from "path";
import {
  NODES,
  EDGES,
  LAYERS,
  layerOf,
  nodeById,
  drawsFrom,
  feeds,
  standaloneIds,
  neighbourhood,
  validateSystemMap,
} from "../system-map";

/* The registry is a reference document — these tests are what stop it rotting
   as nodes and edges get added over time. */

describe("system map registry", () => {
  it("is structurally valid (unique ids, real endpoints, labels, layers)", () => {
    expect(validateSystemMap()).toEqual([]);
  });

  it("every declared source path exists on this branch", () => {
    const missing: string[] = [];
    for (const n of NODES) {
      for (const p of n.paths ?? []) {
        if (!fs.existsSync(path.join(process.cwd(), p))) missing.push(`${n.id}: ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("standalone pieces are exactly the ones we mean to be standalone", () => {
    // Going connected ↔ standalone should be a conscious decision: update this
    // list together with the edge change. `tiff` joined the list in Stage 7:
    // deleting mock/demo.ts removed its only edge, and its knowledge library is
    // empty until the Documents/storage track lands real uploads.
    expect(standaloneIds().sort()).toEqual(["hq-map", "tb-press", "tiff"].sort());
  });

  it("helpers agree with the raw edge list", () => {
    expect(drawsFrom("rate").map((e) => e.to).sort()).toEqual(
      ["db-rate", "eng-rate", "timepay"].sort()
    );
    expect(feeds("eng-loads").map((e) => e.from).sort()).toEqual(
      ["eng-sim", "studio", "tb-heat"].sort()
    );
    expect(neighbourhood("eng-packs")).toEqual(
      new Set(["eng-packs", "studio", "eng-sim", "hq-overview", "hq-data", "packs", "db-universal"])
    );
    expect(nodeById("studio")?.name).toBe("Design Studio");
    expect(nodeById("nope")).toBeUndefined();
  });

  it("every node lands in a render column", () => {
    for (const n of NODES) {
      expect(layerOf(n)).toBeGreaterThanOrEqual(0);
      expect(layerOf(n)).toBeLessThan(LAYERS.length);
    }
  });

  it("planned edges are dashed intent, not silent defaults", () => {
    // The Rate Calculator ← Time & Pay feed is the canonical planned link.
    const planned = EDGES.filter((e) => e.status === "planned");
    expect(planned).toContainEqual(
      expect.objectContaining({ from: "rate", to: "timepay" })
    );
  });
});
