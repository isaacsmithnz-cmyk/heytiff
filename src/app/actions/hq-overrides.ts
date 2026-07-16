"use server";

import { requireHq } from "@/lib/hq/guard";
import { latestPackRef } from "@/lib/hq/packs";
import { loadInstalledPack } from "@/lib/studio/packs/server";
import {
  fetchOverrides,
  upsertOverride,
  deleteOverride,
  logOverride,
} from "@/lib/studio/packs/overrides-server";
import { applyOverrides, newValidationErrors } from "@/lib/studio/packs/overrides";
import { fieldSpec, validateFieldValue } from "@/lib/studio/packs/fields";
import { validatePack } from "@/lib/studio/packs/validate";
import { rowKey } from "@/lib/studio/packs/loader";
import type { DataPack, PackSection } from "@/lib/studio/packs/schema";
import type { SaveInput, ClearInput, SaveResult } from "@/components/hq/edit-types";

/* HQ universal-table edits — Server Actions. brand is bound per-pack at the page
   (saveOverride.bind(null, brand)). Every action re-guards (POST-reachable),
   validates against the field registry, and — for saves — refuses to introduce
   a NEW pack validation error vs the current baseline. Expected failures return
   { ok:false, error } for the popover; only auth failures throw. */

async function latestVersion(brand: string): Promise<string | null> {
  return (await latestPackRef(brand))?.version ?? null;
}

function rows(pack: DataPack, section: string): Record<string, unknown>[] {
  return (pack as unknown as Record<string, unknown[]>)[section] as Record<
    string,
    unknown
  >[];
}

function rowExists(pack: DataPack, section: string, key: string): boolean {
  return rows(pack, section).some((r) => rowKey(section as PackSection, r) === key);
}

function readValue(
  pack: DataPack,
  section: string,
  key: string,
  field: string
): number | string | string[] | null {
  const row = rows(pack, section).find(
    (r) => rowKey(section as PackSection, r) === key
  );
  const v = row?.[field];
  if (typeof v === "number" || typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return null;
}

export async function saveOverride(
  brand: string,
  input: SaveInput
): Promise<SaveResult> {
  const { email } = await requireHq();

  const spec = fieldSpec(input.section, input.field);
  if (!spec) return { ok: false, error: "Field is not editable" };
  const valid = validateFieldValue(spec, input.value);
  if (!valid.ok) return { ok: false, error: valid.error };

  const version = await latestVersion(brand);
  if (!version) return { ok: false, error: "No installed pack for this brand" };
  const { pack } = await loadInstalledPack(brand, version);
  if (!rowExists(pack, input.section, input.rowKey)) {
    return { ok: false, error: "Row not found in pack" };
  }

  const existing = await fetchOverrides(brand);
  const baseline = applyOverrides(pack, existing);
  const candidate = applyOverrides(baseline, [
    {
      section: input.section,
      rowKey: input.rowKey,
      field: input.field,
      value: valid.value,
    },
  ]);

  const introduced = newValidationErrors(
    validatePack(baseline).errors,
    validatePack(candidate).errors
  );
  if (introduced.length) return { ok: false, error: `Rejected: ${introduced[0].message}` };

  const oldValue = readValue(baseline, input.section, input.rowKey, input.field);
  await upsertOverride({
    brand,
    packVersion: version,
    section: input.section,
    rowKey: input.rowKey,
    field: input.field,
    value: valid.value,
    enteredBy: email,
  });
  await logOverride({
    brand,
    section: input.section,
    rowKey: input.rowKey,
    field: input.field,
    action: "set",
    oldValue,
    newValue: valid.value,
    enteredBy: email,
  });
  return { ok: true };
}

export async function clearOverride(
  brand: string,
  input: ClearInput
): Promise<SaveResult> {
  const { email } = await requireHq();

  const version = await latestVersion(brand);
  if (!version) return { ok: false, error: "No installed pack for this brand" };
  const { pack } = await loadInstalledPack(brand, version);

  const existing = await fetchOverrides(brand);
  const baseline = applyOverrides(pack, existing);
  const oldValue = readValue(baseline, input.section, input.rowKey, input.field);

  await deleteOverride(brand, input.section, input.rowKey, input.field);
  await logOverride({
    brand,
    section: input.section,
    rowKey: input.rowKey,
    field: input.field,
    action: "clear",
    oldValue,
    newValue: null,
    enteredBy: email,
  });
  return { ok: true };
}
