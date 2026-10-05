import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import type { CheckItem } from "../checklist";
import type { UnitLine } from "../proposal";
import { kwOf, optionMaterials, siteFacts, styleOf } from "../option-materials";

/* Isaac, 2026-10-05: "each option should have its own materials list… you
   should not have to manually enter it in" */

const SEED = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
const shipped = (): DataPack => {
  const meta = JSON.parse(readFileSync(join(SEED, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
};
const pack = shipped();

const unit = (u: Partial<UnitLine>): UnitLine => ({ role: "indoor", room: "", capacity: "", type: "", model: "", qty: 1, system: 1, lps: null, ...u });
const knownAs = (answers: Partial<Record<CheckItem["key"], string>>): CheckItem[] =>
  Object.entries(answers).map(([key, answer]) => ({ key: key as CheckItem["key"], state: "known", answer: answer! }));

it("reads a size, a style, and what the site checklist knows", () => {
  expect(kwOf("2.5 kW")).toBe(2.5);
  expect(kwOf("6kw")).toBe(6);
  expect(kwOf("")).toBeNull();
  expect(styleOf("High wall")).toBe("wall");
  expect(styleOf("Ducted")).toBe("ducted");
  expect(
    siteFacts(knownAs({ outdoor_location: "Wall brackets", pipe_length: "About 6 m", drain_fall: "Condensate pump", power_supply: "New circuit", old_system: "Remove and dispose", pipe_reuse: "New pipes" }))
  ).toEqual({ outdoorAt: "wall", runM: 6, keepPipe: false, pump: true, newCircuit: true, replacing: true });
  /* the place first, the mount when the place doesn't say (the 2905 review) */
  const at = (answer: string) => siteFacts(knownAs({ outdoor_location: answer })).outdoorAt;
  expect(at("Garage, ducted to roof garden")).toBe("ground");
  expect(at("Side of the house, on wall brackets")).toBe("wall");
  expect(at("Rear yard, on a ground pad")).toBe("ground");
  expect(at("North side, on the roof")).toBe("roof");
  /* what's still to ask counts for nothing */
  expect(siteFacts([{ key: "outdoor_location", state: "ask", answer: "" }]).outdoorAt).toBeNull();
});

it("puts one head on its outdoor as a split pair with its whole kit", () => {
  const rows = optionMaterials(
    { name: "One split", units: [unit({ role: "outdoor", room: "Side of the house", capacity: "6 kW" }), unit({ room: "Living", capacity: "6 kW", type: "High wall" })] },
    knownAs({ outdoor_location: "Wall brackets", pipe_length: "6", drain_fall: "Gravity" }),
    pack
  );
  const names = rows.map((r) => r.name);
  expect(names[0]).toMatch(/^MSZ-.*60/);
  expect(names[1]).toMatch(/^MU.*60/);
  expect(names).toEqual(expect.arrayContaining(["Wall bracket", "Isolator", "Pipe cover", "Drain hose", "Consumables"]));
  expect(rows.find((r) => /pair coil/.test(r.name))?.qty).toBe("6 m");
  expect(names).not.toContain("Condensate pump");
});

it("puts several heads on one outdoor as a multi, by the combination table, each head its own", () => {
  const rows = optionMaterials(
    {
      name: "One multi",
      units: [
        unit({ role: "outdoor", room: "Balcony" }),
        unit({ room: "Kitchen", capacity: "6 kW", type: "High wall" }),
        unit({ room: "Bedrooms", capacity: "2.5 kW", type: "High wall", qty: 2 }),
      ],
    },
    knownAs({ drain_fall: "Condensate pump" }),
    pack
  );
  expect(rows[0]).toMatchObject({ name: "MXZ-4F71VGD", qty: "1" });
  expect(rows.filter((r) => /indoor unit/.test(r.sub)).map((r) => [r.name, r.sub])).toEqual([
    ["MSZ-AP60VGD2", "Wall-mounted indoor unit, Kitchen"],
    ["MSZ-AP25VGD2", "Wall-mounted indoor unit, Bedrooms 1"],
    ["MSZ-AP25VGD2", "Wall-mounted indoor unit, Bedrooms 2"],
  ]);
  /* a run per head is asked; the outdoor's place too */
  expect(rows.filter((r) => /pair coil/.test(r.name)).every((r) => r.qty === "Run to ask")).toBe(true);
  expect(rows.find((r) => r.name === "Outdoor mount")?.qty).toBe("Where it sits: ask");
  expect(rows.filter((r) => r.name === "Condensate pump")).toHaveLength(3);
});

it("flushes reused pipe in place of new, and takes the old system out, when the checklist says", () => {
  const rows = optionMaterials(
    { name: "Swap", units: [unit({ role: "outdoor" }), unit({ room: "Bed 1", capacity: "2.5 kW", type: "High wall" })] },
    knownAs({ pipe_reuse: "Reuse if they pass a pressure test", old_system: "Remove and dispose" }),
    pack
  );
  const names = rows.map((r) => r.name);
  expect(names).toEqual(expect.arrayContaining(["Pipe flush", "Recovery and removal"]));
  expect(names.some((n) => /pair coil/.test(n))).toBe(false);
});

it("keeps a unit the data pack doesn't hold as written, its kit asked", () => {
  const rows = optionMaterials(
    { name: "Fujitsu", units: [unit({ role: "outdoor", model: "AOTH24KBCA3" }), unit({ room: "Master", capacity: "2.5 kW", type: "Bulkhead", model: "ARTH09KSLAP" })] },
    [],
    pack
  );
  expect(rows.slice(0, 2).map((r) => r.name)).toEqual(["ARTH09KSLAP", "AOTH24KBCA3"]);
  expect(rows.find((r) => r.name === "Outdoor mount")?.qty).toBe("Where it sits: ask");
});

/* Isaac, 2026-10-05: "Anything that's a pair should come from one supplier"
   — each system's units say which system they are, so they're priced together */
it("marks each system's units as its own, and nothing else", () => {
  const rows = optionMaterials(
    {
      name: "Two splits",
      units: [
        unit({ role: "outdoor", room: "Side", capacity: "2.5 kW", system: 1 }),
        unit({ room: "Bed 1", capacity: "2.5 kW", type: "High wall", system: 1 }),
        unit({ role: "outdoor", room: "Back", capacity: "6 kW", system: 2 }),
        unit({ room: "Living", capacity: "6 kW", type: "High wall", system: 2 }),
      ],
    },
    [],
    pack
  );
  const units = rows.filter((r) => /indoor unit|outdoor unit/i.test(r.sub));
  expect(units.map((r) => r.system)).toEqual([1, 1, 2, 2]);
  expect(rows.filter((r) => !/indoor unit|outdoor unit/i.test(r.sub)).every((r) => r.system === undefined)).toBe(true);
});

/* Isaac's 2905, 2026-10-05: a PUMY-P200 and six PEFY heads got no kit */
describe("a VRF the office wrote", () => {
  const job2905 = {
    name: "Mitsubishi Electric VRF system",
    units: [
      unit({ role: "outdoor", room: "Garage", capacity: "22.4 kW", type: "Outdoor unit", model: "PUMY-P200YKMD2-A" }),
      unit({ room: "Level 1 Dining/Kitchen", capacity: "7.1 kW", type: "Bulkhead", model: "PEFY-P63VMX-A" }),
      unit({ room: "Level 2 Bedroom 2", capacity: "2.8 kW", type: "Bulkhead", model: "PEFY-P25VMX-A" }),
      unit({ room: "Level 2 Bedroom 3", capacity: "2.8 kW", type: "Bulkhead", model: "PEFY-P25VMX-A" }),
      unit({ room: "Level 2 Bedroom 4", capacity: "2.8 kW", type: "Bulkhead", model: "PEFY-P25VMX-A" }),
      unit({ room: "Level 3 Bedroom 1", capacity: "3.6 kW", type: "Bulkhead", model: "PEFY-P32VMX" }),
      unit({ room: "Level 3 Study", capacity: "2.2 kW", type: "Bulkhead", model: "PEFY-P20VMX-A" }),
    ],
  };

  it("sizes it on Studio's VRF tree, its units named by the pack so their confirmed codes price them", () => {
    const rows = optionMaterials(job2905, knownAs({ outdoor_location: "Garage, ducted to roof garden" }), pack);
    expect(rows[0]).toMatchObject({ name: "PUMY-P200YKMD2-A", sub: "VRF outdoor unit, 6 heads", system: 1 });
    const heads = rows.filter((r) => /indoor unit/.test(r.sub));
    /* the office's -A matched to the pack's -E by the model's body */
    expect(heads.map((r) => r.name)).toEqual(["PEFY-P63VMX-E", "PEFY-P25VMX-E", "PEFY-P25VMX-E", "PEFY-P25VMX-E", "PEFY-P32VMX-E", "PEFY-P20VMX-E"]);
    expect(heads.every((r) => r.system === 1)).toBe(true);
    /* the garage is ground, not the roof the ducts reach */
    expect(rows.find((r) => r.name === "Ground mount")).toBeTruthy();
    expect(rows.some((r) => r.name === "Roof stand")).toBe(false);
    /* joints and the pipe at its sizes, nothing called a multi */
    expect(rows.some((r) => /joint|header|branch box/i.test(r.sub) || /^CMY-/.test(r.name))).toBe(true);
    expect(rows.some((r) => /pair coil|copper/.test(r.name))).toBe(true);
    expect(rows.some((r) => /multi/i.test(r.sub))).toBe(false);
  });

  it("says why when a head isn't in the data pack", () => {
    const rows = optionMaterials(
      { name: "VRF", units: [job2905.units[0]!, unit({ room: "Hall", capacity: "", type: "Bulkhead", model: "" })] },
      [],
      pack
    );
    expect(rows[0]!.sub).toMatch(/^VRF outdoor unit, no VRF head in the data pack this outdoor takes for Hall/);
    /* the kit stays asked, so the price is a total so far */
    expect(rows.at(-1)).toMatchObject({ name: "VRF pipe, joints and kit", qty: "Size to ask" });
  });

  it("takes reused pipe as all of it, the copper main too", () => {
    const rows = optionMaterials(job2905, knownAs({ pipe_reuse: "Reuse if they pass a pressure test" }), pack);
    expect(rows.some((r) => /pair coil|copper/.test(r.name))).toBe(false);
    expect(rows.some((r) => r.name === "Pipe flush")).toBe(true);
  });

  it("puts only heads a PUHY takes on it, City Multi before branch-box heads", () => {
    const rows = optionMaterials(
      {
        name: "PUHY",
        units: [
          unit({ role: "outdoor", model: "PUHY-P200YNW-A1" }),
          unit({ room: "Living", capacity: "7.1 kW", type: "Ducted" }),
          unit({ room: "Bed 1", capacity: "2.8 kW", type: "Ducted" }),
        ],
      },
      [],
      pack
    );
    const heads = rows.filter((r) => /indoor unit/.test(r.sub)).map((r) => r.name);
    expect(heads.every((m) => /^P.FY-/.test(m))).toBe(true);
    expect(heads.some((m) => /^(PEAD|MSZ|SEZ)/.test(m))).toBe(false);
  });

  it("never sizes a written outdoor the pack doesn't hold as a VRF as another unit", () => {
    const rows = optionMaterials(
      { name: "x", units: [unit({ role: "outdoor", model: "PUMY-XX999" }), job2905.units[1]!, job2905.units[2]!] },
      [],
      pack
    );
    expect(rows[0]).toMatchObject({ name: "PUMY-XX999", sub: "VRF outdoor unit, PUMY-XX999 isn't a VRF outdoor in the data pack" });
  });
});
