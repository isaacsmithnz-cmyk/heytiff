/* HQ manual overrides — the IO layer (server only).

   Reads/writes the `pack_overrides` current-state table and the append-only
   `pack_override_log` audit trail, and provides override-aware pack loaders that
   the studio engine goes through, so a staff correction feeds pairing / sim /
   readiness everywhere.

   Kept separate from server.ts (which stays Supabase-free so its jest suite runs
   without env) and from the pure applyOverrides (overrides.ts). */

import { supabaseAdmin } from "@/lib/supabase-server";
import { applyOverrides, type FieldOverride } from "./overrides";
import { validatePack } from "./validate";
import { completenessByRange } from "./ready";
import { latestInstalledPack, loadInstalledPack, type LoadedPack } from "./server";
import type { FieldValue } from "./fields";
import type { DataPack } from "./schema";

type OverrideRow = {
  section: string;
  row_key: string;
  field: string;
  value: FieldValue;
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
  value: FieldValue;
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
  oldValue: FieldValue | null;
  newValue: FieldValue | null;
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
    recomputed on the EFFECTIVE pack. The single entry point the engine uses so
    its readiness always reflects manual corrections. */
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


/** A brand's newest installed pack as the Studio and the quote both read
    it: HQ's corrections on, or as installed when the corrections can't be
    read; null when the brand has none. One reader, so a correction HQ makes
    reaches the design and the quote alike. A pack that won't load at all
    still throws: the caller says what that means. */
export async function correctedPack(brand: string): Promise<DataPack | null> {
  const ref = await latestInstalledPack(brand);
  if (!ref) return null;
  try {
    return (await loadPackWithOverrides(ref.brand, ref.version)).pack;
  } catch {
    return (await loadInstalledPack(ref.brand, ref.version)).pack;
  }
}
