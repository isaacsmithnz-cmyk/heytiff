import type { ComponentKey } from "./components";
import { RANGE_KINDS, type RangeKind, type RangeSize } from "./ranges";

/* THE COMMON INSTALL ITEMS, IN GROUPS (Isaac, 28 October 2026: "create a
   list of common items that are required for air conditioning
   installations… Group them and then that way companies, when they're
   setting up their quoting, can quickly see ductwork"; then, on the mock,
   "clearly show the part with its universal name… next to it is the actual
   item from a supplier", and "simplify… one page").

   Every part a kit prices, in the eight groups an installer thinks in. A
   part is either one of Quoting's preferred items (components.ts), priced
   from one item, or a range that comes in sizes (ranges.ts), priced at the
   size a line needs. Each is named the trade's way, whatever a supplier
   calls it, with what it is underneath. The ductwork's fittings are listed
   a size each, in the inches the trade says them ("Y 14-10-10").

   The isolator and the outdoor's wall bracket are here as their ranges,
   the size a line needs: their one-item preferred parts stay a kit's way
   to price them when a business has no range, and aren't listed twice.

   The same groups for every business: only the items in them are its own.
   Pure: the page and its tests read the same list. */

export type GroupPart =
  | { component: ComponentKey; name: string; spec: string }
  /** a range; `bySize` lists each item in it a row of its own (the fittings) */
  | { range: RangeKind; name: string; spec: string; bySize?: boolean };

export type InstallSection = { heading?: string; parts: GroupPart[] };

export const GROUP_KEYS = ["pipe", "cable", "drain", "mounting", "covering", "ductwork", "grilles", "controls"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export type InstallGroup = { key: GroupKey; label: string; summary: string; sections: InstallSection[] };

const all = (kind: RangeKind) => `All sizes, ${RANGE_KINDS[kind].by}`;
const range = (kind: RangeKind, name: string, spec = all(kind)): GroupPart => ({ range: kind, name, spec });

export const INSTALL_GROUPS: InstallGroup[] = [
  {
    key: "pipe",
    label: "Pipe",
    summary: "Pair coil in five sizes",
    sections: [
      {
        parts: [
          { component: "pair_coil_14_38", name: "Pair coil 1/4 + 3/8", spec: "Insulated, by the coil" },
          { component: "pair_coil_14_12", name: "Pair coil 1/4 + 1/2", spec: "Insulated, by the coil" },
          { component: "pair_coil_14_58", name: "Pair coil 1/4 + 5/8", spec: "Insulated, by the coil" },
          { component: "pair_coil_38_58", name: "Pair coil 3/8 + 5/8", spec: "Insulated, by the coil" },
          { component: "pair_coil_38_34", name: "Pair coil 3/8 + 3/4", spec: "Insulated, by the coil" },
        ],
      },
    ],
  },
  {
    key: "cable",
    label: "Cable and power",
    summary: "Interconnect, power cable, RCBO, isolator, transmission cable",
    sections: [
      {
        parts: [
          { component: "interconnect", name: "Interconnect cable", spec: "3 core and earth, 1.5 mm²" },
          { component: "power_cable", name: "Power cable", spec: "Twin and earth, 2.5 mm²" },
          { component: "power_cable_4", name: "Power cable", spec: "Twin and earth, 4 mm²" },
          { component: "power_cable_6", name: "Power cable", spec: "Twin and earth, 6 mm²" },
          range("rcbo", "RCBO"),
          range("isolator", "Isolator"),
          { component: "transmission_cable", name: "Transmission cable", spec: "VRF, shielded" },
        ],
      },
    ],
  },
  {
    key: "drain",
    label: "Drain",
    summary: "Drain hose, drain pipe, condensate pump",
    sections: [
      {
        parts: [
          { component: "drain_hose", name: "Drain hose", spec: "By the coil" },
          { component: "condensate_drain", name: "Condensate drain pipe", spec: "PVC, one length" },
          { component: "condensate_pump", name: "Condensate pump", spec: "Tank pump" },
        ],
      },
    ],
  },
  {
    key: "mounting",
    label: "Mounting",
    summary: "Wall bracket, ground mount, hanging kit, spring hangers",
    sections: [
      {
        parts: [
          range("wall_bracket", "Outdoor unit wall bracket"),
          { component: "ground_mount", name: "Outdoor unit ground mount", spec: "Pad, stand or rubber mounts" },
          { component: "hanging_kit", name: "Indoor unit hanging kit", spec: "Ducted indoor" },
          { component: "spring_hangers", name: "Spring hangers", spec: "Underfloor ducted" },
        ],
      },
    ],
  },
  {
    key: "covering",
    label: "Covering",
    summary: "Pipe covering",
    sections: [{ parts: [{ component: "pipe_cover", name: "Pipe covering", spec: "One length" }] }],
  },
  {
    key: "ductwork",
    label: "Ductwork",
    summary: "Flexible duct, Ys and BTOs, reducers, plenums, zone dampers",
    sections: [
      { parts: [range("flex_duct", "Flexible duct")] },
      { heading: "Fittings", parts: [{ range: "fitting", name: "Ys and BTOs", spec: all("fitting"), bySize: true }, range("reducer", "Reducers")] },
      {
        heading: "Plenums and dampers",
        parts: [
          range("plenum", "Supply plenum", "Made for the unit's face"),
          range("return_plenum", "Return plenum", "Made for the unit's return"),
          range("zone_damper", "Zone damper"),
        ],
      },
    ],
  },
  {
    key: "grilles",
    label: "Grilles and outlets",
    summary: "Diffusers, bar and slot grilles, return grille and box",
    sections: [
      {
        parts: [
          range("round_diffuser", "Round diffuser"),
          range("square_diffuser", "Square diffuser"),
          range("mdo", "MDO"),
          range("bar_grille", "Bar grille"),
          range("slot_diffuser", "Slot diffuser"),
          range("return_grille", "Return air grille"),
          { component: "return_box", name: "Return air box", spec: "Behind the return grille" },
        ],
      },
    ],
  },
  {
    key: "controls",
    label: "Controls",
    summary: "Wall controller, zone damper cable",
    sections: [
      {
        parts: [
          { component: "wall_controller", name: "Wall controller", spec: "Wired, the indoor's own" },
          { component: "zone_cable", name: "Zone damper cable", spec: "One a damper" },
        ],
      },
    ],
  },
];

/** A Y or a BTO as the trade says it, in inches: "Y 14-10-10",
    "BTO 12-10-8", a combo's way in as "18/20". */
export function fittingWords(name: string, size: RangeSize): string {
  const inch = (mm: number) => String(Math.round(mm / 25.4));
  const into = (size.ins ?? []).map(inch).join("/");
  const sizes = [into, ...(size.outs ?? []).map(inch)].filter(Boolean).join("-");
  return `${/\bd?bto\b|branch\s*take/i.test(name) ? "BTO" : "Y"} ${sizes}`;
}

/** The suppliers a group's items come from, in a few words: "AAD",
    "AAD and Reece", "AAD, Reece and 2 more". */
export function suppliersWords(names: readonly string[]): string | null {
  const seen = [...new Set(names)];
  if (seen.length === 0) return null;
  if (seen.length === 1) return seen[0]!;
  if (seen.length === 2) return `${seen[0]} and ${seen[1]}`;
  return `${seen[0]}, ${seen[1]} and ${seen.length - 2} more`;
}

/** The group a preferred item is in; null for one no group lists (the
    isolator's and the wall bracket's single items, their ranges stand in). */
export function groupOfComponent(key: ComponentKey): GroupKey | null {
  return INSTALL_GROUPS.find((g) => g.sections.some((s) => s.parts.some((p) => "component" in p && p.component === key)))?.key ?? null;
}

/** The group a range is in. */
export function groupOfRange(kind: RangeKind): GroupKey | null {
  return INSTALL_GROUPS.find((g) => g.sections.some((s) => s.parts.some((p) => "range" in p && p.range === kind)))?.key ?? null;
}
