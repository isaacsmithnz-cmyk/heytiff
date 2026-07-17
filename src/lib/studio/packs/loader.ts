/* Design Studio — data-pack loader (Stage 2).
   Merge-aware from day one (universal-table-schema.md — Storage & validation):
   resolve = overlay over base. The overlay is empty today; company overlays
   are a Later feature, but retrofitting merging into a single-source loader is
   painful, so the seam exists now at near-zero cost.

   Pure + I/O-injected: `assemblePack` turns parsed section arrays into a
   DataPack; `mergePacks` overlays one pack onto another by row key; the actual
   file/bundle reading is a thin adapter (`loadPack`) around a supplied reader,
   so the merge logic is unit-testable with no filesystem. */

import {
  PACK_SECTIONS,
  emptyPack,
  type DataPack,
  type PackMeta,
  type PackSection,
} from "./schema";
import { migratePack } from "./migrations";

/** Parsed contents of one pack directory: `meta.json` + one array per section
    file present (missing files → empty section). */
export interface PackSource {
  meta: PackMeta;
  sections: Partial<Record<PackSection, unknown[]>>;
}

/** Build a full DataPack from one source, defaulting absent sections to []. */
export function assemblePack(source: PackSource): DataPack {
  const pack = emptyPack(source.meta);
  for (const section of PACK_SECTIONS) {
    const rows = source.sections[section];
    if (Array.isArray(rows)) {
      // typed at the section boundary; validatePack guards the contents
      (pack[section] as unknown[]) = rows;
    }
  }
  return pack;
}

/** The identity key for a row within its section — what an overlay overrides. */
export function rowKey(section: PackSection, row: unknown): string {
  const r = row as Record<string, unknown>;
  switch (section) {
    case "brands":
      return String(r.id);
    case "pair_tables":
      return `${r.idu_model}+${r.odu_model}`;
    case "multi_rules":
      return String(r.odu_model_ref);
    case "vrf_pipe_tables":
      return String(r.series);
    case "parts":
    case "indoor_units":
    case "outdoor_units":
    case "grilles":
    case "zoning_controllers":
    case "ventilation_units":
    case "accessories":
      return String(r.model ?? r.vendor ?? JSON.stringify(r));
    default:
      // duct_components / consumables have no natural key — identity by content
      return JSON.stringify(r);
  }
}

/** Overlay `over` onto `base`: a `over` row with the same key replaces the
    base row (in place, preserving order); new keys append. Overlay wins,
    base is untouched. Meta comes from the overlay (it pins the resolved id). */
export function mergePacks(base: DataPack, over: DataPack): DataPack {
  const out = emptyPack(over.meta);
  for (const section of PACK_SECTIONS) {
    const baseRows = base[section] as unknown[];
    const overRows = over[section] as unknown[];
    const overByKey = new Map<string, unknown>();
    for (const row of overRows) overByKey.set(rowKey(section, row), row);

    const merged: unknown[] = [];
    const consumed = new Set<string>();
    for (const row of baseRows) {
      const k = rowKey(section, row);
      if (overByKey.has(k)) {
        merged.push(overByKey.get(k));
        consumed.add(k);
      } else {
        merged.push(row);
      }
    }
    for (const row of overRows) {
      const k = rowKey(section, row);
      if (!consumed.has(k)) merged.push(row);
    }
    (out[section] as unknown[]) = merged;
  }
  return out;
}

/** Reads one section file's parsed JSON (array), or null if absent. Injected
    so the loader has no filesystem/bundle dependency of its own. */
export type SectionReader = (
  dir: string,
  section: PackSection
) => Promise<unknown[] | null>;

/** Read + assemble one pack directory (`data/packs/<brand>@<version>/`). */
export async function loadPackDir(
  dir: string,
  meta: PackMeta,
  read: SectionReader
): Promise<DataPack> {
  const sections: PackSource["sections"] = {};
  for (const section of PACK_SECTIONS) {
    const rows = await read(dir, section);
    if (rows) sections[section] = rows;
  }
  // migrate at the load boundary so an old pinned pack upgrades before use
  return migratePack(assemblePack({ meta, sections })).pack;
}

/** Resolve the packs a design pins into one merged DataPack: shared base(s)
    first, then the brand pack, then the optional company overlay — later wins.
    (Designs store base + overlay versions; the overlay is empty for now.) */
export function resolvePacks(layers: DataPack[]): DataPack {
  if (layers.length === 0) throw new Error("resolvePacks: no layers");
  return layers.reduce((base, over) => mergePacks(base, over));
}
