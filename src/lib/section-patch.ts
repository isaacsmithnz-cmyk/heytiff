/* Generic per-section patch builder — the shared core behind the staff card's
   buildPatch and the organisation profile's. One section = one card = one
   allowlist of writable columns; anything outside it is dropped silently
   (the caller has already decided the section is legitimate; this decides the
   columns). Dates arrive as dd/mm/yyyy text and convert to ISO; unparseable
   ones are reported back so the UI can say which field, rather than quietly
   discarding what the user typed. Enum columns guard CHECK constraints — a
   bad value is dropped rather than becoming a 500 on write. */

import { parseAuDate } from "./au-dates";

export type SectionConfig = {
  sections: Record<string, readonly string[]>;
  dateColumns: ReadonlySet<string>;
  enums?: Record<string, readonly string[]>;
  /** Enum columns where an empty submission CLEARS the value (nullable column,
      e.g. org state). Absent -> empty is dropped instead (NOT NULL column,
      e.g. staff status, where null would violate the constraint). */
  nullableEnums?: ReadonlySet<string>;
};

export function isSectionOf(config: SectionConfig, v: unknown): v is string {
  return typeof v === "string" && Object.hasOwn(config.sections, v);
}

export function buildSectionPatch(
  config: SectionConfig,
  section: string,
  entries: Iterable<[string, string]>
): { patch: Record<string, string | null>; invalid: string[] } {
  const allowed = new Set<string>(config.sections[section] ?? []);
  const patch: Record<string, string | null> = {};
  const invalid: string[] = [];

  for (const [key, raw] of entries) {
    if (!allowed.has(key)) continue;
    const value = typeof raw === "string" ? raw.trim() : "";

    if (config.dateColumns.has(key)) {
      if (!value) {
        patch[key] = null;
        continue;
      }
      const iso = parseAuDate(value);
      if (!iso) {
        invalid.push(key);
        continue;
      }
      patch[key] = iso;
      continue;
    }

    const enumVals = config.enums?.[key];
    if (enumVals) {
      if (enumVals.includes(value)) patch[key] = value;
      else if (value === "" && config.nullableEnums?.has(key)) patch[key] = null;
      // anything else (junk, or empty on a NOT NULL enum) is dropped
      continue;
    }

    patch[key] = value === "" ? null : value;
  }

  return { patch, invalid };
}
