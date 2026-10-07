import "server-only";
import { brandOfCode } from "./brand";
import { fitChecks, type Fit } from "./fit";
import type { QuoteLine } from "./lines";
import type { UnitLookup } from "./lookups";
import { lookupUnit } from "./lookups-server";

/* Each system's parts checked against its outdoor unit (fit.ts), read off
   the maker's data pack for the units on the quote. A brand with no pack,
   or a system with no outdoor unit, is "not checked". */

/** The data packs HeyTiff holds, by the brand a code names. */
const PACK_OF: Record<string, string> = { mitsubishi: "mitsubishi-electric" };

export async function linesFit(lines: QuoteLine[]): Promise<Fit[]> {
  const outdoor = new Map<string, UnitLookup>();
  const units = lines.filter((l) => l.kind === "unit" && l.code);
  for (const key of [...new Set(units.map((l) => `${l.optionIndex}|${l.system}`))]) {
    let found: UnitLookup = { found: false, reason: "not in the pack" };
    for (const u of units.filter((l) => `${l.optionIndex}|${l.system}` === key)) {
      const brand = brandOfCode(u.code!, u.name);
      const pack = brand ? PACK_OF[brand] : undefined;
      if (!pack) {
        found = { found: false, reason: "no data pack" };
        continue;
      }
      const r = await lookupUnit(pack, u.code!).catch((): UnitLookup => ({ found: false, reason: "not in the pack" }));
      if (r.found && r.specs.role === "outdoor") {
        found = r;
        break;
      }
    }
    outdoor.set(key, found);
  }
  /* fit.ts keys systems by name: one option's system at a time */
  const out: Fit[] = [];
  for (const [key, unit] of outdoor) {
    const parts = lines.filter((l) => `${l.optionIndex}|${l.system}` === key && l.kind !== "labour");
    out.push(...fitChecks(parts.map((l) => ({ key: l.id, system: key, name: l.name, code: l.code })), new Map([[key, unit]])));
  }
  return out;
}
