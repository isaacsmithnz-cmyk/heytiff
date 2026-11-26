import "server-only";
import { brandOfCode } from "./brand";
import { kwInName } from "./brands";
import { currentItemsByCode } from "./price-book-server";
import { fitChecks, type Fit, type SystemPipe } from "./fit";
import type { QuoteLine } from "./lines";
import type { UnitLookup, UnitSpecs } from "./lookups";
import { lookupSystemPipes, lookupUnit } from "./lookups-server";

/* Each system's parts checked against its outdoor unit (fit.ts), read off
   the maker's data pack for the units on the quote. A brand with no pack,
   or a system with no outdoor unit, is "not checked". */

/** The data packs HeyTiff holds, by the brand a code names. */
const PACK_OF: Record<string, string> = { mitsubishi: "mitsubishi-electric" };

export async function linesFit(lines: QuoteLine[], orgId?: string | null): Promise<Fit[]> {
  const outdoor = new Map<string, UnitLookup>();
  /* a VRF's or a multi's pipe is more than its outdoor's stubs: its heads'
     connections and its pipe tables' sizes (fit.ts SystemPipe) */
  const pipes = new Map<string, SystemPipe>();
  const units = lines.filter((l) => l.kind === "unit" && l.code);
  for (const key of [...new Set(units.map((l) => `${l.optionIndex}|${l.system}`))]) {
    let found: UnitLookup = { found: false, reason: "not in the pack" };
    let packOf: string | null = null;
    const heads: SystemPipe["heads"] = [];
    for (const u of units.filter((l) => `${l.optionIndex}|${l.system}` === key)) {
      const brand = brandOfCode(u.code!, u.name);
      const pack = brand ? PACK_OF[brand] : undefined;
      if (!pack) {
        if (!found.found) found = { found: false, reason: "no data pack" };
        continue;
      }
      const r = await lookupUnit(pack, u.code!, orgId).catch((): UnitLookup => ({ found: false, reason: "not in the pack" }));
      if (r.found && r.specs.role === "outdoor" && !found.found) {
        found = r;
        packOf = pack;
      } else if (r.found && r.specs.role === "indoor" && r.specs.pipeMm) {
        for (let i = 0; i < Math.max(1, Math.round(u.qty)); i++) heads.push({ model: r.specs.model, pipeMm: r.specs.pipeMm });
      }
    }
    outdoor.set(key, found);
    if (found.found && packOf) {
      const sys = await lookupSystemPipes(packOf, found.specs.model).catch(() => null);
      pipes.set(key, { multi: (sys != null && sys.type !== "split") || heads.length > 1, heads, sections: sys?.sizes ?? [] });
    }
  }
  /* fit.ts keys systems by name: one option's system at a time */
  const out: Fit[] = [];
  for (const [key, unit] of outdoor) {
    const parts = lines.filter((l) => `${l.optionIndex}|${l.system}` === key && l.kind !== "labour");
    const sys = pipes.get(key);
    out.push(...fitChecks(parts.map((l) => ({ key: l.id, system: key, name: l.name, code: l.code })), new Map([[key, unit]]), sys ? new Map([[key, sys]]) : undefined));
  }
  return out;
}

/** Each unit line's specs off its maker's pack, by line id: null where the
    brand has no pack or the pack hasn't the model. */
export async function unitSpecsOf(lines: readonly QuoteLine[], orgId?: string | null): Promise<Map<string, UnitSpecs | null>> {
  const out = new Map<string, UnitSpecs | null>();
  for (const u of lines.filter((l) => l.kind === "unit" && l.code)) {
    const brand = brandOfCode(u.code!, u.name);
    const pack = brand ? PACK_OF[brand] : undefined;
    const r = pack ? await lookupUnit(pack, u.code!, orgId).catch((): UnitLookup => ({ found: false, reason: "not in the pack" })) : null;
    out.set(u.id, r?.found ? r.specs : null);
  }
  return out;
}

/** Each code's specs off its maker's pack, by code: null where the brand
    has no pack or the pack hasn't the model. */
export async function specsOfCodes(units: readonly { code: string; name: string }[], orgId?: string | null): Promise<Map<string, UnitSpecs | null>> {
  const out = new Map<string, UnitSpecs | null>();
  for (const u of units) {
    if (out.has(u.code)) continue;
    const brand = brandOfCode(u.code, u.name);
    const pack = brand ? PACK_OF[brand] : undefined;
    const r = pack ? await lookupUnit(pack, u.code, orgId).catch((): UnitLookup => ({ found: false, reason: "not in the pack" })) : null;
    out.set(u.code, r?.found ? r.specs : null);
  }
  return out;
}

/** Each unit line's cooling kW, by line id: its maker's pack first (the
    pack has PEFY-P25VMX-E at 2.8 kW where its code's number says 25), else
    the price book's own name for its code ("2.8kW C/M Compact…"). Only the
    lines something says (job 3608, 26 November 2026: the proposal's unit
    table undersold every unit, read off "Indoor unit, Master Bed 4" and the
    code's number). */
export async function coolingOf(lines: readonly QuoteLine[], orgId?: string | null): Promise<Record<string, number>> {
  const units = lines.filter((l) => l.kind === "unit" && l.code);
  const specs = await unitSpecsOf(units, orgId);
  const out: Record<string, number> = {};
  const unread: QuoteLine[] = [];
  for (const u of units) {
    const kw = specs.get(u.id)?.coolKw;
    if (kw != null && kw > 0) out[u.id] = kw;
    else unread.push(u);
  }
  if (orgId && unread.length > 0) {
    const items = await currentItemsByCode(orgId, unread.map((u) => u.code!)).catch(() => []);
    for (const u of unread) {
      const item = items.find((i) => i.code === u.code && i.supplierKey === u.supplierKey) ?? items.find((i) => i.code === u.code);
      const kw = item ? kwInName(item.name) : null;
      if (kw != null) out[u.id] = kw;
    }
  }
  return out;
}
