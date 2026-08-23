/* A free-text make field is how one fleet ends up holding "TOYOTA", "Toyota"
   and "toyota" as three different marques: the register can't group, sort or
   count them, and the list just reads as messy. So the form picks from this
   list instead of typing, and this module owns the one true spelling of each.

   It is deliberately NOT a closed set — a fleet has trailers, imports and
   one-off plant whose maker will never be on any list, so the form keeps an
   "not listed" escape hatch. The list exists to make the common 99% land on
   the same spelling every time, not to refuse the other 1%. */

/** The canonical spelling of every make the picker offers, A–Z as displayed.
    Skewed to what an Australian trade fleet actually runs: utes, vans, light
    trucks. Add to it freely — the only rule is that a make appears once, spelt
    the way its maker spells it. */
export const VEHICLE_MAKES = [
  "Audi",
  "BMW",
  "BYD",
  "Chery",
  "Chevrolet",
  "Chrysler",
  "Citroën",
  "DAF",
  "Daihatsu",
  "Dodge",
  "Fiat",
  "Ford",
  "Foton",
  "Fuso",
  "GMC",
  "GWM",
  "Hino",
  "Holden",
  "Honda",
  "Hyundai",
  "Isuzu",
  "Isuzu Ute",
  "Iveco",
  "JAC",
  "Jeep",
  "Kenworth",
  "Kia",
  "Land Rover",
  "LDV",
  "Lexus",
  "Mack",
  "Mahindra",
  "Mazda",
  "Mercedes-Benz",
  "MG",
  "Mitsubishi",
  "Nissan",
  "Peugeot",
  "RAM",
  "Renault",
  "Scania",
  "Skoda",
  "SsangYong",
  "Subaru",
  "Suzuki",
  "Tesla",
  "Toyota",
  "UD Trucks",
  "Volkswagen",
  "Volvo",
  "Western Star",
] as const;

export type VehicleMake = (typeof VEHICLE_MAKES)[number];

/** The <option> value that reveals the free-text box. Not a real make, and
    never stored — picking it clears the field until something is typed. */
export const MAKE_NOT_LISTED = "__not_listed__";

/** Everything that is not a letter or a digit is noise for matching purposes:
    it lets "MERCEDES BENZ", "mercedes-benz" and "Mercedes Benz" all meet. */
function key(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Citroën -> Citroen
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Spellings seen in the wild that mean a make already on the list. The value
    is always a member of VEHICLE_MAKES — `satisfies` proves it, so a typo here
    is a build error rather than a lookup that silently misses. */
const ALIASES = {
  chevy: "Chevrolet",
  greatwall: "GWM",
  gwmhaval: "GWM",
  haval: "GWM",
  isuzuutes: "Isuzu Ute",
  landrover: "Land Rover",
  merc: "Mercedes-Benz",
  mercedes: "Mercedes-Benz",
  mercedesbenz: "Mercedes-Benz",
  ram: "RAM",
  ramtrucks: "RAM",
  skoda: "Skoda",
  ssangyong: "SsangYong",
  ud: "UD Trucks",
  vw: "Volkswagen",
  volkswagon: "Volkswagen", // common misspelling, and it is always this make
} satisfies Record<string, VehicleMake>;

const BY_KEY = new Map<string, VehicleMake>([
  ...VEHICLE_MAKES.map((m) => [key(m), m] as const),
  ...(Object.entries(ALIASES) as [string, VehicleMake][]),
]);

/** The canonical spelling of `raw`, or null if it is not a make we know.
    Case, spacing and punctuation are all ignored, so the dirty values already
    sitting in a register ("TOYOTA", "Byd", "MERCEDES BENZ") come back tidy —
    which is what lets the picker preselect the right row when you open an
    existing vehicle, instead of dumping it into "not listed". */
export function canonicalMake(raw: string): VehicleMake | null {
  return BY_KEY.get(key(raw)) ?? null;
}
