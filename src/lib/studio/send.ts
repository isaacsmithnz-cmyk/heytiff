/* Design Studio — what goes out when the design is sent. Pure, no React.

   ONE DIALOG, TWO WAYS OUT. Share and Export were two buttons on the Summary
   with two dialogs, and neither asked the question that matters: what does
   this person get? The customer does not want the material picklist; the
   crew does. So the Send dialog asks where it goes, then who it is for, then
   lets each part be ticked on or off.

   The parts are the sheet's own sections plus three things that are not on
   the sheet: plan pages, the other options of the design, and the
   simulation. Not every way out can carry every part — see CARRIES. */

import type { SheetSections } from "./export";

export type SendPart =
  | "figures"
  | "systems"
  | "lines"
  | "plans"
  | "picklist"
  | "options"
  | "sim";

export const SEND_PARTS: readonly SendPart[] = [
  "figures",
  "systems",
  "lines",
  "plans",
  "picklist",
  "options",
  "sim",
];

export type SendDest = "pdf" | "link";

export type SendAudience = "customer" | "crew" | "office";

/* WHO IT IS FOR fills in the ticks. Isaac's calls, 2026-09-28: the customer
   gets the design without the materials; the crew keeps the heat loads,
   because they check them against the site on the day. */
export const AUDIENCE_PARTS: Record<SendAudience, readonly SendPart[]> = {
  customer: ["figures", "systems", "plans", "sim"],
  crew: ["figures", "systems", "lines", "plans", "picklist"],
  office: ["figures", "systems", "lines", "plans", "picklist", "options", "sim"],
};

/* WHAT EACH WAY OUT CAN CARRY. The live link is the customer's page: it serves
   ONE design (the token finds one row), so other options cannot ride it, and
   a customer's page never carries the picklist. Paper cannot run a
   simulation. */
const CARRIES: Record<SendDest, readonly SendPart[]> = {
  pdf: ["figures", "systems", "lines", "plans", "picklist", "options"],
  link: ["figures", "systems", "lines", "plans", "sim"],
};

/** Why this way out can't carry the part, in the words the row shows beside
    it — or null when it can. */
export function notCarried(part: SendPart, dest: SendDest): string | null {
  if (CARRIES[dest].includes(part)) return null;
  if (part === "sim") return "Link only";
  if (part === "options") return "PDF only";
  return "Not on the link";
}

/** The audience whose ticks these are, counting only the parts `open` lets
    through — a hidden row must not stop a preset reading as chosen. */
export function audienceOf(
  parts: ReadonlySet<SendPart>,
  open: (p: SendPart) => boolean
): SendAudience | null {
  const on = SEND_PARTS.filter((p) => open(p) && parts.has(p));
  for (const a of ["customer", "crew", "office"] as const) {
    const want = AUDIENCE_PARTS[a].filter(open);
    if (want.length === on.length && want.every((p) => on.includes(p))) return a;
  }
  return null;
}

export const sectionsOf = (parts: ReadonlySet<SendPart>): SheetSections => ({
  figures: parts.has("figures"),
  systems: parts.has("systems"),
  lines: parts.has("lines"),
  picklist: parts.has("picklist"),
});

/* ── the live link's scope ─────────────────────────────────────────────────
   The link shows what was ticked when it was made, and keeps showing it: a
   customer's page must not change because somebody ticked a box for a PDF.
   It rides the studio_designs row beside the token (`share_scope`).

   FLOORS ARE STORED AS THE ONES LEFT OUT, so a floor drawn after the link was
   made shows up on it — the link is a live window on the design, and a new
   floor is part of the design. */

export type LinkPart = "figures" | "systems" | "lines" | "plans" | "sim";

const LINK_PARTS: readonly LinkPart[] = ["figures", "systems", "lines", "plans", "sim"];

export interface LinkScope {
  parts: LinkPart[];
  hiddenFloorIds: string[];
}

/** What a link made before scopes existed shows: exactly what it always
    has — the sheet with its pipe and electrical, and the simulation where it
    is ticked ready. No plans, because the live sheet never had them. */
export const LEGACY_LINK_SCOPE: LinkScope = {
  parts: ["figures", "systems", "lines", "sim"],
  hiddenFloorIds: [],
};

/** Read a stored or browser-sent scope. Anything unreadable is the legacy
    scope, never an empty page and never a part the link cannot carry. */
export function parseLinkScope(raw: unknown): LinkScope {
  if (!raw || typeof raw !== "object") return LEGACY_LINK_SCOPE;
  const r = raw as { parts?: unknown; hiddenFloorIds?: unknown };
  if (!Array.isArray(r.parts)) return LEGACY_LINK_SCOPE;
  const parts = LINK_PARTS.filter((p) => (r.parts as unknown[]).includes(p));
  const hidden = Array.isArray(r.hiddenFloorIds)
    ? [
        ...new Set(
          r.hiddenFloorIds
            .filter((f): f is string => typeof f === "string" && f.length > 0)
            .map((f) => f.slice(0, 80))
        ),
      ]
        .slice(0, 50)
        .sort()
    : [];
  return { parts, hiddenFloorIds: hidden };
}

export const sameLinkScope = (a: LinkScope, b: LinkScope): boolean =>
  a.parts.join() === b.parts.join() &&
  a.hiddenFloorIds.join() === b.hiddenFloorIds.join();

/** The scope the dialog's ticks describe, for a design with these floors. */
export function linkScopeOf(
  parts: ReadonlySet<SendPart>,
  floorIds: ReadonlySet<string>,
  allFloorIds: readonly string[]
): LinkScope {
  return parseLinkScope({
    parts: LINK_PARTS.filter((p) => parts.has(p)),
    hiddenFloorIds: allFloorIds.filter((f) => !floorIds.has(f)),
  });
}

/** The floors a link shows as plans, in level order. */
export function linkFloors<F extends { id: string; level: number }>(
  scope: LinkScope,
  floors: readonly F[]
): F[] {
  if (!scope.parts.includes("plans")) return [];
  return floors
    .filter((f) => !scope.hiddenFloorIds.includes(f.id))
    .sort((a, b) => a.level - b.level);
}
