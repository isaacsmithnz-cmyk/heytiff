import type { DuctedFacts } from "../../ducted-template";
import type { MultiFacts } from "../../multi-template";
import type { SplitFacts } from "../../split-template";

/* QUOTES THE BUILDER NEVER SAW THE LINES OF — Diamond Air jobs quoted as one
   "As Per Quote" sum, chosen because their scope in ServiceM8 names the
   models and the work. Each is rebuilt from that scope alone and held to
   the sum (ex GST; repairs, gyprock, rope access and other separately
   priced extras left out). Job numbers only. */

export type BlindSystem =
  | { kind: "split"; facts: SplitFacts }
  | { kind: "multi"; facts: MultiFacts }
  | { kind: "ducted"; facts: DuctedFacts };

export type BlindJob = {
  job: string;
  status: "won" | "lost" | "open";
  systems: BlindSystem[];
  quotedCents: number;
  /** what the scope says that the builder had to assume */
  assumed?: string;
  /** Isaac's own labour figure, where the job notes give one */
  notedPersonDays?: number;
};

const AP: Record<number, [string, SplitFacts["pipe"]]> = {
  2.5: ["MSZ-AP25VGKD2-A2", "1/4+3/8"],
  3.5: ["MSZ-AP35VGKD2-A2", "1/4+3/8"],
  4.2: ["MSZ-AP42VGKD2-A2", "1/4+3/8"],
  5: ["MSZ-AP50VGKD2-A2", "1/4+1/2"],
  7.1: ["MSZ-AP71VGKD2-A2", "1/4+1/2"],
};
const OUT: Record<number, string> = { 2.5: "MUZ-AP25VGD2-A2", 3.5: "MUZ-AP35VGD2-A2", 4.2: "MUZ-AP42VGD2-A2", 5: "MUZ-AP50VGD2-A2", 7.1: "MUZ-AP71VGD2-A2" };
const split = (kw: number): BlindSystem => ({ kind: "split", facts: { indoor: AP[kw]![0], outdoor: OUT[kw]!, kw, pipe: AP[kw]![1] } });
const head = (kw: number) => ({ indoor: AP[kw]![0], kw, pipe: AP[kw]![1] });
const multi = (outdoor: string, kws: number[], more: Partial<MultiFacts> = {}): BlindSystem => ({ kind: "multi", facts: { outdoor, heads: kws.map(head), ...more } });
const c = (d: number) => Math.round(d * 100);

const ducted = (f: Partial<DuctedFacts> & Pick<DuctedFacts, "indoor" | "outdoor" | "zones" | "zoning" | "grilles">): BlindSystem => ({
  kind: "ducted",
  facts: { outdoorWidthMm: null, outdoorWeightKg: null, threePhase: false, zoneMm: 250, airflowLs: null, pipeM: null, ...f },
});

export const BLIND_JOBS: BlindJob[] = [
  { job: "3183", status: "won", systems: [split(4.2)], quotedCents: c(3650), assumed: "its outdoor GPO and drain to the downpipe are in his sum" },
  { job: "3310", status: "won", systems: [split(4.2)], quotedCents: c(3000), assumed: "an apartment; the new circuit and DGPO were priced apart" },
  { job: "3307", status: "open", systems: [split(4.2)], quotedCents: c(4250) },
  { job: "3380", status: "open", systems: [split(3.5)], quotedCents: c(2950), assumed: "a backyard office" },
  { job: "3322", status: "won", systems: [split(5), split(2.5)], quotedCents: c(6240) },

  { job: "3256", status: "won", systems: [multi("MXZ-4F71VGD-A2", [5, 3.5], { newCircuit: true })], quotedCents: c(9650), notedPersonDays: 3, assumed: "his note: 3 for a day, $1,800 materials" },
  { job: "3292", status: "open", systems: [multi("MXZ-3F54VGD-A2", [2.5, 4.2])], quotedCents: c(6890), assumed: "an apartment" },
  { job: "2759", status: "won", systems: [multi("MXZ-3F54VGD-A1", [2.5, 2.5, 2.5], { mount: "wall" })], quotedCents: c(6850), assumed: "roof brackets" },
  { job: "3197", status: "won", systems: [multi("MXZ-2F52VGD-A2", [3.5, 3.5])], quotedCents: c(5300) },
  { job: "3249", status: "open", systems: [split(7.1), multi("MXZ-2F52VF-A2", [2.5, 4.2])], quotedCents: c(12500), notedPersonDays: 4, assumed: "his note: 4 for the day, $2,500 materials; rope access and patching priced apart" },

  {
    job: "3210",
    status: "open",
    systems: [
      ducted({ indoor: "PEA-M140HAA", outdoor: "PUZ-ZM140VKA2", zones: 0, zoning: "none", grilles: "stock", reuse: { pipe: true, flush: false, ductwork: true, zoneMotors: true }, replacing: true }),
    ],
    quotedCents: c(9950),
    notedPersonDays: 3,
    assumed: "keeps pipes (pressure tested, not flushed), ducts and zone motors; '2 x trades + TA'",
  },
  {
    job: "3282",
    status: "open",
    systems: [ducted({ indoor: "PEA-M125GAA", outdoor: "PUZ-ZM125YKA2", threePhase: true, zones: 0, zoning: "none", grilles: "stock", reuse: { ductwork: true }, replacing: true })],
    quotedCents: c(9000),
    assumed: "underfloor, keeps the six floor grilles and ducts; new pipe; raising the pad not priced",
  },
  {
    job: "2966",
    status: "won",
    systems: [ducted({ indoor: "PEA-M160HAA", outdoor: "PUZ-ZM160YKA-A", threePhase: true, zones: 4, zoning: "me24", grilles: "stock", reuse: { ductwork: true }, replacing: true })],
    quotedCents: c(15950),
    assumed: "keeps most ductwork; new 4-zone kit, pipe and trunking; his sum includes gyprock make-good",
  },
  {
    job: "3272",
    status: "open",
    systems: [ducted({ indoor: "PEA-M140HAA", outdoor: "PUZ-ZM140VKA2", zones: 3, outlets: 6, zoning: "me24", grilles: "stock", storeys: 2 })],
    quotedCents: c(17250),
    assumed: "two storeys, three zones over six rooms; bar grilles",
  },
  {
    job: "2716",
    status: "lost",
    systems: [ducted({ indoor: "PEA-M200LAA", outdoor: "PUZ-ZM200YKA-A", threePhase: true, zones: 4, outlets: 6, zoning: "me24", grilles: "stock", newBuild: true })],
    quotedCents: c(18500),
    assumed: "one of its two 20 kW systems; the slot diffusers and ventilation were priced apart",
  },
];
