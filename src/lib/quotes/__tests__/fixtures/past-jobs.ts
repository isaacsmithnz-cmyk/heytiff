import type { DuctedFacts } from "../../ducted-template";
import type { SplitFacts } from "../../split-template";

/* REAL JOBS THE QUOTE BUILDER IS HELD TO — Diamond Air's own quotes, read
   off their ServiceM8 lines (ex GST, before any discount; extras like a
   scissor lift or a PCB repair left out). Job numbers only: no client, no
   address.

   "now" jobs were quoted at today's $1,320 labour day, so their prices are
   compared; "old" ones (a $1,000 day, older unit costs) are held to their
   person-days only. */

export type Quoted = {
  /** what the units cost, where ServiceM8 kept it */
  unitsCostCents?: number;
  unitsCents?: number;
  materialsCents?: number;
  personDays: number;
  labourCents?: number;
  /** a lump-sum quote: units + materials + labour together */
  totalCents?: number;
};

export type PastJob =
  | { job: string; month: string; era: "now" | "old"; kind: "split"; facts: SplitFacts; quoted: Quoted; note?: string }
  | { job: string; month: string; era: "now" | "old"; kind: "ducted"; facts: DuctedFacts; quoted: Quoted; note?: string };

const AP: Record<number, [string, string, SplitFacts["pipe"]]> = {
  2.5: ["MSZ-AP25VGKD2-A2", "MUZ-AP25VGD2-A2", "1/4+3/8"],
  3.5: ["MSZ-AP35VGKD2-A2", "MUZ-AP35VGD2-A2", "1/4+3/8"],
  4.2: ["MSZ-AP42VGKD2-A2", "MUZ-AP42VGD2-A2", "1/4+3/8"],
  4.8: ["MSZ-AP50VGKD2-A2", "MUZ-AP50VGD2-A2", "1/4+1/2"],
  6: ["MSZ-AP60VGKD2-A2", "MUZ-AP60VGD2-A2", "1/4+1/2"],
  7.1: ["MSZ-AP71VGKD2-A2", "MUZ-AP71VGD2-A2", "1/4+1/2"],
};
const wallSplit = (kw: number): SplitFacts => ({ indoor: AP[kw]![0], outdoor: AP[kw]![1], kw, pipe: AP[kw]![2] });

const c = (dollars: number) => Math.round(dollars * 100);
const split = (
  job: string,
  month: string,
  kw: number,
  personDays: number,
  q: { cost?: number; units?: number; materials?: number; labour?: number } = {},
  note?: string,
  more: Partial<SplitFacts> = {}
): PastJob => ({
  job,
  month,
  era: q.labour != null && q.labour / personDays >= 1320 ? "now" : "old",
  kind: "split",
  facts: { ...wallSplit(kw), ...more },
  quoted: {
    personDays,
    unitsCostCents: q.cost != null ? c(q.cost) : undefined,
    unitsCents: q.units != null ? c(q.units) : undefined,
    materialsCents: q.materials != null ? c(q.materials) : undefined,
    labourCents: q.labour != null ? c(q.labour) : undefined,
  },
  note,
});

/* The wall-split kit's materials as the catalogue sells them: 7 m of 1/4 +
   1/2 at $13.94, 1.5 lengths at $49.50, the mount $22.29, the isolator
   $28.50 and consumables $52.50. */
const KIT = 275.12;
const KIT_10M_38 = 313.69;

export const PAST_JOBS: PastJob[] = [
  split("3378", "2026-09", 2.5, 1, { cost: 776.5, units: 1200, materials: 233.86, labour: 1320 }),
  split("3243", "2026-08", 2.5, 1.5, { cost: 776.5, units: 1048.28, materials: KIT, labour: 1980 }, "coil keyed at $187.18 a metre; the kit's $275.12 used"),
  split("3088", "2026-07", 7.1, 2, { cost: 1572, units: 2122.2, materials: KIT, labour: 2640 }, "coil keyed at $187.18 a metre; the kit's $275.12 used"),
  split("3091", "2026-07", 6, 2, { cost: 1480, units: 1998, materials: KIT, labour: 2640 }, "coil keyed at $187.18 a metre; the kit's $275.12 used"),
  split("2977", "2026-06", 4.8, 2, { cost: 1265, units: 1496.5, materials: KIT, labour: 2640 }),
  split("2782", "2026-04", 4.8, 2, { cost: 1265, units: 1496.5, materials: KIT, labour: 2640 }),
  split("2760", "2026-04", 7.1, 2, { cost: 1572, units: 2122.2, materials: KIT, labour: 2640 }),
  split("2683", "2026-03", 4.8, 2, { cost: 1265, units: 1496.5, materials: KIT, labour: 2640 }),
  split("2633", "2026-02", 2.5, 1.5, { cost: 776.5, units: 1048.28, materials: KIT, labour: 1980 }, "a replacement"),
  split("2523", "2026-02", 3.5, 1.5, { cost: 923, units: 1246.05, materials: 299.87, labour: 1980 }),
  split("2473", "2026-01", 2.5, 3, { cost: 776.5, units: 1048.28, materials: KIT, labour: 3960 }, "a day of it was five indoor and three outdoor cleans"),
  split("2439", "2026-01", 4.2, 2, { cost: 1108, units: 1495.8, materials: KIT_10M_38, labour: 2640 }),
  split("2332", "2025-12", 4.8, 2, { cost: 1265, units: 1496.5, materials: KIT, labour: 2640 }),
  split("2294", "2025-12", 4.2, 2, { cost: 1108, units: 1495.8, materials: KIT_10M_38, labour: 2640 }),
  split("2265", "2025-12", 7.1, 2, { cost: 1572, units: 2122.2, materials: KIT, labour: 2640 }),
  split("2259", "2025-12", 4.2, 2, { cost: 1108, units: 1495.8, materials: KIT_10M_38, labour: 2640 }),
  split("2225", "2025-11", 4.2, 2, { cost: 1108, units: 1495.8, materials: KIT_10M_38, labour: 2640 }),
  split("2126", "2025-10", 3.5, 1, { cost: 923, units: 1246.05, materials: 299.87, labour: 1320 }),
  split("2070", "2025-10", 6, 2, { cost: 1480, units: 1702, materials: KIT, labour: 2200 }),
  split("1880", "2025-08", 4.8, 1.5, { cost: 1265, units: 1496.5, materials: KIT, labour: 1980 }, "back to back, as its brief says"),
  split("1763", "2025-07", 7.1, 2, { cost: 1572, units: 2122.2, materials: KIT, labour: 2640 }),
  split("1616", "2025-06", 4.2, 2),
  split("1609", "2025-06", 7.1, 2),
  split("1565", "2025-06", 7.1, 2),
  split("1468", "2025-05", 4.8, 1.5),
  split("1470", "2025-05", 2.5, 1),
  split("1421", "2025-04", 4.2, 1.5),
  split("1361", "2025-04", 4.2, 2),
  split("1321", "2025-03", 3.5, 1.5),
  split("1160", "2025-02", 2.5, 1.5),
  split("1036", "2025-01", 3.5, 1),
  split("999", "2025-01", 3.5, 2),
  split("975", "2024-12", 7.1, 2),
  split("879", "2024-11", 7.1, 2),
  split("826", "2024-11", 2.5, 1.5),
  split("772", "2024-10", 4.2, 2),
  split("755", "2024-10", 6, 2),
  split("744", "2024-10", 4.2, 2),
  split("697", "2024-09", 4.8, 2),

  {
    job: "3372",
    month: "2026-09",
    era: "now",
    kind: "ducted",
    facts: {
      indoor: "PEA-M140HAA",
      outdoor: "PUZ-ZM140YKA2",
      outdoorWidthMm: null,
      outdoorWeightKg: null,
      threePhase: true,
      zones: 5,
      outlets: 6,
      zoneMm: 250,
      zoning: "meLinear",
      grilles: "cone",
      airflowLs: null,
      returnSize: { wMm: 750, hMm: 550 },
      pipeM: 20,
    },
    quoted: { unitsCostCents: c(4963.97), unitsCents: c(6204.96), materialsCents: c(4027.77 - 166.04), personDays: 4, labourCents: c(5280) },
    note: "his smart zoning at $2,000; his extra wall controller ($166) left out, the linear kit has its own",
  },
  {
    job: "3283",
    month: "2026-09",
    era: "now",
    kind: "ducted",
    facts: {
      indoor: "PEA-M125GAA",
      outdoor: "PUZ-ZM125VKA2",
      outdoorWidthMm: null,
      outdoorWeightKg: null,
      threePhase: false,
      zones: 6,
      zoneMm: 250,
      zoning: "none",
      grilles: "cone",
      airflowLs: null,
      returnSize: { wMm: 750, hMm: 550 },
      pipeM: 20,
    },
    quoted: { unitsCostCents: c(3568.55), unitsCents: c(4460.69), materialsCents: c(1589), personDays: 4, labourCents: c(5280) },
    note: "most of its materials were entered at cost",
  },
  {
    job: "1170",
    month: "2025-02",
    era: "old",
    kind: "ducted",
    facts: {
      indoor: "PEA-M125GAA",
      outdoor: "PUZ-ZM125VKA2",
      outdoorWidthMm: null,
      outdoorWeightKg: null,
      threePhase: false,
      zones: 5,
      outlets: 6,
      zoneMm: 250,
      zoning: "me24",
      grilles: "cone",
      airflowLs: null,
      returnSize: { wMm: 750, hMm: 550 },
      pipeM: 15,
    },
    quoted: { personDays: 4.5 },
    note: "an iZone kit; the 24 V kit stands in",
  },
  {
    job: "2330",
    month: "2025-12",
    era: "now",
    kind: "ducted",
    facts: {
      indoor: "PEA-M125HAA",
      outdoor: "PUZ-ZM125VKA2-A.TH",
      outdoorWidthMm: 1050,
      outdoorWeightKg: 114,
      threePhase: false,
      supply: "noseCone",
      noseCone: "NCMIT100HAA",
      zones: 5,
      zoneMm: 250,
      zoning: "me24",
      grilles: "stock",
      airflowLs: 1000,
      pipeM: null,
      mount: "wall",
      trunkingM: 9.6,
    },
    quoted: { personDays: 5, totalCents: c(13900) },
    note: "one lump sum; Isaac said four to five for the day, and it ran over",
  },
];
