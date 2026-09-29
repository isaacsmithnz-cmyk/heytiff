/* A VRF in the builder (docs/studio-vrf.md, step 2): what types a system
   VRF, which outdoor it is proposed, and what the verdict says, against the
   real PUHY-P YNW-A1 rows and City Multi heads in the shipped pack. Every
   envelope figure comes from the outdoor's own row (MEES21K029): P-numbers,
   50–130%, never kW. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "../document";
import type { RoomObj } from "../loads-room";
import { allocationsOf } from "../allocations";
import { addHead, chooseOutdoor, outdoorsListing } from "../builder";
import { claimZone, newSystem, retypeSystem } from "../zones";
import { combinationWord, connectionRatio, systemFindings } from "../verdict";
import { vrfOutdoorsListing } from "../vrf";

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

/* City Multi cassettes by P-number */
const P100 = "PLFY-P100VEM-A";
const P125 = "PLFY-P125VEM-A";
const P140 = "PEFY-P140VMA-E4";

function office(): { doc: DesignDocument; systemId: string; zones: string[] } {
  const doc = createDesign({ name: "office", mode: "blank" });
  const floorId = doc.floors[0].id;
  const zones = ["a", "b", "c"].map((id, i) => {
    const x = i * 600;
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
          { x: x + 500, y: 0 },
          { x: x + 500, y: 500 },
          { x, y: 500 },
        ],
      },
      props: { name: `Zone ${i + 1}` },
    } as RoomObj as DesignObject);
    return id;
  });
  const made = newSystem(doc, pack.meta.version);
  return { doc: made.doc, systemId: made.systemId, zones };
}

const sysOf = (d: DesignDocument, id: string) => d.systems.find((s) => s.id === id)!;
const oduOf = (d: DesignDocument, id: string) => allocationsOf(sysOf(d, id)).find((a) => a.role === "odu")?.model;
const withFamily = (d: DesignDocument, id: string, family: string): DesignDocument => ({
  ...d,
  systems: d.systems.map((s) => (s.id === id ? { ...s, settings: { ...s.settings, family } } : s)),
});

describe("what makes a system a VRF", () => {
  it("City Multi heads make it a VRF and are proposed the smallest PUHY that takes them", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: P125 });
    expect(sysOf(d, t.systemId).type).toBe("vrf");
    // P225 on a P200 is 113%, inside 50–130%
    expect(oduOf(d, t.systemId)).toBe("PUHY-P200YNW-A1");
    expect(combinationWord(d, pack, sysOf(d, t.systemId))).toBe("Valid");
  });

  it("a third head past the P200's 130% moves the proposal up to the P300", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: P125 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[2], iduModel: P140 });
    // P365: P200 is 183%, P250 146%, P300 122%
    expect(oduOf(d, t.systemId)).toBe("PUHY-P300YNW-A1");
    expect(sysOf(d, t.systemId).type).toBe("vrf");
  });

  it("a VRF outdoor keeps it a VRF with two or more heads (the heads rule used to win)", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: P125 });
    d = chooseOutdoor(d, pack, "worst-of-both", t.systemId, "PUHY-P250YNW-A1");
    expect(sysOf(d, t.systemId).type).toBe("vrf");
    expect(oduOf(d, t.systemId)).toBe("PUHY-P250YNW-A1");
  });

  it("the VRF family on an empty system types it VRF; a head a branch box takes stays VRF, one none takes does not", () => {
    const t = office();
    let d = retypeSystem(withFamily(t.doc, t.systemId, "vrf"), pack, t.systemId);
    expect(sysOf(d, t.systemId).type).toBe("vrf");
    d = claimZone(d, t.systemId, t.zones[0]);
    // MSZ-AP goes on a PUMY's branch box (M-P0860 p.47)
    const onBox = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: "MSZ-AP25VGD2" });
    expect(sysOf(onBox, t.systemId).type).toBe("vrf");
    expect(oduOf(onBox, t.systemId)).toMatch(/^PUMY-/);
    // MSZ-GS is on no branch box's list
    const noBox = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: "MSZ-GS25VFD" });
    expect(sysOf(noBox, t.systemId).type).not.toBe("vrf");
  });
});

describe("the verdict on a VRF", () => {
  it("an outdoor picked too small fails on the index ratio, with the fix", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: P125 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[2], iduModel: P140 });
    d = chooseOutdoor(d, pack, "worst-of-both", t.systemId, "PUHY-P200YNW-A1");
    const red = systemFindings(d, pack, sysOf(d, t.systemId)).filter((f) => f.severity === "red");
    expect(red.map((f) => f.code)).toEqual(["ratio-over"]);
    expect(red[0].fix).toBe("Pick a bigger outdoor, or take a head out");
    expect(combinationWord(d, pack, sysOf(d, t.systemId))).toBe("Fails");
  });

  it("a split's head on a PUHY is red: it can't join a VRF", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = chooseOutdoor(d, pack, "worst-of-both", t.systemId, "PUHY-P200YNW-A1");
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: "MSZ-AP25VGD2" });
    expect(sysOf(d, t.systemId).type).toBe("vrf");
    const codes = systemFindings(d, pack, sysOf(d, t.systemId)).map((f) => f.code);
    expect(codes).toContain("not-vrf-head");
  });
});

describe("the listings keep to their own family", () => {
  it("VRF outdoors are listed smallest index first, and multi outdoors never take City Multi heads", () => {
    const heads = [P100, P125].map((m) => pack.indoor_units.find((u) => u.model === m)!);
    expect(vrfOutdoorsListing(pack, heads).map((o) => o.model).filter((m) => m.startsWith("PUHY-"))).toEqual([
      "PUHY-P200YNW-A1",
      "PUHY-P250YNW-A1",
      "PUHY-P300YNW-A1",
      "PUHY-P350YNW-A1",
      "PUHY-P400YNW-A1",
      // P225 on a P450 is 50% exactly, still in; on a P500 45% is under
      // capacity and not compatible (Isaac, 2026-09-28)
      "PUHY-P450YNW-A1",
    ]);
    // PUMY counts kW: P100 + P125 is 25.2 kW, inside 50–130% of the P200, P250 and P300
    expect(vrfOutdoorsListing(pack, heads).map((o) => o.model).filter((m) => m.startsWith("PUMY-"))).toEqual([
      "PUMY-P200YKMD2-A",
      "PUMY-P250YBMD-A",
      "PUMY-P300YBMD-A",
    ]);
    expect(outdoorsListing(pack, heads).some((o) => o.system_type === "vrf")).toBe(false);
  });
});

describe("under 50% blocks (Isaac, 2026-09-28)", () => {
  it("one small head is proposed the smallest outdoor, and the system Fails as under capacity", () => {
    const t = office();
    const d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    // a P100 (11.2 kW) takes the smallest VRF that fits: a PUMY-SP80 (9.0 kW) at 124%
    expect(oduOf(d, t.systemId)).toBe("PUMY-SP80VKMD2-A");
    expect(combinationWord(d, pack, sysOf(d, t.systemId))).toBe("Valid");
    // on a P250 it is 40%: under capacity, red, with the fix
    const big = chooseOutdoor(d, pack, "worst-of-both", t.systemId, "PUHY-P250YNW-A1");
    const red = systemFindings(big, pack, sysOf(big, t.systemId)).filter((f) => f.severity === "red");
    expect(red.map((f) => f.code)).toEqual(["ratio-under"]);
    expect(red[0].message).toBe("Not compatible: the indoor units are under capacity, 40% of PUHY-P250YNW-A1, which needs at least 50%");
    expect(red[0].fix).toBe("Add heads, or pick a smaller outdoor");
    expect(combinationWord(big, pack, sysOf(big, t.systemId))).toBe("Fails");
  });
});

describe("one ratio for a VRF", () => {
  it("the connection ratio is the book's P-number ratio, not kW", () => {
    const t = office();
    let d = addHead(t.doc, pack, { systemId: t.systemId, zoneId: t.zones[0], iduModel: P100 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[1], iduModel: P125 });
    d = addHead(d, pack, { systemId: t.systemId, zoneId: t.zones[2], iduModel: P140 });
    // P365 over P300: 122%; the kW sum (41.2 over 33.5) would say 123%
    expect(connectionRatio(pack, sysOf(d, t.systemId))?.pct).toBe(122);
  });
});
