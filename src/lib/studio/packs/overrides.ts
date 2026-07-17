/* HQ manual corrections — field-level overlay over a base pack.

   `mergePacks` (loader.ts) replaces WHOLE rows by key, so it can't express a
   single-field staff edit. This applies field-level patches instead, keyed by
   the same loader `rowKey` so override identity matches merge identity exactly.

   Pure and IO-free: the DB fetch lives in overrides-server.ts. Row `provenance`
   is deliberately left untouched — the overrides table is itself the per-field
   provenance (who/when), and rewriting a row's provenance to "user-entered"
   would falsely disown the book attribution for its other fields. */

import { PACK_SECTIONS, type DataPack, type PackSection } from "./schema";
import { rowKey } from "./loader";
import type { ValidationIssue } from "./validate";

export interface FieldOverride {
  section: string; // an editable PackSection ("indoor_units" | "outdoor_units" | "pair_tables")
  rowKey: string; // loader rowKey: model, or `${idu_model}+${odu_model}`
  field: string;
  /** scalar for value fields; string[] for tag fields (system_roles) */
  value: number | string | string[];
  by?: string;
  at?: string;
}

/** Apply field-level overrides to a pack, returning a NEW pack. Only rows whose
    (section, rowKey) match an existing row are patched; overrides that match no
    row are ignored (orphans). Untouched sections/rows keep their references. */
export function applyOverrides(pack: DataPack, overrides: FieldOverride[]): DataPack {
  if (overrides.length === 0) return pack;

  // section → rowKey → (field → value)
  const bySection = new Map<string, Map<string, Map<string, FieldOverride["value"]>>>();
  for (const o of overrides) {
    let rows = bySection.get(o.section);
    if (!rows) bySection.set(o.section, (rows = new Map()));
    let fields = rows.get(o.rowKey);
    if (!fields) rows.set(o.rowKey, (fields = new Map()));
    fields.set(o.field, o.value);
  }

  const out = { ...pack } as DataPack;
  for (const section of PACK_SECTIONS) {
    const rowsForSection = bySection.get(section);
    if (!rowsForSection) continue;
    const arr = pack[section] as unknown as Record<string, unknown>[];
    let changed = false;
    const next = arr.map((row) => {
      const fields = rowsForSection.get(rowKey(section as PackSection, row));
      if (!fields) return row;
      changed = true;
      const patched = { ...row };
      for (const [f, v] of fields) patched[f] = v;
      return patched;
    });
    if (changed) (out as unknown as Record<string, unknown[]>)[section] = next;
  }
  return out;
}

/** Validation issues present in `candidate` but not in `baseline` — the save
    gate: an edit may never INTRODUCE a pack error (identity = section+row+message). */
export function newValidationErrors(
  baseline: ValidationIssue[],
  candidate: ValidationIssue[]
): ValidationIssue[] {
  const key = (i: ValidationIssue) => `${i.section}::${i.row}::${i.message}`;
  const seen = new Set(baseline.map(key));
  return candidate.filter((i) => !seen.has(key(i)));
}
