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
    // list together with the edge change. The three hand-authored toolbox
    // tools are deliberately pack-free and backend-free. `tiff` LEFT this list
    // when the knowledge base landed — it has its own store and two vendors.
    expect(standaloneIds().sort()).toEqual(
      ["hq-map", "tb-fault", "tb-outdoor", "tb-press"].sort()
    );
  });

  it("Tiff reaches its own store and the two services that read for it", () => {
    // The store is FIRST and is the point: an answer Tiff can't trace to a
    // chunk in kb_chunks isn't a knowledge-base answer. The embeddings vendor
    // is optional at runtime (no key ⇒ keyword-only) but the edge is real.
    expect(drawsFrom("tiff").map((e) => e.to).sort()).toEqual(
      ["anthropic", "db-kb", "voyage"].sort()
    );
    // and nothing else writes into the library's tables
    expect(feeds("db-kb").map((e) => e.from)).toEqual(["tiff"]);
  });

  it("helpers agree with the raw edge list", () => {
    // the calculator reaches Xero through the read layer, never directly
    expect(drawsFrom("rate").map((e) => e.to).sort()).toEqual(
      ["db-rate", "db-staff", "eng-rate", "eng-xero-read", "timepay"].sort()
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

  it("the Smart Notes engine reaches exactly what it's allowed to touch", () => {
    // Two vendors and four stores — and the tasks table is the EXISTING one,
    // which is the whole reason a dictated task arrives assigned and notified.
    expect(drawsFrom("eng-voice-notes").map((e) => e.to).sort()).toEqual(
      ["anthropic", "db-board", "db-staff", "db-workboard", "elevenlabs"].sort()
    );
  });

  it("the board's own store stands alone — no integration in its neighbourhood", () => {
    // Standalone-first is the load-bearing claim: a typed job number has to
    // work with nothing connected. If a future edge wires db-workboard to a
    // vendor or a mirror, that claim quietly stops being true.
    const reachable = [...neighbourhood("db-workboard")].filter((id) => id !== "db-workboard");
    expect(reachable.sort()).toEqual(["eng-voice-notes", "workboard"].sort());
    for (const id of reachable) {
      expect(nodeById(id)?.kind).not.toBe("external");
    }
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
