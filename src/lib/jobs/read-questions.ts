import { defaultFloorName } from "@/lib/studio/plans";
import { suggestedRooms, type PlanWord } from "@/lib/studio/reading";
import { NOT_A_FLOOR_PLAN, pageKey, pagesWordOf, type JobPlan, type JobPlanPage } from "./plans";

/* CHECK THE READ, ONE QUESTION AT A TIME (Isaac, 26 November 2026: "make
   check the read workflow smooth", then "Yes, build it" to the mock's second
   row, https://claude.ai/artifact/Tx16qpWRbxfusq6xCEWKYn). What Tiff wasn't
   sure of in a set's floors, asked as questions, each with the pages it's
   about, Tiff's likely answer first and what each answer does to the floors.
   Two of the doubts stateOfRead (plans.ts) names are a choice of floors and
   are asked here: two pages read at one level, and a page with no rooms on
   it. The rest (a page that couldn't be read, one she didn't look at, what
   the read left out) aren't a floor to choose, and stay in the row's line. */

/** One answer: the floors it chooses, by page, as the Plans dialog's menu
    values (a level, or Not a floor plan). */
export type ReadAnswer = {
  key: string;
  /** a verb and a noun, or the page it names: "Page 8 is the Ground floor" */
  label: string;
  /** what it does to the floors, beside it */
  does: string;
  chosen: Record<number, string>;
  /** Tiff's likely answer: the main button */
  likely?: boolean;
};

export type ReadQuestion = {
  key: string;
  ask: string;
  /** the sheet titles that decide it, when the pages print them */
  why: string | null;
  /** the pages it's about, shown big */
  pages: number[];
  answers: ReadAnswer[];
};

/* a title that names a floor plan, and not a drawing of something else on
   one: a window and door plan draws the floor too (3608's page 18, "Window
   & Door Plan - GF", read as a second ground floor) */
const FLOORISH = /\bfloor\b|\bGF\b|\bLGF\b|\bL\d\b|\blevel\s*\d/i;
const NOT_THE_FLOOR = /\b(window|door|demolition|electrical|lighting|ceiling|rcp|drainage|stormwater|hydraulic|landscape|set[\s-]?out|slab|footing|framing|bracing|tiling|finishes|furniture|roof|section|elevation|site|shadow|schedule|existing)\b/i;

/** Whether a sheet's title says it's a floor plan of the house. */
export const titleSaysFloor = (title: string | null): boolean => !!title && FLOORISH.test(title) && !NOT_THE_FLOOR.test(title);

const LABEL = /^(sheet|drawing)\s*(name|title)\s*:?\s*$/i;
/** how far apart two runs of a title block's words may be and still be one line */
const SAME_LINE_PX = 12;
/** how far right of its label a title may sit */
const RIGHT_PX = 900;

/** A page's sheet title as its title block prints it, beside or under its
    "Sheet Name" label: "Ground Floor Plan - Proposed". Null where the page
    prints no such label, or its words weren't kept. */
export function sheetTitleOf(page: { words?: readonly PlanWord[] }): string | null {
  const words = page.words ?? [];
  const label = words.find((w) => LABEL.test(w.text.trim()));
  if (!label) return null;
  const isValue = (w: PlanWord) => w !== label && !/:\s*$/.test(w.text) && w.text.trim().length > 1;
  const beside = words
    .filter((w) => isValue(w) && Math.abs(w.at.y - label.at.y) <= SAME_LINE_PX && w.at.x > label.at.x && w.at.x - label.at.x <= RIGHT_PX)
    .sort((a, b) => a.at.x - b.at.x)[0];
  const under = words
    .filter((w) => isValue(w) && w.at.y > label.at.y && w.at.y - label.at.y <= 60 && Math.abs(w.at.x - label.at.x) <= 200)
    .sort((a, b) => a.at.y - b.at.y)[0];
  const title = (beside ?? under)?.text.trim().replace(/\s+/g, " ") ?? "";
  return title ? title.slice(0, 80) : null;
}

const roomsOn = (plan: JobPlan, n: number) => (plan.reading?.floors[pageKey(n)] ?? []).flatMap((s) => suggestedRooms(s));
const nameOf = (p: JobPlanPage) => p.name || defaultFloorName(p.level ?? 0);
const leave = (ns: readonly number[]) => `${pagesWordOf(ns)} ${ns.length === 1 ? "leaves" : "leave"} the floors, ${ns.length === 1 ? "its picture" : "their pictures"} kept`;
const titled = (n: number, title: string | null) => (title ? `Page ${n} is titled ${title}.` : null);

/** The questions a read set asks before its floors can be trusted, in the
    order a person settles them: which of two pages at one level is the
    floor, then whether a page with no rooms is one. A page somebody has
    already chosen asks nothing. */
export function readQuestions(plan: JobPlan): ReadQuestion[] {
  if (plan.kind === "spec" || (plan.state !== "read" && plan.state !== "check") || !plan.reading) return [];
  const floors = plan.pages.filter((p) => p.kind === "floor" && p.ref && p.level !== null && !p.picked);
  const out: ReadQuestion[] = [];
  const asked = new Set<number>();

  /* two pages, or more, read at one level */
  const atLevel = new Map<number, JobPlanPage[]>();
  for (const p of floors) atLevel.set(p.level as number, [...(atLevel.get(p.level as number) ?? []), p]);
  for (const [level, on] of atLevel) {
    if (on.length < 2) continue;
    const ns = on.map((p) => p.n);
    const name = nameOf(on[0]);
    const titles = new Map(on.map((p) => [p.n, sheetTitleOf(p)]));
    const floorish = on.filter((p) => titleSaysFloor(titles.get(p.n) ?? null));
    const likely = floorish.length === 1 ? floorish[0].n : null;
    const why = on.map((p) => titled(p.n, titles.get(p.n) ?? null)).filter(Boolean).join(" ") || null;
    out.push({
      key: `level:${level}`,
      ask: `${pagesWordOf(ns)} ${on.length === 2 ? "both" : "all"} read as ${name}. Which is the ${name} plan?`,
      why,
      pages: ns,
      answers: [
        ...on.map((p): ReadAnswer => {
          const others = ns.filter((n) => n !== p.n);
          return {
            key: `page:${p.n}`,
            label: `Page ${p.n} is the ${name}`,
            does: leave(others),
            chosen: Object.fromEntries(ns.map((n) => [n, n === p.n ? String(level) : NOT_A_FLOOR_PLAN])),
            likely: likely === p.n,
          };
        }),
        {
          key: "all",
          label: on.length === 2 ? "Both, each a part of it" : "All of them, each a part of it",
          does: `${on.length === 2 ? "Both stay" : "All stay"} at ${name}`,
          chosen: Object.fromEntries(ns.map((n) => [n, String(level)])),
        },
      ],
    });
    for (const n of ns) asked.add(n);
  }

  /* a page read as a floor with no rooms on it, or one */
  for (const p of floors) {
    if (asked.has(p.n)) continue;
    const sheets = plan.reading.floors[pageKey(p.n)];
    if (!sheets?.length) continue;
    const rooms = roomsOn(plan, p.n);
    if (rooms.length >= 2) continue;
    const name = nameOf(p);
    const title = sheetTitleOf(p);
    const room = rooms[0]?.name?.trim();
    const floor = titleSaysFloor(title);
    out.push({
      key: `rooms:${p.n}`,
      ask: `Page ${p.n} has ${room ? `one room on it, the ${room.toLowerCase()}` : "no rooms on it"}. Is it the ${name}?`,
      why: title ? `It's titled ${title}.` : null,
      pages: [p.n],
      answers: [
        { key: "keep", label: `Yes, the ${name}`, does: "It stays a floor in the designs", chosen: { [p.n]: String(p.level) }, likely: floor },
        { key: "none", label: "Not a floor plan", does: leave([p.n]), chosen: { [p.n]: NOT_A_FLOOR_PLAN }, likely: !floor && !!title },
      ],
    });
  }
  return out;
}

/** What answering a set's questions did to its floors, for the toast:
    "Page 18 left the floors". Null when every page stayed. */
export function answeredSaid(chosen: Readonly<Record<number, string>>): string | null {
  const left = Object.entries(chosen)
    .filter(([, v]) => v === NOT_A_FLOOR_PLAN)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
  return left.length ? `${pagesWordOf(left)} left the floors` : null;
}
