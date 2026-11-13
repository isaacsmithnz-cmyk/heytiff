/* HOW TO DESIGN (Isaac, 13 November 2026: "Build it" to the Help mock, with
   step 4 fixed: a system's kind is its Family, picked at Build system, not
   at Add system). The Studio's eight steps in order, each marked done, the
   one you're on, or still to come, off the design itself: the same ladder
   the Next chip climbs (next-move.ts), with the set-up steps before it. */

import type { DataPack } from "./packs/schema";
import type { DesignDocument } from "./document";
import { allocationsOf, hasAllocations } from "./builder";
import { installState } from "./install";
import { setupNeeds } from "./plan-set";
import { zoneIdsOf } from "./zones";

export type HelpState = "done" | "now" | "todo";

export interface HelpStep {
  title: string;
  line: string;
  state: HelpState;
}

const STEPS: { title: string; line: string }[] = [
  { title: "Plans", line: "Add the job’s plans. Tiff reads them and finds the rooms." },
  { title: "Scale and north", line: "Draw a line over a dimension you know, then point north (N)." },
  { title: "Zones", line: "Keep the rooms Tiff found, or draw each one with Zone. Give each its load." },
  { title: "Add a system", line: "Press Add system, once for each system the job needs." },
  { title: "Add zones", line: "Click each room on the plan the system serves." },
  {
    title: "Build system",
    line: "Pick its family: split, multi, ducted or VRF. Then pick the indoor and outdoor units and place them on the plan.",
  },
  { title: "Install details", line: "Answer the install questions, then draw the pipe with Pipe (P)." },
  { title: "Summary", line: "Check the parts and the price, then share the design sheet." },
];

/** what each step has, off the design; the first not done is the one you're
    on. A design drawn on a blank floor has no plans to add or scale. */
export function helpSteps(doc: DesignDocument, pack: DataPack | null): HelpStep[] {
  const rooms = doc.objects.some((o) => o.type === "room");
  const hasPlans = doc.floors.some((f) => f.plans.length > 0);
  const needs = setupNeeds(doc);
  const systems = doc.systems;
  const placed = new Set(doc.objects.map((o) => o.id));
  const built = (s: (typeof systems)[number]) =>
    hasAllocations(s) && allocationsOf(s).some((a) => a.model) && allocationsOf(s).every((a) => !a.model || placed.has(a.id));
  const done = [
    hasPlans || rooms,
    hasPlans ? needs.scale.length === 0 && needs.north.length === 0 : rooms,
    rooms,
    systems.length > 0,
    systems.length > 0 && systems.every((s) => zoneIdsOf(s).length > 0),
    systems.length > 0 && systems.every(built),
    pack != null && systems.length > 0 && systems.every((s) => installState(doc, pack, s) === "complete"),
    false,
  ];
  const now = done.indexOf(false);
  return STEPS.map((s, i) => ({ ...s, state: done[i] ? "done" : i === now ? "now" : "todo" }));
}

/** the keys on the plan, as the Help lists them */
export const HELP_KEYS: [string, string][] = [
  ["Scroll", "Zoom, or move around: View, Scrolling"],
  ["Space and drag", "Move around"],
  ["Shift", "Straight lines"],
  ["[ and ]", "Turn the unit you picked"],
  ["Esc", "Stop drawing"],
  ["Delete", "Remove what you picked"],
  ["⌘Z", "Undo, with Shift to redo"],
];
