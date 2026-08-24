/* Multi-split Stage 5 — lib slice: dev flag, derived IDU capability, per-room
   IDU + shared-ODU proposers, compatibility rule blocks, the connection
   derivation, and the coverage/components integration. Runs against the real
   shipped Mitsubishi pack (7 MXZ outdoors + multi_rules) so data drift fails
   here. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import {
  createDesign,
  newId,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "../document";
import { type RoomObj } from "../loads-room";
import { roomCoverage } from "../coverage";
import { systemComponents } from "../components";
import {
  multiIduSelections,
  multiCapableIdus,
  proposeMultiIdus,
  proposeMultiOdus,
  checkMultiCompatibility,
  multiConnection,
  MULTI_OVERSIZE_CAP,
} from "../multi";

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
const basis = "worst-of-both" as const;

/* ── fixtures — two 12 m² rooms (400×300 units @ 10 mm/unit) → 1.74 kW each ── */

function docWithRooms(roomCount = 2): {
  doc: DesignDocument;
  system: DesignSystem;
  rooms: RoomObj[];
} {
  const doc = createDesign({ name: "t", mode: "blank" }); // one floor @ 10 mm/unit
  const floorId = doc.floors[0].id;
  const system: DesignSystem = {
    id: newId("sys"),
    type: "multi-split",
    brand: "mitsubishi-electric",
    colour: "#2E68FF",
    name: "System 1",
    settings: {},
  };
  doc.systems.push(system);
  const rooms: RoomObj[] = [];
  for (let i = 0; i < roomCount; i++) {
    rooms.push({
      id: `room${i + 1}`,
      type: "room",
      systemId: system.id,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
          { x: 0, y: 300 },
        ],
      },
      props: { name: `Room ${i + 1}` },
    });
  }
  doc.objects.push(...rooms);
  return { doc, system, rooms };
}

const placedUnit = (
  id: string,
  systemId: string,
  floorId: string,
  role: "idu" | "odu",
  model: string,
  roomId?: string
): DesignObject => ({
  id,
  type: "unit",
  systemId,
  floorId,
  plane: role === "odu" ? "external-ground" : "room",
  geometry: { kind: "point", at: { x: 10, y: 10 } },
  props: { role, model, ...(roomId ? { roomId } : {}) },
});

/* ── the dev flag ── */

describe("multi-split dev flag", () => {
  const OLD = process.env.NEXT_PUBLIC_STUDIO_MULTI;
  afterEach(() => {
    process.env.NEXT_PUBLIC_STUDIO_MULTI = OLD;
  });

  it("keeps multi-split unavailable without the flag", () => {
    delete process.env.NEXT_PUBLIC_STUDIO_MULTI;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mods = require("../modules");
      expect(mods.SYSTEM_MODULES["multi-split"].available).toBe(false);
      expect(
        mods.availableModules().map((m: { type: string }) => m.type)
      ).not.toContain("multi-split");
    });
  });

  it("enables multi-split with NEXT_PUBLIC_STUDIO_MULTI=1", () => {
    process.env.NEXT_PUBLIC_STUDIO_MULTI = "1";
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mods = require("../modules");
      expect(mods.SYSTEM_MODULES["multi-split"].available).toBe(true);
      expect(mods.availableModules().map((m: { type: string }) => m.type)).toContain(
        "multi-split"
      );
    });
  });
});

/* ── settings reader ── */

describe("multiIduSelections", () => {
  const sys = (settings: Record<string, unknown>): DesignSystem => ({
    id: "s1",
    type: "multi-split",
    brand: "b",
    colour: "#000",
    name: "S",
    settings,
  });

  it("reads roomId → model and drops junk entries", () => {
    expect(
      multiIduSelections(sys({ multiIdus: { r1: "MSZ-AP20VGD", r2: 7, r3: "" } }))
    ).toEqual({ r1: "MSZ-AP20VGD" });
  });

  it("tolerates missing / malformed shapes", () => {
    expect(multiIduSelections(sys({}))).toEqual({});
    expect(multiIduSelections(sys({ multiIdus: "nope" }))).toEqual({});
    expect(multiIduSelections(sys({ multiIdus: ["a"] }))).toEqual({});
  });
});

/* ── derived IDU capability ── */

describe("multiCapableIdus", () => {
  const capable = multiCapableIdus(pack);
  const models = capable.map((u) => u.model);

  it("derives capability from both rule shapes (31 whitelisted + 103 index-band)", () => {
    // MXZ rules whitelist families; the PUMY-SP/P rules use index_ratio_band,
    // which admits any indoor carrying a capacity_index inside the band — i.e.
    // the whole City Multi P*FY range, which is what those outdoors connect.
    expect(capable).toHaveLength(134);
    expect(models).toContain("MSZ-AP20VGD");
    expect(models).toContain("PEAD-M50JAA(D)"); // a ducted IDU among the hi-walls
    expect(models).toContain("PEFY-P40VMHS-E"); // City Multi, via a PUMY index band
  });

  it("excludes family models over every rule's per-port limit", () => {
    // PEAD-M100 is 10 kW — the biggest per-port allowance is 7.8 kW (6F120)
    expect(models).not.toContain("PEAD-M100JAA(D)");
    expect(models).not.toContain("PEAD-M125JAA(D)");
  });

  it("admits nothing a rule doesn't actually reach", () => {
    // every capable unit is authorised by one of the two mechanisms: an MXZ
    // family prefix, or a capacity_index inside some rule's index band
    const families = ["MSZ-LN", "MSZ-EF", "MSZ-AP", "MFXZ-KW", "MLZ-KP", "SLZ-M", "SEZ-M", "PEAD-M"];
    const bands = pack.multi_rules
      .flatMap((r) => r.compatibility)
      .filter((c) => c.method === "index_ratio_band");
    for (const u of capable) {
      const byFamily = families.some((f) => u.model.startsWith(f));
      const byIndex =
        u.capacity_index != null &&
        bands.some(
          (b) =>
            u.capacity_index! >= (b.index_min ?? 0) &&
            u.capacity_index! <= (b.index_max ?? Infinity)
        );
      expect(byFamily || byIndex).toBe(true);
    }
  });
});

/* ── per-room IDU proposals ── */

describe("proposeMultiIdus", () => {
  it("1.74 kW room: the whole capable catalogue, labelled, smallest fit best", () => {
    const props = proposeMultiIdus(pack, 1.74, basis);
    // a load never shortens the list — it only labels it
    expect(props).toHaveLength(134);
    for (const p of props) {
      if (p.fit === "fits") {
        expect(p.capacityKw).toBeGreaterThanOrEqual(1.74);
        expect(p.capacityKw).toBeLessThanOrEqual(1.74 * MULTI_OVERSIZE_CAP);
      } else if (p.fit === "oversized") {
        expect(p.capacityKw).toBeGreaterThan(1.74 * MULTI_OVERSIZE_CAP);
      } else {
        expect(p.capacityKw).toBeLessThan(1.74);
      }
    }
    const rec = props.filter((p) => p.bestFit);
    expect(rec).toHaveLength(1);
    expect(rec[0].idu.model).toBe("MSZ-AP20VGD"); // 2.0 kW worst-of-both
    expect(rec[0].fit).toBe("fits");
  });

  it("oversized units are offered, not hidden", () => {
    const props = proposeMultiIdus(pack, 1.74, basis);
    expect(props.some((p) => p.fit === "oversized")).toBe(true);
    expect(props.some((p) => p.fit === "undersized")).toBe(true);
  });

  it("a load nothing can cover leaves every row undersized and no best fit", () => {
    const props = proposeMultiIdus(pack, 999, basis);
    expect(props).toHaveLength(134);
    expect(props.every((p) => p.fit === "undersized")).toBe(true);
    expect(props.some((p) => p.bestFit)).toBe(false);
  });

  it("null load = the full capable catalogue, nothing flagged", () => {
    const props = proposeMultiIdus(pack, null, basis);
    expect(props).toHaveLength(134);
    expect(props.some((p) => p.bestFit)).toBe(false);
    expect(props.every((p) => p.fit === "fits")).toBe(true);
  });
});

/* ── compatibility rule blocks ── */

describe("checkMultiCompatibility", () => {
  const odu = (model: string) => pack.outdoor_units.find((o) => o.model === model)!;
  const rule = (model: string) => pack.multi_rules.find((r) => r.odu_model_ref === model)!;
  const idu = (model: string) => pack.indoor_units.find((u) => u.model === model)!;

  it("passes a clean whitelisted set", () => {
    const f = checkMultiCompatibility(rule("MXZ-2F52VGD"), odu("MXZ-2F52VGD"), [
      idu("MSZ-AP20VGD"),
      idu("MSZ-AP25VGD2"),
    ]);
    expect(f).toHaveLength(0);
  });

  it("flags a model outside the whitelist red", () => {
    const outsider = pack.indoor_units.find(
      (u) =>
        !["MSZ-LN", "MSZ-EF", "MSZ-AP", "MFXZ-KW", "MLZ-KP", "SLZ-M", "SEZ-M", "PEAD-M"].some(
          (fam) => u.model.startsWith(fam)
        )
    )!;
    const f = checkMultiCompatibility(rule("MXZ-2F52VGD"), odu("MXZ-2F52VGD"), [outsider]);
    expect(f.some((x) => x.code === "not-in-whitelist" && x.severity === "red")).toBe(true);
  });

  it("flags a per-port breach red (10 kW PEAD on a 5 kW port)", () => {
    const f = checkMultiCompatibility(rule("MXZ-3F54VGD"), odu("MXZ-3F54VGD"), [
      idu("PEAD-M100JAA(D)"),
    ]);
    expect(f.some((x) => x.code === "over-per-port" && x.severity === "red")).toBe(true);
  });

  it("flags too many units red (count + ports)", () => {
    const three = [idu("MSZ-AP20VGD"), idu("MSZ-AP25VGD2"), idu("MSZ-EF25VGW")];
    const f = checkMultiCompatibility(rule("MXZ-2F52VGD"), odu("MXZ-2F52VGD"), three);
    expect(f.some((x) => x.code === "over-max-count")).toBe(true);
    expect(f.some((x) => x.code === "over-ports")).toBe(true);
  });
});

/* ── shared-outdoor proposals ── */

describe("proposeMultiOdus", () => {
  const idu = (model: string) => pack.indoor_units.find((u) => u.model === model)!;
  const twoSmall = [idu("MSZ-AP20VGD"), idu("MSZ-AP20VGD")];

  it("offers every multi-ready outdoor, fitting units first, smallest first", () => {
    // 7 MXZ + 11 PUMY-SP/P — the PUMY rules carry a `ports` count, without
    // which proposeMultiOdus drops an outdoor from the picker silently
    const props = proposeMultiOdus(pack, twoSmall, basis, { requiredKw: 3.48 });
    expect(props).toHaveLength(18);
    expect(props.every((p) => p.fits)).toBe(true);
    // smallest clean fit covering 3.48 kW → the 5.2 kW 2-port
    const rec = props.filter((p) => p.recommended);
    expect(rec).toHaveLength(1);
    expect(rec[0].odu.model).toBe("MXZ-2F52VF");
  });

  it("three units rule out the 2-ports and move the suggestion up", () => {
    const three = [...twoSmall, idu("MSZ-EF25VGW")];
    const props = proposeMultiOdus(pack, three, basis, { requiredKw: 5.22 });
    const twoPort = props.filter((p) => p.ports === 2);
    expect(twoPort.length).toBe(2);
    expect(twoPort.every((p) => !p.fits)).toBe(true);
    expect(props.find((p) => p.recommended)!.odu.model).toBe("MXZ-3F54VGD");
  });

  it("the required capacity drives the recommendation upward", () => {
    const props = proposeMultiOdus(pack, twoSmall, basis, { requiredKw: 8.0 });
    expect(props.find((p) => p.recommended)!.odu.model).toBe("MXZ-4F80VGD");
  });
});

/* ── the connection derivation ── */

describe("multiConnection", () => {
  it("derives picks, connected capacity, ports and combination from settings", () => {
    const { doc, system, rooms } = docWithRooms();
    system.settings = {
      pairOdu: "MXZ-2F52VGD",
      multiIdus: { [rooms[0].id]: "MSZ-AP20VGD", [rooms[1].id]: "MSZ-AP20VGD" },
    };
    const conn = multiConnection(doc, pack, system, basis);
    expect(conn.iduCount).toBe(2);
    expect(conn.connectedKw).toBeCloseTo(4.0, 5);
    expect(conn.requiredKw).toBeCloseTo(3.48, 2);
    expect(conn.odu?.model).toBe("MXZ-2F52VGD");
    expect(conn.oduKw).toBeCloseTo(5.2, 5);
    expect(conn.ports).toBe(2);
    expect(conn.portsUsed).toBe(2);
    expect(Math.round(conn.comboPct!)).toBe(77);
    expect(conn.findings).toHaveLength(0);
  });

  it("a placed unit wins over the stored selection", () => {
    const { doc, system, rooms } = docWithRooms();
    system.settings = { multiIdus: { [rooms[0].id]: "MSZ-AP20VGD" } };
    doc.objects.push(
      placedUnit("u1", system.id, doc.floors[0].id, "idu", "MSZ-AP25VGD2", rooms[0].id)
    );
    const conn = multiConnection(doc, pack, system, basis);
    expect(conn.rooms[0].model).toBe("MSZ-AP25VGD2");
    expect(conn.rooms[0].placed).toBe(true);
    expect(conn.connectedKw).toBeCloseTo(2.5, 5);
  });

  it("over-connection surfaces the port finding", () => {
    const { doc, system, rooms } = docWithRooms(3);
    system.settings = {
      pairOdu: "MXZ-2F52VGD",
      multiIdus: Object.fromEntries(rooms.map((r) => [r.id, "MSZ-AP20VGD"])),
    };
    const conn = multiConnection(doc, pack, system, basis);
    expect(conn.portsUsed).toBe(3);
    expect(conn.findings.some((f) => f.code === "over-ports")).toBe(true);
    expect(conn.findings.some((f) => f.code === "over-max-count")).toBe(true);
  });

  it("degrades honestly: no loads on an uncalibrated floor, no pack rows invented", () => {
    const { doc, system, rooms } = docWithRooms();
    doc.floors[0].scaleMmPerUnit = null;
    system.settings = { multiIdus: { [rooms[0].id]: "NOT-IN-PACK" } };
    const conn = multiConnection(doc, pack, system, basis);
    expect(conn.requiredKw).toBeNull();
    expect(conn.unknownRooms).toBe(2);
    expect(conn.iduCount).toBe(1);
    expect(conn.connectedKw).toBeNull(); // unknown model resolves no capacity
    expect(conn.rooms[0].kw).toBeNull();
  });
});

/* ── coverage integration (per-room worth + pending) ── */

describe("multi coverage", () => {
  it("a placed IDU covers its room at its OWN capacity, not a pair rating", () => {
    const { doc, system, rooms } = docWithRooms();
    doc.objects.push(
      placedUnit("u1", system.id, doc.floors[0].id, "idu", "MSZ-AP20VGD", rooms[0].id)
    );
    const cov = roomCoverage(doc, pack, rooms[0], basis);
    expect(cov.coveredKw).toBeCloseTo(2.0, 5); // MSZ-AP20VGD worst-of-both
    expect(cov.status).toBe("covered"); // 2.0 ≥ 1.74
    expect(cov.contributors).toHaveLength(1);
    expect(cov.contributors[0].model).toBe("MSZ-AP20VGD");
  });

  it("a chosen-but-unplaced room selection shows as pending", () => {
    const { doc, system, rooms } = docWithRooms();
    system.settings = { multiIdus: { [rooms[0].id]: "MSZ-AP20VGD" } };
    const cov = roomCoverage(doc, pack, rooms[0], basis);
    expect(cov.coveredKw).toBe(0);
    expect(cov.pendingKw).toBeCloseTo(2.0, 5);
    expect(cov.status).toBe("under");
    // the OTHER room has no selection → nothing pending there
    expect(roomCoverage(doc, pack, rooms[1], basis).pendingKw).toBe(0);
  });

  it("placing the room's unit moves it from pending to covered", () => {
    const { doc, system, rooms } = docWithRooms();
    system.settings = { multiIdus: { [rooms[0].id]: "MSZ-AP20VGD" } };
    doc.objects.push(
      placedUnit("u1", system.id, doc.floors[0].id, "idu", "MSZ-AP20VGD", rooms[0].id)
    );
    const cov = roomCoverage(doc, pack, rooms[0], basis);
    expect(cov.pendingKw).toBe(0);
    expect(cov.coveredKw).toBeCloseTo(2.0, 5);
  });
});

/* ── components integration (shared outdoor, no pairing) ── */

describe("multi systemComponents", () => {
  it("resolves ODU + charge + choice rows from the shared outdoor alone", () => {
    const { doc, system } = docWithRooms();
    system.settings = { pairOdu: "MXZ-2F52VGD" };
    const rows = systemComponents(doc, pack, system, basis);
    expect(rows.map((r) => r.kind)).toEqual(["odu", "charge", "choice", "choice", "choice"]);
    expect(rows[0].name).toBe("MXZ-2F52VGD");
    expect(rows[0].value).toBe("5.2 kW"); // the outdoor's own worst-of-both rating
    // factory pre-charge (2.4 kg) with no run drawn → no top-up
    expect(rows[1].value).toBe("2.40 kg");
  });

  it("stays empty until an outdoor resolves", () => {
    const { doc, system } = docWithRooms();
    expect(systemComponents(doc, pack, system, basis)).toHaveLength(0);
  });
});
