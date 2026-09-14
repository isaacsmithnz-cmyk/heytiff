/* Design Studio — the library as the start screen tells it.

   What the packs hold, arranged the way a designer asks for it: brand, then
   the kind of system, then the series ("Mitsubishi Electric, split systems,
   MSZ-AP"), with the model codes under each. And what has changed since this
   browser last looked, so a pack revision can say so on the screen that
   opens, rather than being discovered mid-design.

   ONLY WHAT THE ENGINE OFFERS. A pack row that is not engine-ready is never
   proposed to a design (ready.ts), so listing it here as "available" would
   be a lie the unit browser then contradicts. Each system group therefore
   takes its members from the same gate its engine uses: a split indoor unit
   is listed when `proposePairs` would propose it, a multi outdoor when
   `proposeMultiOdus` would, and so on. Extending a pack shows up here only
   once the rows are complete — which is also when it shows up on the canvas.

   Pure: no fs, no React, no storage. The route builds the manifest on the
   server from the packs it loaded; the card compares it with a snapshot the
   browser kept, using the two functions at the bottom. */

import type {
  DataPack,
  IndoorUnit,
  MultiRule,
  OutdoorUnit,
  PackMeta,
  SystemType,
} from "./schema";
import { indoorReadiness, outdoorReadiness } from "./ready";
import { formFactorLabel } from "../form-factors";
import { multiCapableIdus } from "../multi";

export const LIBRARY_SYSTEMS: readonly SystemType[] = ["split", "multi", "vrf"];

/* `satisfies`, not an annotation, so a fourth SystemType is a compile error
   here rather than a group that silently never renders. */
export const LIBRARY_SYSTEM_LABELS = {
  split: "Split systems",
  multi: "Multi-split",
  vrf: "VRF",
} satisfies Record<SystemType, string>;

export interface LibrarySeries {
  series: string;
  side: "indoor" | "outdoor";
  /** the form factor's name for an indoor series; null for an outdoor one */
  form: string | null;
  /** the model codes the engine offers, smallest first */
  models: string[];
}

export interface LibrarySystemGroup {
  system: SystemType;
  label: string;
  series: LibrarySeries[];
}

export interface LibraryBrand {
  id: string;
  name: string;
  version: string;
  /** always the three systems, in split → multi → vrf order; a system the
      pack has nothing ready for carries an empty `series` */
  systems: LibrarySystemGroup[];
}

export interface LibraryManifest {
  brands: LibraryBrand[];
}

/* ─────────────────────────── the manifest ─────────────────────────── */

/** capacity-ascending, then by code — the unit browser's own order */
function byCapacity(a: IndoorUnit | OutdoorUnit, b: IndoorUnit | OutdoorUnit): number {
  return a.capacity_cool_kw - b.capacity_cool_kw || a.model.localeCompare(b.model);
}

function seriesOf(
  units: readonly (IndoorUnit | OutdoorUnit)[],
  side: LibrarySeries["side"]
): LibrarySeries[] {
  const bySeries = new Map<string, (IndoorUnit | OutdoorUnit)[]>();
  for (const u of units) {
    const list = bySeries.get(u.series);
    if (list) list.push(u);
    else bySeries.set(u.series, [u]);
  }
  const out: LibrarySeries[] = [];
  for (const [series, list] of bySeries) {
    const first = [...list].sort(byCapacity)[0];
    const form =
      side === "indoor" && first && "form_factor" in first
        ? formFactorLabel(first.form_factor)
        : null;
    out.push({
      series,
      side,
      form,
      models: [...list].sort(byCapacity).map((u) => u.model),
    });
  }
  /* indoor series read by what they are, then by name; outdoor by name */
  out.sort(
    (a, b) =>
      (a.form ?? "").localeCompare(b.form ?? "") || a.series.localeCompare(b.series)
  );
  return out;
}

/** the members of one system group, by that system's own engine gate */
function groupSeries(pack: DataPack, system: SystemType): LibrarySeries[] {
  if (system === "split") {
    /* proposePairs: a pair whose indoor unit is split-ready and whose two
       rows both exist. The outdoor side is offered only through a pair, so
       an outdoor series is listed when a ready pair reaches it. */
    const idus = new Map(pack.indoor_units.map((u) => [u.model, u]));
    const odus = new Map(pack.outdoor_units.map((o) => [o.model, o]));
    const readyIdus = new Map<string, IndoorUnit>();
    const readyOdus = new Map<string, OutdoorUnit>();
    for (const pair of pack.pair_tables) {
      const idu = idus.get(pair.idu_model);
      const odu = odus.get(pair.odu_model);
      if (!idu || !odu) continue;
      if (!indoorReadiness(pack, idu).roles.split) continue;
      readyIdus.set(idu.model, idu);
      readyOdus.set(odu.model, odu);
    }
    return [
      ...seriesOf([...readyIdus.values()], "indoor"),
      ...seriesOf([...readyOdus.values()], "outdoor"),
    ];
  }
  if (system === "multi") {
    /* proposeMultiOdus: multi-ready outdoors; and the indoor units those
       outdoors' rules accept (multiCapableIdus, narrowed to the ready rules
       so an indoor unit is not listed on the strength of an outdoor the
       engine will not offer). */
    const odus = pack.outdoor_units.filter(
      (o) => o.system_type === "multi" && outdoorReadiness(pack, o).roles.multi
    );
    const rules: MultiRule[] = [];
    for (const o of odus) {
      const rule = pack.multi_rules.find((r) => r.odu_model_ref === o.model);
      if (rule) rules.push(rule);
    }
    return [
      ...seriesOf(multiCapableIdus(pack, rules), "indoor"),
      ...seriesOf(odus, "outdoor"),
    ];
  }
  /* vrf: each side's own readiness */
  return [
    ...seriesOf(
      pack.indoor_units.filter((u) => indoorReadiness(pack, u).roles["vrf-idu"]),
      "indoor"
    ),
    ...seriesOf(
      pack.outdoor_units.filter((o) => outdoorReadiness(pack, o).roles["vrf-odu"]),
      "outdoor"
    ),
  ];
}

/** The library, one brand per LOADED pack (the route hands in the newest
    installed version of each). Brands come out in name order. */
export function libraryManifest(
  packs: readonly { meta: PackMeta; pack: DataPack }[]
): LibraryManifest {
  const brands = packs.map(({ meta, pack }) => ({
    id: meta.brand,
    name: pack.brands.find((b) => b.id === meta.brand)?.name ?? meta.name,
    version: meta.version,
    systems: LIBRARY_SYSTEMS.map((system) => ({
      system,
      label: LIBRARY_SYSTEM_LABELS[system],
      series: groupSeries(pack, system),
    })),
  }));
  brands.sort((a, b) => a.name.localeCompare(b.name));
  return { brands };
}

/* ─────────────────────── what changed since last time ───────────────────────

   The browser keeps a snapshot of what it last saw — per brand, the version
   and the offered models — and the card compares the fresh manifest against
   it. No server state and no process for the extraction agent to follow: an
   extended pack, a revised version or a whole new brand all come out as the
   same kind of difference. A browser with no snapshot has nothing to compare
   and is told nothing; it simply records what it saw. */

export interface LibrarySnapshot {
  brands: Record<string, { version: string; models: string[] }>;
}

/** one key per offered model — the side is part of it because an indoor and
    an outdoor code could in principle collide, and a model offered in two
    system groups is still one model */
export const modelKey = (side: LibrarySeries["side"], model: string): string =>
  `${side}:${model}`;

export function librarySnapshot(m: LibraryManifest): LibrarySnapshot {
  const brands: LibrarySnapshot["brands"] = {};
  for (const b of m.brands) {
    const models = new Set<string>();
    for (const g of b.systems) for (const s of g.series) for (const model of s.models) models.add(modelKey(s.side, model));
    brands[b.id] = { version: b.version, models: [...models].sort() };
  }
  return { brands };
}

export interface LibraryAddition {
  series: string;
  side: LibrarySeries["side"];
  form: string | null;
  /** the new codes, smallest first */
  models: string[];
  /** every model in the series is new — the series itself arrived */
  whole: boolean;
}

export interface LibraryChange {
  brand: string;
  name: string;
  /** the version this browser last saw; null when the brand itself is new to it */
  from: string | null;
  to: string;
  added: LibraryAddition[];
  /** model keys offered before and not now (a retraction, or a row that lost a field) */
  removed: string[];
  /** every new model key, for marking the directory */
  newKeys: string[];
}

/** The brands with something to say. Empty when there is no snapshot to
    compare with, and when nothing differs. */
export function libraryChanges(
  m: LibraryManifest,
  prev: LibrarySnapshot | null
): LibraryChange[] {
  if (!prev) return [];
  const out: LibraryChange[] = [];
  for (const b of m.brands) {
    const before = prev.brands[b.id];
    const seen = new Set(before ? before.models : []);
    const now = new Set<string>();
    const added: LibraryAddition[] = [];
    const listed = new Set<string>();
    for (const g of b.systems) {
      for (const s of g.series) {
        const sKey = modelKey(s.side, s.series);
        const fresh = s.models.filter((model) => !seen.has(modelKey(s.side, model)));
        for (const model of s.models) now.add(modelKey(s.side, model));
        /* a series offered in two groups is one addition, not two */
        if (fresh.length && !listed.has(sKey)) {
          listed.add(sKey);
          added.push({
            series: s.series,
            side: s.side,
            form: s.form,
            models: fresh,
            whole: fresh.length === s.models.length,
          });
        }
      }
    }
    const removed = [...seen].filter((k) => !now.has(k)).sort();
    const from = before ? before.version : null;
    if (added.length === 0 && removed.length === 0 && from === b.version) continue;
    out.push({
      brand: b.id,
      name: b.name,
      from,
      to: b.version,
      added,
      removed,
      newKeys: [...now].filter((k) => !seen.has(k)).sort(),
    });
  }
  return out;
}

/** the model code back out of a key, for saying which ones went */
export const modelOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);
