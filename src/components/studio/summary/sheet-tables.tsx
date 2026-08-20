/* The sheet's shared FORMATTING — how a figure and a verdict are written,
   in the one place all three chromes read it from.

   This file used to hold the table bodies too, and they have moved into
   sheet-doc.tsx along with everything else about the document's shape: the
   screen, the customer's live link and the printed copy now render one
   component rather than three arrangements of the same rows. What is left is
   what is genuinely shared and genuinely not layout.

   Everything here renders; summary.ts computes. */

import type { SheetGroup, SummaryRoomRow } from "@/lib/studio/summary";

export const fmt = (n: number | null, unit: string): string =>
  n == null ? "—" : `${n % 1 === 0 ? n : n.toFixed(1)} ${unit}`;
export const pct = (n: number | null): string => (n == null ? "—" : `${n}%`);

/** covered / short / unknown → the cell's state class. Semantic, and
    deliberately not the page accent (see the design-system note in memory). */
export const tone = (
  status: SummaryRoomRow["status"],
  value: number | null
): string => (value == null ? "na" : status === "covered" ? "ok" : "under");

/** Consumables split by shelf, in the order somebody works down a van: pipe,
    electrical, then everything that bolts on. The GROUPING is derived
    (summary.ts) — this only decides the order the shelves appear in and what
    they are called. An empty shelf renders nothing rather than an empty card:
    "Electrical — nothing" is not a fact about this job. */
export const SHEET_GROUPS: { key: SheetGroup; label: string }[] = [
  { key: "pipe", label: "Pipe" },
  { key: "electrical", label: "Electrical" },
  { key: "components", label: "Components" },
];
