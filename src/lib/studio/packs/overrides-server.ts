/* HQ manual overrides — the IO layer (server only).

   Reads/writes the `pack_overrides` current-state table and the append-only
   `pack_override_log` audit trail, and provides override-aware pack loaders that
   the studio engine and the customer data-library both go through, so a staff
   correction feeds pairing / sim / readiness everywhere.

   Kept separate from server.ts (which stays Supabase-free so its jest suite runs
   without env) and from the pure applyOverrides (overrides.ts). */

import { supabaseAdmin } from "@/lib/supabase-server";
import { applyOverrides, type FieldOverride } from "./overrides";
import { validatePack } from "./validate";
import { completenessByRange } from "./ready";
import { resolvePacks } from "./loader";
import { loadInstalledPack, type LoadedPack } from "./server";
import type { DataPack } from "./schema";

type OverrideRow = {
  section: string;
  row_key: string;
  field: string;
  value: number | string | string[];
  entered_by: string;
  entered_at: string;
};

/** All staff overrides for a brand (applied across every installed version). */
export async function fetchOverrides(brand: string): Promise<FieldOverride[]> {
  const { data, error } = await supabaseAdmin
    .from("pack_overrides")
    .select("section, row_key, field, value, entered_by, entered_at")
    .eq("brand", brand);
  if (error) throw new Error(error.message);
  return (data as OverrideRow[]).map((r) => ({
    section: r.section,
    rowKey: r.row_key,
    field: r.field,
    value: r.value,
    by: r.entered_by,
    at: r.entered_at,
  }));
}

export interface OverrideWrite {
  brand: string;
  packVersion: string;
  section: string;
  rowKey: string;
  field: string;
  value: number | string | string[];
  enteredBy: string;
}

/** Upsert the current-state override (last write wins per brand/section/row/field). */
export async function upsertOverride(o: OverrideWrite): Promise<void> {
  const { error } = await supabaseAdmin.from("pack_overrides").upsert(
    {
      brand: o.brand,
      pack_version: o.packVersion,
      section: o.section,
      row_key: o.rowKey,
      field: o.field,
      value: o.value,
      entered_by: o.enteredBy,
      entered_at: new Date().toISOString(),
    },
    { onConflict: "brand,section,row_key,field" }
  );
  if (error) throw new Error(error.message);
}

export async function deleteOverride(
  brand: string,
  section: string,
  rowKey: string,
  field: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("pack_overrides")
    .delete()
    .eq("brand", brand)
    .eq("section", section)
    .eq("row_key", rowKey)
    .eq("field", field);
  if (error) throw new Error(error.message);
}

export interface OverrideLogEvent {
  brand: string;
  section: string;
  rowKey: string;
  field: string;
  action: "set" | "clear";
  oldValue: number | string | string[] | null;
  newValue: number | string | string[] | null;
  enteredBy: string;
}

/** Append one audit-trail event (every set/clear, by whom, old → new). */
export async function logOverride(e: OverrideLogEvent): Promise<void> {
  const { error } = await supabaseAdmin.from("pack_override_log").insert({
    brand: e.brand,
    section: e.section,
    row_key: e.rowKey,
    field: e.field,
    action: e.action,
    old_value: e.oldValue,
    new_value: e.newValue,
    entered_by: e.enteredBy,
  });
  if (error) throw new Error(error.message);
}

/** loadInstalledPack + staff overrides applied, with validation/completeness
    recomputed on the EFFECTIVE pack. The single entry point the engine and the
    data-library use so their readiness always reflects manual corrections. */
export async function loadPackWithOverrides(
  brand: string,
  version: string,
  baseDir?: string
): Promise<LoadedPack> {
  const loaded = await loadInstalledPack(brand, version, baseDir);
  const overrides = await fetchOverrides(brand);
  if (overrides.length === 0) return loaded;
  const pack = applyOverrides(loaded.pack, overrides);
  return {
    meta: loaded.meta,
    pack,
    validation: validatePack(pack),
    completeness: completenessByRange(pack),
  };
}

/** Override-aware equivalent of resolveDesignPacks — the packPins → live pack
    bridge for the studio engine, with corrections merged in per layer. */
export async function resolveDesignPacksWithOverrides(
  packPins: Record<string, string>,
  baseDir?: string
): Promise<DataPack | null> {
  const layers: DataPack[] = [];
  for (const [brand, version] of Object.entries(packPins)) {
    const { pack } = await loadPackWithOverrides(brand, version, baseDir);
    layers.push(pack);
  }
  return layers.length ? resolvePacks(layers) : null;
}
