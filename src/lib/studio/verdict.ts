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
import { checkMultiCompatibility, UNDER_MINIMUM } from "./multi";
import { outdoorsListing, pairFor } from "./builder";
import { checkVrfSet, joinsVrf, vrfBand, vrfLoadCeilingKw, vrfOutdoorsListing, vrfRatio, vrfTakesLoad } from "./vrf";
import { systemCover } from "./coverage";
import { systemVrfTree } from "./vrf-tree";
import { attachOf, floorBasesM, mountOf } from "./graph";

export interface SystemFinding {
  severity: "red" | "amber";
  code: string;
  /** what is wrong, as a sentence without a full stop */
  message: string;
  /** what would fix it, when the finding knows */
  fix?: string;
  /** about the pipework drawn on the plan, not the units: it fails the
      combination, but never keeps the builder's Done off — a head swapped in
      the builder cuts its old pipe loose, and that must not lock the change
      out (Isaac, 2026-09-29: "I seem to be locked out of saving") */
  drawing?: boolean;
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
  const out = combinationFindings(doc, pack, sys);
  const drawing = [loosePipes(doc, sys), ...strayFittings(doc, sys)].filter((f): f is SystemFinding => f != null);
  return [...out, ...drawing];
}

/* A JOINT WITH NO T (Isaac, 2026-09-29: "if I put a join on somewhere and
   just leave it, it just gets placed, but it's not actually connected to
   anything"). A joint is one pipe in and two out: with fewer than three on it
   it branches nothing — a part on the picklist doing no job. A branch box
   with no pipe on at all is the same. */
export function strayFittingIds(
  doc: DesignDocument,
  sys: DesignSystem
): { joints: string[]; boxes: string[]; risers: string[] } {
  const on = new Map<string, number>();
  for (const o of doc.objects) {
    if (o.type !== "pipe-run" || o.systemId !== sys.id) continue;
    for (const a of [attachOf(o.props.startAttach), attachOf(o.props.endAttach)])
      if (a) on.set(a.id, (on.get(a.id) ?? 0) + 1);
  }
  const mine = doc.objects.filter((o) => o.systemId === sys.id);
  return {
    joints: mine.filter((o) => o.type === "joint" && (on.get(o.id) ?? 0) < 3).map((o) => o.id),
    boxes: mine.filter((o) => o.type === "branch-box" && (on.get(o.id) ?? 0) === 0).map((o) => o.id),
    /* a riser no pipe reaches on its own floor (Isaac, 2026-09-30: it sat on
       the trunk without joining it, and the floor above was cut off) */
    risers: mine.filter((o) => o.type === "riser" && (on.get(o.id) ?? 0) === 0).map((o) => o.id),
  };
}

function strayFittings(doc: DesignDocument, sys: DesignSystem): SystemFinding[] {
  const { joints, boxes, risers } = strayFittingIds(doc, sys);
  const out: SystemFinding[] = [];
  if (risers.length)
    out.push({
      severity: "red",
      code: "stray-riser",
      drawing: true,
      message: risers.length === 1 ? "A riser has no pipe on its floor" : `${risers.length} risers have no pipe on their floor`,
      fix: "Connect a pipe to it, or delete it",
    });
  if (joints.length)
    out.push({
      severity: "red",
      code: "stray-joint",
      drawing: true,
      message: joints.length === 1 ? "A joint isn't connected" : `${joints.length} joints aren't connected`,
      fix: "Connect it, or delete it",
    });
  if (boxes.length)
    out.push({
      severity: "red",
      code: "stray-box",
      drawing: true,
      message: boxes.length === 1 ? "A branch box isn't connected" : `${boxes.length} branch boxes aren't connected`,
      fix: "Connect it, or delete it",
    });
  return out;
}

/* A REFRIGERANT PIPE THAT GOES NOWHERE (Isaac, 2026-09-29, walk C: "a pipe
   run that doesn't go anywhere, and I don't think there's any warning"). An
   end with nothing on it is copper and gas on the job that no unit, joint or
   box takes, and its metres would still be counted. */
export function loosePipes(doc: DesignDocument, sys: DesignSystem): SystemFinding | null {
  const n = doc.objects.filter(
    (o) =>
      o.type === "pipe-run" &&
      o.systemId === sys.id &&
      (!attachOf(o.props.startAttach) || !attachOf(o.props.endAttach))
  ).length;
  if (!n) return null;
  return {
    severity: "red",
    code: "loose-pipe",
    drawing: true,
    message: n === 1 ? "A pipe isn't connected at one end" : `${n} pipes aren't connected at one end`,
    fix: "Connect it, or delete it",
  };
}

function combinationFindings(doc: DesignDocument, pack: DataPack, sys: DesignSystem): SystemFinding[] {
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
    if (sys.type === "vrf") {
      const strays = heads.filter((u) => !joinsVrf(pack, u));
      for (const u of strays)
        out.push({
          severity: "red",
          code: "not-vrf-head",
          message: `${u.model} can't join a VRF system`,
          fix: "Swap it for a VRF head, or take it out",
        });
      if (!strays.length && vrfOutdoorsListing(pack, heads, { proposing: true }).length === 0)
        out.push({
          severity: "red",
          code: "no-outdoor-lists-set",
          message: "No VRF outdoor takes this set of heads",
          fix: "Take a head out, or make one smaller",
        });
    } else if (sys.type === "multi-split") {
      // a set still under an outdoor's minimum can grow into it: not "no outdoor"
      if (outdoorsListing(pack, heads, { proposing: true }).length === 0) {
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
        /* a minimum the set is under is amber while it is being built (it
           can grow); with the outdoor chosen it is held against the system,
           as a VRF's under-ratio is — one head on a Daikin Super Multi is
           not an installation */
        if (f.severity !== "red" && !UNDER_MINIMUM.has(f.code)) continue;
        out.push({
          severity: "red",
          code: f.code,
          message: f.message.replace(/\.$/, ""),
          fix: multiFix(f.code, heads.length),
        });
      }
      const height = headHeightFinding(doc, sys, odu.model, rule.max_lift_idu_idu_m);
      if (height) out.push(height);
    }
    return out;
  }

  if (oduSpec.system_type === "vrf") {
    for (const f of checkVrfSet(pack, oduSpec, heads)) {
      if (f.severity !== "red") continue;
      out.push({
        severity: "red",
        code: f.code,
        message: f.message.replace(/\.$/, ""),
        fix:
          f.code === "not-vrf-head"
            ? "Swap it for a VRF head, or take it out"
            : f.code === "ratio-over" || f.code === "over-max-count"
              ? "Pick a bigger outdoor, or take a head out"
              : f.code === "ratio-under"
                ? /* only offer a smaller outdoor when one would take them */
                  vrfOutdoorsListing(pack, heads).length
                  ? "Add heads, or pick a smaller outdoor"
                  : `No VRF outdoor is that small. Add heads, or make ${heads.length === 1 ? "this zone a split" : "these zones a multi"}`
                : undefined,
      });
    }
    /* THE ZONES NEED MORE THAN THE OUTDOOR CAN EVER TAKE ON (Isaac,
       2026-09-29: 26.1 kW of zones on a PUMY-SP140, whose 130% is 20.15 kW,
       "an immediate red flag"). Heads past the outdoor are normal diversity;
       a load past the most heads it can carry is not a design. */
    const band = vrfBand(oduSpec);
    const load = systemCover(doc, pack, sys, doc.settings.sizingBasis).loadKw;
    const ceiling = vrfLoadCeilingKw(oduSpec, doc.settings.sizingBasis);
    if (band && load != null && ceiling != null) {
      if (!vrfTakesLoad(oduSpec, load, doc.settings.sizingBasis))
        out.push({
          severity: "red",
          code: "load-over-outdoor",
          message: `The zones need ${load.toFixed(1)} kW, and ${odu.model} takes heads up to ${+ceiling.toFixed(2)} kW (${band.ratio_max_pct}%)`,
          fix: "Pick a bigger outdoor, or move a zone to another system",
        });
    }
    /* the pipework, sized and checked against the book (vrf-tree.ts): a
       drawn tree's lengths, lifts and charge, and the fittings' rules */
    for (const f of systemVrfTree(pack, sys, doc)?.findings ?? []) {
      if (f.severity !== "red") continue;
      out.push({ severity: "red", code: f.code, message: f.message, fix: f.fix, drawing: true });
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

/** the findings that fail the combination: every red one */
export const blockingFindings = (findings: SystemFinding[]): SystemFinding[] =>
  findings.filter((f) => f.severity === "red");

/** the findings that keep the builder's Done off: the red ones about the
    units, never the drawing's (see SystemFinding.drawing) */
export const doneBlockers = (findings: SystemFinding[]): SystemFinding[] =>
  blockingFindings(findings).filter((f) => !f.drawing);

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
    it is just the figure. A VRF's percentage is the book's own, P-numbers
    over the outdoor's (vrfIndexRatio), so the card, the editor and the
    outdoor list say one figure. Null without an outdoor, or for a split. */
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
  const index = oduSpec.system_type === "vrf" ? vrfRatio(oduSpec, heads) : null;
  return {
    connectedKw,
    outdoorKw: oduSpec.capacity_cool_kw,
    pct: index ? index.pct : Math.round((connectedKw / oduSpec.capacity_cool_kw) * 100),
    heads: heads.length,
  };
}

/** what would fix a multi finding, when the finding knows */
function multiFix(code: string, heads: number): string | undefined {
  switch (code) {
    case "not-in-combination-table":
    case "over-max-count":
    case "over-per-port":
    case "over-connected":
      return "Pick an outdoor that takes them all, or take a head out";
    case "under-min-count":
      return heads === 1 ? "Add a head, or make this zone a split" : "Add a head, or pick an outdoor that takes fewer";
    case "under-connected":
      return "Add a head or a bigger one, or pick a smaller outdoor";
    case "over-matching":
      return "Swap one for another type, or pick another outdoor";
    case "excluded-combination":
      return "Change a head's size, or pick another outdoor";
    default:
      return undefined;
  }
}

/* THE HEIGHT BETWEEN HEADS (MultiRule.max_lift_idu_idu_m: Daikin's "7.5 m
   between indoor units"). Judged on where the heads are placed — their
   floor's height in the stack plus their own height on it (graph.ts), the
   same reading the VRF tree makes. A head not on the plan isn't judged, and
   a rule that records no figure checks nothing. It is about placement, not
   the units chosen, so it never keeps the builder's Done off. */
function headHeightFinding(
  doc: DesignDocument,
  sys: DesignSystem,
  oduModel: string,
  limitM: number | undefined
): SystemFinding | null {
  if (limitM == null) return null;
  const base = floorBasesM(doc.floors);
  const ids = new Set(allocationsOf(sys).filter((a) => a.role === "idu" && a.model).map((a) => a.id));
  const levels = doc.objects
    .filter((o) => ids.has(o.id) && o.type === "unit")
    .map((o) => (base.get(o.floorId) ?? 0) + mountOf(o));
  if (levels.length < 2) return null;
  const spread = Math.max(...levels) - Math.min(...levels);
  if (spread <= limitM + 1e-9) return null;
  return {
    severity: "red",
    code: "head-height-over",
    drawing: true,
    message: `Two heads are ${+spread.toFixed(1)} m apart in height, over ${oduModel}'s ${limitM} m between indoor units`,
    fix: "Move a head, or put the far one on its own system",
  };
}
