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

/* Blocked is first-class (decision P4, 2026-08-01): a job that WANTS to move
   but can't is different news from one deliberately parked. Blocking requires
   a reason and who it's waiting on; on_hold stays quiet. */
export const PROJECT_STATUSES = ["active", "blocked", "on_hold", "done", "archived"] as const;
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

/* ── stage advance: manual, checklist-aware (decision P5) ──

   A PERSON moves the stage; ticks are facts, never levers. The checklist
   informs the move two ways: a NUDGE when the section that maps to the
   current stretch of the pipeline is fully ticked, and a WARN (never a
   block) when advancing would leave items behind. Custom sections someone
   added to a project's checklist never gate anything — only the seeded four
   speak for the pipeline. */

/** Which stages each seeded section speaks for, in pipeline order. The LAST
    stage in each list is the one a completed section nudges out of —
    "Approval & prep all ticked" says leave Pre-install, not leave Quote. */
export const SECTION_STAGES: readonly { section: string; stages: readonly ProjectStage[] }[] = [
  { section: "Approval & prep", stages: ["Quote", "Approved", "Pre-install"] },
  { section: "On the tools", stages: ["Rough-in", "Fit-off"] },
  { section: "Commissioning", stages: ["Commission"] },
  { section: "Handover", stages: ["Handover"] },
];

export function stageIndex(stage: string): number {
  return (PROJECT_STAGES as readonly string[]).indexOf(stage);
}

export function nextStage(stage: string): ProjectStage | null {
  const i = stageIndex(stage);
  if (i < 0 || i >= PROJECT_STAGES.length - 1) return null;
  return PROJECT_STAGES[i + 1];
}

export type StageAdvice = {
  next: ProjectStage | null;
  /** The section whose completion signals this stage is finished — null for
      stages with no checklist voice (Quote, Approved, Rough-in, Complete). */
  gateSection: string | null;
  sectionDone: number;
  sectionTotal: number;
  /** Section exists, has items, and every one is ticked — offer the move. */
  nudge: boolean;
  /** Items still unticked in every section at or before this stage — the
      honest count behind "advance anyway?". */
  leftBehind: number;
};

/** Unticked items in every section that should be finished before BEING at
    `target` — sections whose final stage sits before it. This is the honest
    count behind "advance anyway?", and it works for jumps: Quote → Fit-off
    owes everything Rough-in owed plus its own. */
export function leftBehindFor(
  target: string,
  items: readonly { section: string; done: boolean }[]
): number {
  const at = stageIndex(target);
  if (at < 0) return 0;
  const owed = new Set(
    SECTION_STAGES.filter((m) => stageIndex(m.stages[m.stages.length - 1]) < at).map(
      (m) => m.section
    )
  );
  return items.filter((i) => owed.has(i.section) && !i.done).length;
}

export function stageAdvice(
  stage: string,
  items: readonly { section: string; done: boolean }[]
): StageAdvice {
  const next = nextStage(stage);

  let gateSection: string | null = null;
  for (const m of SECTION_STAGES) {
    if (m.stages[m.stages.length - 1] === stage) gateSection = m.section;
  }

  const inSection = gateSection ? items.filter((i) => i.section === gateSection) : [];
  const sectionDone = inSection.filter((i) => i.done).length;
  const sectionTotal = inSection.length;

  return {
    next,
    gateSection,
    sectionDone,
    sectionTotal,
    nudge: next !== null && sectionTotal > 0 && sectionDone === sectionTotal,
    // What should be finished before LEAVING this stage = what the next
    // stage is owed. Complete has no next; nothing is "left behind" by
    // standing still at the end.
    leftBehind: next ? leftBehindFor(next, items) : 0,
  };
}
