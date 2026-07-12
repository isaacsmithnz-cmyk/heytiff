/* Stage-0 lock gate: document save/load round-trips; schema versioned.
   (design-studio-plan.md, Part 3 stage 0) */

import {
  SCHEMA_VERSION,
  createDesign,
  serializeDesign,
  isDesignDocumentShape,
  type DesignDocument,
} from "../document";
import { openDesignJson, migrateDesign, DesignDocumentError } from "../migrations";
import { LocalDesignStore, summarize, type StorageLike } from "../store";

function fakeStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("design document schema v1", () => {
  it("createDesign produces a current-version document", () => {
    const d = createDesign({ name: "Test job", mode: "plan" });
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(isDesignDocumentShape(d)).toBe(true);
    expect(d.meta.name).toBe("Test job");
    expect(d.floors).toEqual([]);
    expect(d.objects).toEqual([]);
    expect(d.systems).toEqual([]);
    expect(d.packPins).toEqual({});
  });

  it("blank-canvas designs start with one floor at the explicit default scale", () => {
    const d = createDesign({ name: "Sketch", mode: "blank" });
    expect(d.floors).toHaveLength(1);
    expect(d.floors[0].scaleMmPerUnit).toBe(10);
    expect(d.floors[0].plans).toEqual([]);
  });

  it("serialise → open round-trips the full tree unchanged", () => {
    const d = createDesign({ name: "Round trip", mode: "blank" });
    d.systems.push({
      id: "sys_1",
      type: "split",
      brand: "Mitsubishi Electric",
      colour: "#2E68FF",
      name: "Lounge split",
      settings: { phase: "1" },
    });
    d.objects.push({
      id: "obj_1",
      type: "room",
      systemId: null,
      floorId: d.floors[0].id,
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 8 },
          { x: 0, y: 8 },
        ],
      },
      plane: "room",
      props: { label: "Lounge" },
    });
    d.packPins["mitsubishi-electric"] = "2026.1";

    const { doc, migratedFrom } = openDesignJson(serializeDesign(d));
    expect(doc).toEqual(d);
    expect(migratedFrom).toBeNull();
  });
});

describe("schema versioning + migrations", () => {
  it("rejects non-JSON", () => {
    expect(() => openDesignJson("not json {")).toThrow(DesignDocumentError);
    try {
      openDesignJson("not json {");
    } catch (e) {
      expect((e as DesignDocumentError).code).toBe("not-json");
    }
  });

  it("rejects JSON that is not a design document", () => {
    try {
      openDesignJson(JSON.stringify({ hello: "world" }));
      fail("should have thrown");
    } catch (e) {
      expect((e as DesignDocumentError).code).toBe("not-a-design");
    }
  });

  it("rejects documents from a newer schema", () => {
    const d = createDesign({ name: "Future", mode: "plan" });
    const future = { ...d, schemaVersion: SCHEMA_VERSION + 1 };
    try {
      migrateDesign(future);
      fail("should have thrown");
    } catch (e) {
      expect((e as DesignDocumentError).code).toBe("future-version");
    }
  });

  it("refuses to open an old version with no registered migration", () => {
    const d = createDesign({ name: "Old", mode: "plan" });
    const old = { ...d, schemaVersion: 0 };
    try {
      migrateDesign(old);
      fail("should have thrown");
    } catch (e) {
      expect((e as DesignDocumentError).code).toBe("missing-migration");
    }
  });

  it("migrates v1 documents: single floor.plan becomes a plans[] sheet", () => {
    // a golden v1 document, as Stage-1 clients saved it
    const v1 = {
      schemaVersion: 1,
      id: "dsn_v1test",
      meta: {
        name: "Old job",
        jobNumber: "",
        client: "",
        site: "",
        mode: "plan",
        createdAt: "2026-07-05T00:00:00.000Z",
        updatedAt: "2026-07-05T00:00:00.000Z",
      },
      settings: {
        climateZone: null,
        buildingType: null,
        sizingBasis: "worst-of-both",
        units: "mm",
      },
      floors: [
        {
          id: "flr_a",
          name: "Ground floor",
          level: 0,
          scaleMmPerUnit: 4.2,
          northDeg: null,
          plan: { imageRef: "org/o1/p.png", pageNumber: 2, width: 2000, height: 1400 },
        },
        {
          id: "flr_b",
          name: "Sketch",
          level: 1,
          scaleMmPerUnit: 10,
          northDeg: null,
          plan: null,
        },
      ],
      objects: [],
      systems: [],
      packPins: {},
    };
    const { doc, migratedFrom } = migrateDesign(v1);
    expect(migratedFrom).toBe(1);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.floors[0].plans).toEqual([
      {
        id: "sht_flr_a",
        imageRef: "org/o1/p.png",
        pageNumber: 2,
        name: "Ground floor",
        width: 2000,
        height: 1400,
        x: 0,
        y: 0,
      },
    ]);
    expect(doc.floors[1].plans).toEqual([]);
    expect((doc.floors[0] as unknown as Record<string, unknown>).plan).toBeUndefined();
    // calibration survives untouched
    expect(doc.floors[0].scaleMmPerUnit).toBe(4.2);
  });

  it("migrates v3→v4: auto 'Page N' floor names become stack positions", () => {
    const base = createDesign({ name: "x", mode: "blank" });
    const v3 = {
      ...JSON.parse(JSON.stringify(base)),
      schemaVersion: 3,
      floors: [
        { id: "f0", name: "Page 6", level: 0, scaleMmPerUnit: 10, northDeg: null, plans: [] },
        { id: "f1", name: "Page 7", level: 1, scaleMmPerUnit: 10, northDeg: null, plans: [] },
        { id: "f2", name: "Basement", level: -1, scaleMmPerUnit: 10, northDeg: null, plans: [] },
      ],
    };
    const { doc, migratedFrom } = migrateDesign(v3);
    expect(migratedFrom).toBe(3);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    // the auto page-label names take their stack position…
    expect(doc.floors[0].name).toBe("Ground floor");
    expect(doc.floors[1].name).toBe("Level 1");
    // …but a custom name ("Basement") is left untouched
    expect(doc.floors[2].name).toBe("Basement");
  });

  it("migrates v4→v5: adds an empty plan-import session", () => {
    const base = createDesign({ name: "x", mode: "plan" });
    const v4 = { ...JSON.parse(JSON.stringify(base)), schemaVersion: 4 };
    delete v4.planImport; // v4 documents never had it
    const { doc, migratedFrom } = migrateDesign(v4);
    expect(migratedFrom).toBe(4);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.planImport).toBeNull();
  });

  it("migrates v5→v6: every floor gains northPos: null", () => {
    const base = createDesign({ name: "x", mode: "blank" });
    const v5 = { ...JSON.parse(JSON.stringify(base)), schemaVersion: 5 };
    v5.floors = v5.floors.map((f: Record<string, unknown>) => {
      const { northPos, ...rest } = f; // v5 floors never had it
      void northPos;
      return rest;
    });
    const { doc, migratedFrom } = migrateDesign(v5);
    expect(migratedFrom).toBe(5);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.floors.every((f) => f.northPos === null)).toBe(true);
  });
});

describe("LocalDesignStore", () => {
  it("save → load round-trips; list carries summaries", async () => {
    const store = new LocalDesignStore(fakeStorage());
    const d = createDesign({ name: "Stored job", mode: "blank" });
    await store.save(d);

    expect(await store.load(d.id)).toEqual(d);
    const list = await store.list();
    expect(list).toEqual([summarize(d)]);
    expect(list[0].floorCount).toBe(1);
  });

  it("re-saving updates the index entry instead of duplicating it", async () => {
    const store = new LocalDesignStore(fakeStorage());
    const d = createDesign({ name: "One", mode: "plan" });
    await store.save(d);
    const renamed: DesignDocument = {
      ...d,
      meta: { ...d.meta, name: "One (renamed)", updatedAt: new Date().toISOString() },
    };
    await store.save(renamed);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("One (renamed)");
  });

  it("lists most-recently-updated first", async () => {
    const store = new LocalDesignStore(fakeStorage());
    const a = createDesign({ name: "A", mode: "plan", now: "2026-07-01T00:00:00.000Z" });
    const b = createDesign({ name: "B", mode: "plan", now: "2026-07-02T00:00:00.000Z" });
    await store.save(a);
    await store.save(b);
    expect((await store.list()).map((s) => s.name)).toEqual(["B", "A"]);
  });

  it("remove deletes the document and its index entry", async () => {
    const store = new LocalDesignStore(fakeStorage());
    const d = createDesign({ name: "Doomed", mode: "plan" });
    await store.save(d);
    await store.remove(d.id);
    expect(await store.load(d.id)).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("load returns null for unknown ids", async () => {
    const store = new LocalDesignStore(fakeStorage());
    expect(await store.load("nope")).toBeNull();
  });
});
