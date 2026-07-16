import type { EditableSection, FieldValue } from "@/lib/studio/packs/fields";

/* The editor ↔ server-action protocol for HQ universal-table edits. Pure types
   in their own module so UI files can be reorganised without breaking the
   actions' imports (hq-overrides.ts) or vice versa. */

export type SaveResult = { ok: true } | { ok: false; error: string };

export type SaveInput = {
  section: EditableSection;
  rowKey: string;
  field: string;
  /** scalar for value fields; string[] for tags (system_roles) */
  value: FieldValue;
};

export type ClearInput = {
  section: EditableSection;
  rowKey: string;
  field: string;
};
