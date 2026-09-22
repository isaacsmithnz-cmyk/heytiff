/* Zones and systems, as jobs (the 2026-09-18 flow).

   A zone is drawn on the plan and belongs to it. A system claims zones by
   being clicked over them, before any unit exists. Two systems may claim one
   zone — a 14 kW living area on two splits. What a system IS comes from the
   units in it, never from a type chosen up front. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import { roomsServedBy } from "../coverage";
import { addSplit, addMultiHead, allocationsOf, placeAllocation, removeZone } from "../builder";
import {
  KIND_WORD,
  claimZone,
  familyOf,
  newSystem,
  retypeSystem,
  systemKind,
  systemZones,
  systemsForZone,
  toggleZone,
  unclaimedZones,
  zoneIdsOf,
} from "../zones";

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

/** a plan with four zones and no systems */
function plan(): DesignDocument {
  const doc = createDesign({ name: "plan", mode: "blank" });
  const floorId = doc.floors[0].id;
  const zone = (id: string, name: string, x: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y: 0 },
          { x: x + w, y: 0 },
          { x: x + w, y: h },
          { x, y: h },
        ],
      },
      props: { name },
    } as DesignObject);
  zone("living", "Living", 0, 1000, 960);
  zone("master", "Master", 1100, 550, 500);
  zone("bed2", "Bed 2", 1700, 400, 300);
  zone("study", "Study", 2200, 400, 320);
  return doc;
}

describe("a zone belongs to the plan until a system claims it", () => {
  it("is unclaimed until clicked, and served the moment it is", () => {
    const doc = plan();
    expect(unclaimedZones(doc).map((z) => z.id)).toEqual(["living", "master", "bed2", "study"]);

    const made = newSystem(doc, pack.meta.version);
    // a new system has no zones and no units: nothing has been decided yet
    expect(zoneIdsOf(made.doc.systems[0])).toEqual([]);
    expect(systemKind(made.doc, made.doc.systems[0])).toBe("empty");
    expect(KIND_WORD.empty).toBe("No units yet");

    let d = claimZone(made.doc, made.systemId, "master");
    d = claimZone(d, made.systemId, "bed2");
    expect(systemZones(d, made.systemId).map((z) => z.id)).toEqual(["master", "bed2"]);
    expect(unclaimedZones(d).map((z) => z.id)).toEqual(["living", "study"]);
    // the engines that ask which rooms a system serves see them at once
    expect(roomsServedBy(d, made.systemId).map((r) => r.id)).toEqual(["master", "bed2"]);
    // clicking a claimed zone again gives it back
    expect(zoneIdsOf(toggleZone(d, made.systemId, "bed2").systems[0])).toEqual(["master"]);
  });

  it("lets two systems claim one zone — a 14 kW living area on two splits", () => {
    const a = newSystem(plan(), pack.meta.version);
    const b = newSystem(claimZone(a.doc, a.systemId, "living"), pack.meta.version);
    const d = claimZone(b.doc, b.systemId, "living");
    expect(systemsForZone(d, "living").map((s) => s.id)).toEqual([a.systemId, b.systemId]);
    expect(unclaimedZones(d).some((z) => z.id === "living")).toBe(false);
    // and they are different systems on the plan: different colours
    expect(d.systems[0].colour).not.toBe(d.systems[1].colour);
  });

  it("takes the system's units in that zone with it when the zone is given back", () => {
    const made = newSystem(plan(), pack.meta.version);
    let d = claimZone(made.doc, made.systemId, "master");
    d = claimZone(d, made.systemId, "bed2");
    let r = addMultiHead(d, pack, basis, {
      systemId: made.systemId,
      roomId: "master",
      iduModel: "MSZ-AP35VGD2",
    });
    r = addMultiHead(r.doc, pack, basis, {
      systemId: made.systemId,
      roomId: "bed2",
      iduModel: "MSZ-AP20VGD",
    });
    const head = allocationsOf(r.doc.systems[0]).find((x) => x.roomId === "bed2")!;
    const placed = placeAllocation(r.doc, pack, made.systemId, head.id, r.doc.floors[0].id, {
      x: 1750,
      y: 100,
    });
    expect(placed.objects.some((o) => o.id === head.id)).toBe(true);

    const back = removeZone(placed, pack, made.systemId, "bed2");
    expect(zoneIdsOf(back.systems[0])).toEqual(["master"]);
    expect(allocationsOf(back.systems[0]).map((x) => x.roomId)).toEqual(["master", null]);
    // the unit it had there is off the plan too, and the system stays
    expect(back.objects.some((o) => o.id === head.id)).toBe(false);
    expect(back.systems).toHaveLength(1);
    expect(unclaimedZones(back).map((z) => z.id)).toContain("bed2");
  });
});

describe("what a system is comes from its units", () => {
  it("reads one head as a split, two as a multi, and writes the type behind them", () => {
    const made = newSystem(plan(), pack.meta.version);
    let d = claimZone(made.doc, made.systemId, "master");
    d = claimZone(d, made.systemId, "bed2");

    // two zones claimed: the family the trail starts on is multi, but the units say
    expect(familyOf(d.systems[0])).toBe("multi");
    const one = addSplit(d, pack, {
      systemId: made.systemId,
      roomId: "master",
      iduModel: "MSZ-AP35VGD2",
      oduModel: "MUZ-AP35VG2",
    });
    expect(one.systemId).toBe(made.systemId);
    expect(one.doc.systems).toHaveLength(1);
    expect(systemKind(one.doc, one.doc.systems[0])).toBe("split");
    expect(retypeSystem(one.doc, pack, made.systemId).systems[0].type).toBe("split");
    // the claimed zones are still the rooms it serves
    expect(one.doc.systems[0].settings.roomIds).toEqual(["master", "bed2"]);

    const two = addMultiHead(one.doc, pack, basis, {
      systemId: made.systemId,
      roomId: "bed2",
      iduModel: "MSZ-AP20VGD",
    });
    expect(systemKind(two.doc, two.doc.systems[0])).toBe("multi");
    expect(retypeSystem(two.doc, pack, made.systemId).systems[0].type).toBe("multi-split");
  });

  it("reads an indoor unit that serves the whole system as ducted", () => {
    const made = newSystem(plan(), pack.meta.version);
    let d = claimZone(made.doc, made.systemId, "master");
    d = claimZone(d, made.systemId, "bed2");
    d = {
      ...d,
      systems: d.systems.map((s) =>
        s.id === made.systemId
          ? {
              ...s,
              settings: {
                ...s.settings,
                allocations: [
                  { id: "ahu", role: "idu", model: "PEAD-M71JAA(D)", roomId: null, serves: "system" },
                  { id: "odu", role: "odu", model: "PUZ-M71VKA2-A", roomId: null },
                ],
              },
            }
          : s
      ),
    };
    expect(systemKind(d, d.systems[0])).toBe("ducted");
    expect(retypeSystem(d, pack, made.systemId).systems[0].type).toBe("ducted");
    // and it still serves both zones it claimed
    expect(roomsServedBy(d, made.systemId).map((r) => r.id)).toEqual(["master", "bed2"]);
  });
});
