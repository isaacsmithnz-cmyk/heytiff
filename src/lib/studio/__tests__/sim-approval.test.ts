/* "Ready to share" — the tick that lets a simulation reach a customer.

   These run against the REAL shipped pack, because the whole mechanism hangs
   off buildSimModel finding handlers on a floor: a fake pack would let the
   all-or-nothing rule pass without ever meeting a floor that can simulate. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { migrateDesign } from "../migrations";
import {
  designFingerprint,
  isFloorApproved,
  setFloorApproval,
  simApprovalState,
} from "../sim-approval";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

const IDU_MODEL = "MSZ-LN50VG3V";
const ODU_MODEL = "MUZ-LN50VG3";

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

/** one calibrated floor per `floorIds`, each with a room and a placed split
    pair — so every one of them genuinely simulates. */
function simDoc(floorIds: string[] = ["flr"]): DesignDocument {
  const d = createDesign({ name: "Sim", mode: "blank", now: "2026-07-13T00:00:00.000Z" });
  d.settings.climateZone = "5";
  d.floors = floorIds.map((id, i) => ({
    id,
    name: i === 0 ? "Ground" : `Level ${i}`,
    level: i,
    scaleMmPerUnit: 10,
    northDeg: null,
    northPos: null,
    plans: [],
  }));
  d.systems = floorIds.map((id, i) => ({
    id: `sys-${id}`,
    type: "split" as const,
    brand: "mitsubishi-electric",
    colour: "#2E68FF",
    name: `System ${i + 1}`,
    settings: {},
  }));
  d.objects = floorIds.flatMap((id) => [
    {
      id: `room-${id}`,
      type: "room",
      systemId: `sys-${id}`,
      floorId: id,
      geometry: rect(0, 0, 500, 400),
      plane: "room",
      props: { name: "Lounge", hasExternalWalls: true },
    },
    {
      id: `idu-${id}`,
      type: "unit",
      systemId: `sys-${id}`,
      floorId: id,
      geometry: { kind: "point", at: { x: 20, y: 200 } },
      plane: "room",
      props: { role: "idu", model: IDU_MODEL, roomId: `room-${id}` },
    },
    {
      id: `odu-${id}`,
      type: "unit",
      systemId: `sys-${id}`,
      floorId: id,
      geometry: { kind: "point", at: { x: 900, y: 100 } },
      plane: "external-ground",
      props: { role: "odu", model: ODU_MODEL },
    },
  ]) as DesignObject[];
  return d;
}

describe("designFingerprint", () => {
  it("is stable across a JSON round-trip", () => {
    const d = simDoc();
    const again = JSON.parse(JSON.stringify(d)) as DesignDocument;
    expect(designFingerprint(again)).toBe(designFingerprint(d));
  });

  it("ignores the order keys were written in", () => {
    /* `props` is an open Record and nobody controls its key order — a re-save
       that reorders it must not read as an edit to the design. */
    const a = simDoc();
    const b = simDoc();
    b.objects = b.objects.map((o) =>
      o.id === "room-flr"
        ? { ...o, props: { hasExternalWalls: true, name: "Lounge" } }
        : o
    );
    expect(designFingerprint(b)).toBe(designFingerprint(a));
  });

  it("ignores the letterhead — renaming the job is not a design change", () => {
    const a = simDoc();
    const b: DesignDocument = {
      ...a,
      meta: { ...a.meta, name: "Renamed", client: "Someone", jobNumber: "2214" },
    };
    expect(designFingerprint(b)).toBe(designFingerprint(a));
  });

  it("ignores its own approvals — otherwise no tick could ever be fresh", () => {
    const a = simDoc();
    const ticked = setFloorApproval(a, "flr", true, "2026-08-18T00:00:00.000Z");
    expect(designFingerprint(ticked)).toBe(designFingerprint(a));
  });

  it("changes when a unit moves, a room is renamed, or the basis changes", () => {
    const base = simDoc();
    const fp = designFingerprint(base);

    const moved: DesignDocument = {
      ...base,
      objects: base.objects.map((o) =>
        o.id === "idu-flr"
          ? { ...o, geometry: { kind: "point" as const, at: { x: 30, y: 200 } } }
          : o
      ),
    };
    expect(designFingerprint(moved)).not.toBe(fp);

    const renamed: DesignDocument = {
      ...base,
      objects: base.objects.map((o) =>
        o.id === "room-flr" ? { ...o, props: { ...o.props, name: "Living" } } : o
      ),
    };
    expect(designFingerprint(renamed)).not.toBe(fp);

    const rebased: DesignDocument = {
      ...base,
      settings: { ...base.settings, sizingBasis: "cooling" },
    };
    expect(designFingerprint(rebased)).not.toBe(fp);
  });
});

describe("setFloorApproval / isFloorApproved", () => {
  it("ticks, and the tick survives a save", () => {
    const d = setFloorApproval(simDoc(), "flr", true);
    expect(isFloorApproved(d, "flr")).toBe(true);
    const reopened = migrateDesign(JSON.parse(JSON.stringify(d))).doc;
    expect(isFloorApproved(reopened, "flr")).toBe(true);
  });

  it("unticks", () => {
    const d = setFloorApproval(setFloorApproval(simDoc(), "flr", true), "flr", false);
    expect(isFloorApproved(d, "flr")).toBe(false);
    expect(d.simApprovals).toEqual([]);
  });

  it("EDITING THE DESIGN WITHDRAWS IT — there is no surviving approval", () => {
    const ticked = setFloorApproval(simDoc(), "flr", true);
    expect(isFloorApproved(ticked, "flr")).toBe(true);
    const edited: DesignDocument = {
      ...ticked,
      objects: ticked.objects.map((o) =>
        o.id === "idu-flr"
          ? { ...o, geometry: { kind: "point" as const, at: { x: 40, y: 210 } } }
          : o
      ),
    };
    expect(isFloorApproved(edited, "flr")).toBe(false);
  });

  it("re-ticking replaces the stale row rather than stacking one per edit", () => {
    let d = setFloorApproval(simDoc(), "flr", true);
    d = { ...d, settings: { ...d.settings, sizingBasis: "cooling" } };
    d = setFloorApproval(d, "flr", true);
    expect(d.simApprovals).toHaveLength(1);
    expect(isFloorApproved(d, "flr")).toBe(true);
  });
});

describe("simApprovalState", () => {
  it("offers nothing when nothing is ticked", () => {
    const s = simApprovalState(simDoc(), pack);
    expect(s.simulatable.map((f) => f.id)).toEqual(["flr"]);
    expect(s.offered).toBe(false);
    expect(s.pending.map((f) => f.name)).toEqual(["Ground"]);
    expect(s.lapsed).toEqual([]);
  });

  it("offers the simulation once every simulatable floor is ticked", () => {
    const d = setFloorApproval(simDoc(), "flr", true);
    expect(simApprovalState(d, pack).offered).toBe(true);
  });

  it("A PART-APPROVED DESIGN OFFERS NOTHING, and names what is holding it", () => {
    /* a client cannot tell which floors they are missing, so half a
       simulation must not read as "here is the simulation" */
    const d = setFloorApproval(simDoc(["a", "b"]), "a", true);
    const s = simApprovalState(d, pack);
    expect(s.simulatable).toHaveLength(2);
    expect(s.offered).toBe(false);
    expect(s.approved.map((f) => f.id)).toEqual(["a"]);
    expect(s.pending.map((f) => f.name)).toEqual(["Level 1"]);
  });

  it("A FLOOR WITH NOTHING ON IT CANNOT BLOCK THE OPTION", () => {
    /* it can never be approved, so counting it would make the simulation
       permanently unofferable on any design with a spare floor */
    const d = simDoc(["a"]);
    d.floors = [
      ...d.floors,
      { id: "empty", name: "Attic", level: 1, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] },
    ];
    const ticked = setFloorApproval(d, "a", true);
    const s = simApprovalState(ticked, pack);
    expect(s.simulatable.map((f) => f.id)).toEqual(["a"]);
    expect(s.offered).toBe(true);
  });

  it("names a LAPSED tick apart from one that was never made", () => {
    const ticked = setFloorApproval(simDoc(["a", "b"]), "a", true);
    const edited: DesignDocument = {
      ...ticked,
      settings: { ...ticked.settings, sizingBasis: "cooling" },
    };
    const s = simApprovalState(edited, pack);
    expect(s.offered).toBe(false);
    expect(s.lapsed.map((f) => f.id)).toEqual(["a"]);
    // "b" was never ticked, so it is pending but not lapsed
    expect(s.pending.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("offers nothing when no floor can simulate at all", () => {
    const d = createDesign({ name: "Empty", mode: "blank", now: "2026-07-13T00:00:00.000Z" });
    const s = simApprovalState(d, pack);
    expect(s.simulatable).toEqual([]);
    expect(s.offered).toBe(false);
  });
});
