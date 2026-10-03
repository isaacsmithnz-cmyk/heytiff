import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { vrfLines } from "../vrf-template";
import type { PriceOf } from "../ducted-template";

/* #1352 (Isaac, 2026-10-04): a PUMY-SP125, a branch box, five AP heads —
   priced from the shared data pack and ONE business's own price book and
   chosen kit. The book and kit here are a made-up business's: nothing of
   Diamond Air's is in the template. */

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

/* a made-up business's book, in its own codes */
const BOOK: Record<string, [string, number]> = {
  "PUMY-SP125VKMD2-A": ["Outdoor 14 kW", 300000],
  "MSZ-AP71VGKD2-A2": ["Head 7.1", 42000],
  "MSZ-AP35VGKD2-A2": ["Head 3.5", 29000],
  "MSZ-AP25VGKD2-A2": ["Head 2.5", 29000],
  "PAC-MK54BC": ["Branch box 5", 72000],
  "XC-38-58": ["Coil 3/8 5/8 20M", 30000],
  "XC-14-38": ["Coil 1/4 3/8 20M", 16000],
  "XC-14-12": ["Coil 1/4 1/2 20M", 19000],
  "XISO": ["Isolator 35A", 2000],
  "XPUMP": ["Condensate pump", 19000],
};
const priceOf: PriceOf = (code) => (BOOK[code] ? { supplierKey: "acme", name: BOOK[code][0], buyCents: BOOK[code][1] } : null);
const kit = {
  pair_coil_38_58: { supplierKey: "acme", code: "XC-38-58", rollM: 20 },
  pair_coil_14_38: { supplierKey: "acme", code: "XC-14-38", rollM: 20 },
  pair_coil_14_12: { supplierKey: "acme", code: "XC-14-12", rollM: 20 },
  isolator: { supplierKey: "acme", code: "XISO", rollM: null },
  condensate_pump: { supplierKey: "acme", code: "XPUMP", rollM: null },
};
const job1352 = {
  outdoor: "PUMY-SP125VKMD2-A",
  heads: [
    { model: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", pump: true },
    { model: "MSZ-AP35VGD2", code: "MSZ-AP35VGKD2-A2", pump: true },
    { model: "MSZ-AP25VGD2", code: "MSZ-AP25VGKD2-A2", pump: true },
    { model: "MSZ-AP25VGD2", code: "MSZ-AP25VGKD2-A2" },
    { model: "MSZ-AP25VGD2", code: "MSZ-AP25VGKD2-A2" },
  ],
  lengths: { main: 15, perHead: 8 },
};

describe("a PUMY on a branch box, from the data pack and the business's own book", () => {
  it("prices #1352: the outdoor, five heads, one 5-port box, the main line and a run to each head", () => {
    const r = vrfLines(pack, job1352, priceOf, kit);
    expect(r.missing).toEqual([]);
    expect(r.findings).toEqual([]);
    const codes = r.lines.map((l) => [l.code, l.qty]);
    expect(codes).toEqual(
      expect.arrayContaining([
        ["PUMY-SP125VKMD2-A", 1],
        ["PAC-MK54BC", 1],
        ["XC-38-58", 15],
        ["XISO", 1],
      ])
    );
    expect(r.lines.filter((l) => l.code === "XPUMP")).toHaveLength(3);
    expect(r.lines.filter((l) => l.key.startsWith("head-"))).toHaveLength(5);
    /* the main line is the outdoor's own size, per metre off the business's roll */
    const main = r.lines.find((l) => l.name.includes("main line"))!;
    expect(main).toMatchObject({ code: "XC-38-58", qty: 15, unitBuyCents: 1500 });
    /* five runs box to head, 8 m each */
    expect(r.lines.filter((l) => l.name.includes("box to a head")).every((l) => l.qty === 8)).toBe(true);
    expect(r.lines.filter((l) => l.name.includes("box to a head"))).toHaveLength(5);
  });

  it("carries no labour and no allowance of anyone's", () => {
    const r = vrfLines(pack, job1352, priceOf, kit);
    expect(r.lines.every((l) => l.code !== null)).toBe(true);
    expect(r.lines.some((l) => /labour|consumable/i.test(l.name))).toBe(false);
  });

  it("says what the business hasn't chosen, and what the job didn't give, instead of filling it in", () => {
    const r = vrfLines(pack, { ...job1352, lengths: {}, mount: "wall" }, priceOf, { pair_coil_14_38: kit.pair_coil_14_38 });
    expect(r.missing).toEqual(
      expect.arrayContaining([
        "Pipe length not known: 3/8 + 5/8, outdoor to the first fitting",
        "Choose your isolator in Quoting",
        "Choose your outdoor unit wall bracket in Quoting",
        "Choose your condensate pump in Quoting",
      ])
    );
    expect(r.lines.some((l) => l.key.startsWith("pipe-"))).toBe(false);
  });

  it("an outdoor or head the pack doesn't have is said", () => {
    expect(vrfLines(pack, { outdoor: "PUMY-NOPE", heads: [] }, priceOf, kit).missing).toEqual(["PUMY-NOPE isn't in the data pack"]);
  });
});

describe("a City Multi VRF on joints, the same way (#279)", () => {
  const book279: PriceOf = (code) => {
    const known: Record<string, number> = {
      "PUHY-P400YNW-A1": 960000,
      "PEFY-P32VMX-E": 87000,
      "PEFY-P50VMX-E": 95000,
      "PEFY-P63VMX-E": 100000,
      "PEFY-P140VMHS-E": 134000,
    };
    if (code.startsWith("CMY-")) return { supplierKey: "acme", name: `Joint ${code}`, buyCents: 9000 };
    return known[code] != null ? { supplierKey: "acme", name: code, buyCents: known[code] } : null;
  };
  const heads = [
    ...Array(5).fill({ model: "PEFY-P32VMX-E" }),
    { model: "PEFY-P50VMX-E" },
    { model: "PEFY-P63VMX-E" },
    { model: "PEFY-P140VMHS-E" },
  ];

  it("takes its joints from the book, and says which pipe is bought as straight lengths", () => {
    const r = vrfLines(pack, { outdoor: "PUHY-P400YNW-A1", heads, lengths: { main: 20, perHead: 10 } }, book279, kit);
    expect(r.findings).toEqual([]);
    expect(r.lines.filter((l) => l.code?.startsWith("CMY-")).length).toBeGreaterThan(0);
    expect(r.lines.some((l) => l.code === "PAC-MK54BC")).toBe(false);
    expect(r.missing.some((m) => m.endsWith("bought as straight lengths"))).toBe(true);
  });
});
