/* WHOSE EQUIPMENT IT IS — so a quote for one brand never pulls another's
   parts. A Mitsubishi zone kit, controller or nose cone on a Daikin job, or
   a Daikin outdoor behind a Mitsubishi indoor, fits nothing and costs a
   return trip (Isaac, 2026-10-02: "the brand should filter itself out").

   The brand is read off the model code the way a person reads it: MSZ-, PEA-,
   PAC- are Mitsubishi's, FDYAN, RZAC, BRC are Daikin's. A part that names no
   brand (ductwork, pipe, grilles, dampers, cable) is neutral and goes with
   anything. Pure. */

export type Brand = "mitsubishi" | "daikin";

const MITSUBISHI_CODE = /^((MSZ|MUZ|MXZ|MFZ|MLZ|SLZ|SEZ|SUZ|PEAD?|PEFY|PEY|PLA|PLFY|PUZ|PUMY|PURY|PUHZ|PCA|PKA|PKFY)[-A-Z0-9]|(PAC|PAR|MAC)-|NCMIT)/i;
const DAIKIN_CODE = /^((FDY|FBA|FXA|FXD|FCA|FFA|FHA|FTX|FDXM|RXM|RXS|RZAC|RZA|RZQ|BRC|BYC|KRP)[A-Z0-9]|RZ[AQ][A-Z]?\d)/i;
const MITSUBISHI_NAME = /\bmitsubishi\b|^MEA\b|\bME ACC\b/i;
const DAIKIN_NAME = /\bdaikin\b|^DAI\b/i;

/** The brand a code (and, failing that, the item's name) belongs to; null
    for a neutral part or one we can't place. */
export function brandOfCode(code: string, name?: string | null): Brand | null {
  if (MITSUBISHI_CODE.test(code)) return "mitsubishi";
  if (DAIKIN_CODE.test(code)) return "daikin";
  if (name) {
    if (MITSUBISHI_NAME.test(name)) return "mitsubishi";
    if (DAIKIN_NAME.test(name)) return "daikin";
  }
  return null;
}

/** An item of another brand than the system's. A neutral item, or a system
    whose brand isn't known, never conflicts. */
export function wrongBrand(system: Brand | null, code: string, name?: string | null): Brand | null {
  const b = brandOfCode(code, name);
  return system && b && b !== system ? b : null;
}

/** Only what fits the system: its own brand's parts and the neutral ones. */
export function fitsBrand<T>(system: Brand | null, items: T[], codeOf: (i: T) => string, nameOf?: (i: T) => string | null | undefined): T[] {
  return items.filter((i) => !wrongBrand(system, codeOf(i), nameOf?.(i)));
}
