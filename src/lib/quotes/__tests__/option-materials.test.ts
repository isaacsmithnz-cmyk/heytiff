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
