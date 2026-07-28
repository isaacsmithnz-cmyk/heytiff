/* The project pipeline and the default checklist — code-defined, pure.

   STAGES ARE DATA, NOT SCHEMA. The column is text and this list is the
   validator, because the trade's real flow gets tweaked ("add a Defects
   stage") and that must be an edit here, not a migration. Order matters: the
   stepper renders this array left to right, and "how far along" comparisons
   use the index.

   THE DEFAULT CHECKLIST IS A SEED, NOT A LAW. createProject copies it into
   project_checklist_items once; every project edits its own rows freely.
   The Handover section is the reason the feature exists — "were the manuals
   left, did someone walk the customer through it" is exactly what goes
   missing between the last site day and the invoice. Org-editable templates
   are a later phase; these defaults are the opinionated starting point. */

export const PROJECT_STAGES = [
  "Quote",
  "Approved",
  "Pre-install",
  "Rough-in",
  "Fit-off",
  "Commission",
  "Handover",
  "Complete",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export function isProjectStage(v: unknown): v is ProjectStage {
  return typeof v === "string" && (PROJECT_STAGES as readonly string[]).includes(v);
}

export const PROJECT_STATUSES = ["active", "on_hold", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
}

export type ChecklistSeed = { section: string; label: string };

export const DEFAULT_CHECKLIST: readonly ChecklistSeed[] = [
  { section: "Approval & prep", label: "Quote accepted & deposit received" },
  { section: "Approval & prep", label: "Site access & induction sorted" },
  { section: "Approval & prep", label: "Equipment ordered" },
  { section: "Approval & prep", label: "Materials & consumables ordered" },

  { section: "On the tools", label: "Rough-in complete" },
  { section: "On the tools", label: "Penetrations sealed & weatherproofed" },
  { section: "On the tools", label: "Condensate run & tested" },
  { section: "On the tools", label: "Fit-off complete" },

  { section: "Commissioning", label: "Pressure-tested & vacuumed" },
  { section: "Commissioning", label: "Commissioning sheet completed" },
  { section: "Commissioning", label: "Controls configured & labelled" },

  { section: "Handover", label: "Manuals left with the customer" },
  { section: "Handover", label: "Customer walkthrough done" },
  { section: "Handover", label: "Warranty registered" },
  { section: "Handover", label: "Site left clean — rubbish & offcuts gone" },
];

/** done/total for a progress bar; empty lists read as 0, not NaN. */
export function checklistProgress(items: readonly { done: boolean }[]): {
  done: number;
  total: number;
  percent: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
