/* The verdict on a system: can what is in it be installed?

   Every system says Combination valid or Combination fails, whatever the
   brand's rule is — a Mitsubishi combination table, another brand's ratio, a
   pair table for a split or a ducted unit. A red finding is something that
   cannot be installed: a unit of another brand, an outdoor that takes one
   head holding two, a pair the book does not list, a set no outdoor lists.
   The builder's Done stays off while there is one, with the finding's words
   beside it. A short zone is red too, but capacity is a judgement and never
   stops Done; that lives in roomVerdict (builder.ts), not here.

   Pure functions over (document, pack, system). No React. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack, IndoorUnit, OutdoorUnit } from "./packs/schema";
import { allocationsOf, hasAllocations } from "./allocations";
import { checkMultiCompatibility } from "./multi";
import { outdoorsListing, pairFor } from "./builder";

export interface SystemFinding {
  severity: "red" | "amber";
  code: string;
  /** what is wrong, as a sentence without a full stop */
  message: string;
  /** what would fix it, when the finding knows */
  fix?: string;
}

const iduRow = (pack: DataPack, model: string): IndoorUnit | null =>
  pack.indoor_units.find((u) => u.model === model) ?? null;
const oduRow = (pack: DataPack, model: string): OutdoorUnit | null =>
  pack.outdoor_units.find((u) => u.model === model) ?? null;

/** the brand's name for its id, from the pack, else the id */
export function brandName(pack: DataPack, id: string): string {
  return pack.brands.find((b) => b.id === id)?.name ?? id;
}

/** every finding on a system, red first */
export function systemFindings(doc: DesignDocument, pack: DataPack, sys: DesignSystem): SystemFinding[] {
  void doc;
  if (!hasAllocations(sys)) return [];
  const allocs = allocationsOf(sys);
  const out: SystemFinding[] = [];
  const headAllocs = allocs.filter((a) => a.role === "idu" && a.model);
  const odu = allocs.find((a) => a.role === "odu" && a.model);

  for (const a of allocs) {
    if (!a.model) continue;
    const row = a.role === "idu" ? iduRow(pack, a.model) : oduRow(pack, a.model);
    if (row && row.brand !== sys.brand) {
      out.push({
        severity: "red",
        code: "brand-mismatch",
        message: `${a.model} is ${brandName(pack, row.brand)}, and this system is ${brandName(pack, sys.brand)}`,
        fix: "A system is one brand: swap it for one of this brand, or take it out",
      });
    }
  }

  const heads = headAllocs.map((a) => iduRow(pack, a.model)).filter((u): u is IndoorUnit => u != null);

  if (!odu) {
    if (heads.length === 0) return out;
    if (sys.type === "multi-split") {
      if (outdoorsListing(pack, heads).length === 0) {
        out.push({
          severity: "red",
          code: "no-outdoor-lists-set",
          message: "No outdoor takes this set of heads",
          fix: "Take a head out, or make one smaller",
        });
      }
    } else if (!pairFor(pack, heads[0].model, null)) {
      out.push({
        severity: "red",
        code: "no-pairing",
        message: `${heads[0].model} has no outdoor pairing in the book`,
      });
    }
    return out;
  }

  const oduSpec = oduRow(pack, odu.model);
  if (!oduSpec) {
    out.push({ severity: "red", code: "unknown-outdoor", message: `${odu.model} is not in the catalogue` });
    return out;
  }

  if (oduSpec.system_type === "multi") {
    const rule = pack.multi_rules.find((r) => r.odu_model_ref === odu.model);
    if (!rule) {
      out.push({ severity: "red", code: "no-rule", message: `${odu.model} has no combination rule in the book` });
    } else if (heads.length) {
      for (const f of checkMultiCompatibility(rule, oduSpec, heads)) {
        if (f.severity !== "red") continue;
        out.push({
          severity: "red",
          code: f.code,
          message: f.message.replace(/\.$/, ""),
          fix:
            f.code === "not-in-combination-table" || f.code === "over-max-count" || f.code === "over-per-port"
              ? "Pick an outdoor that takes them all, or take a head out"
              : undefined,
        });
      }
    }
    return out;
  }

  /* a split or a ducted outdoor: one head, from its pair table */
  if (heads.length > 1) {
    out.push({
      severity: "red",
      code: "outdoor-takes-one",
      message: `${odu.model} takes one head`,
      fix: "Pick an outdoor that takes them all, or take a zone out",
    });
  }
  const head = heads[0];
  if (head && !pack.pair_tables.some((p) => p.idu_model === head.model && p.odu_model === odu.model)) {
    out.push({
      severity: "red",
      code: "pair-not-listed",
      message: `${head.model} does not pair with ${odu.model}`,
      fix: "Pick the outdoor the book pairs it with",
    });
  }
  return out;
}

/** the findings that keep Done off */
export const blockingFindings = (findings: SystemFinding[]): SystemFinding[] =>
  findings.filter((f) => f.severity === "red");

/** the one word every system says about its combination; null while there
    is nothing in it to check */
export function combinationWord(
  doc: DesignDocument,
  pack: DataPack,
  sys: DesignSystem
): "Valid" | "Fails" | null {
  if (!hasAllocations(sys)) return null;
  if (!allocationsOf(sys).some((a) => a.model)) return null;
  return blockingFindings(systemFindings(doc, pack, sys)).length ? "Fails" : "Valid";
}

/** the words beside a Done that is off: the first red finding and its fix */
export function doneReason(findings: SystemFinding[]): string | null {
  const first = blockingFindings(findings)[0];
  if (!first) return null;
  return first.fix ? `${first.message}. ${first.fix}.` : `${first.message}.`;
}

/** a multi's connection ratio: the heads' cooling ratings added up against
    the outdoor's, as a percentage. Plain arithmetic on every brand; where the
    brand's rule is a ratio it carries the verdict, where it is a table (ME)
    it is just the figure. Null without an outdoor, or for a split. */
export function connectionRatio(
  pack: DataPack,
  sys: DesignSystem
): { connectedKw: number; outdoorKw: number; pct: number; heads: number } | null {
  if (!hasAllocations(sys)) return null;
  const allocs = allocationsOf(sys);
  const odu = allocs.find((a) => a.role === "odu" && a.model);
  const oduSpec = odu ? oduRow(pack, odu.model) : null;
  if (!oduSpec || oduSpec.system_type === "split") return null;
  const heads = allocs
    .filter((a) => a.role === "idu" && a.model)
    .map((a) => iduRow(pack, a.model))
    .filter((u): u is IndoorUnit => u != null);
  if (!heads.length || !oduSpec.capacity_cool_kw) return null;
  const connectedKw = heads.reduce((a, u) => a + (u.capacity_cool_kw ?? 0), 0);
  return {
    connectedKw,
    outdoorKw: oduSpec.capacity_cool_kw,
    pct: Math.round((connectedKw / oduSpec.capacity_cool_kw) * 100),
    heads: heads.length,
  };
}
