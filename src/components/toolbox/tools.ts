import { daysUntil } from "@/lib/au-dates";

/* Toolbox tool registry — single source of truth for the Toolbox screen.
   Categories mirror the v3 design's four cards (_design/shell-scripts.js
   toolbox()); tools ship here one at a time as they're built. A tool with an
   href renders as a live row linking to its /dashboard/toolbox/* page; the
   design's remaining seed tools stay out of the registry until built (their
   category shows the "No tools yet" hint instead). */

export type ToolBadge = "Popular" | "New" | "Beta";

/* How long a tool reads as New. Every tool in this registry carried a hand-set
   `badge: "New"` — all four of them, indefinitely — which is the same as none
   of them carrying one: a mark every row wears stops being a mark and becomes
   a column. The date is the fix. A tool says WHEN it shipped and the badge
   works itself out, so it can go stale but it can't lie.

   Two weeks, matching the dashboard's declined-claim nudge and for the same
   reason: past that, a thing has been seen, and a "New" tag on it is just
   decoration you have taught people to read past. One number to change. */
export const NEW_FOR_DAYS = 14;

export interface Tool {
  name: string;
  desc: string;
  href: string;
  /* The tool's own glyph, falling back to its category's. The landing screen
     gives every tool a tile, and two tiles in one category wearing the same
     icon read as a rendering fault — Running Pressures and Fault Finder both
     showed the Troubleshooting warning triangle. A tool only declares this
     when its category's glyph would be a duplicate or a lie. */
  icon?: string;
  /** ISO date this tool went live — drives the New badge, and nothing else. */
  addedOn?: string;
  /* "New" is deliberately NOT settable here: it is the one badge with a fact
     behind it, so it is derived from `addedOn` or it doesn't exist. The other
     two are editorial judgements nobody can compute — they stay by hand. */
  badge?: Exclude<ToolBadge, "New">;
}

export interface ToolCategory {
  key: string;
  title: string;
  sub: string;
  icon: string; // shell icon.tsx name
  /* Identity, never meaning — hex, and it must stay outside the semantic set.
     Troubleshooting wore #FF3366 (the app's danger red) from the v3 design, so
     a perfectly healthy shelf of two working tools rendered as an alert; the
     rule everywhere else in the app is that ok-teal and danger-red belong to
     STATE and nothing else. Design moved off #2E68FF at the same time, since
     Troubleshooting had to land somewhere and two categories sharing a colour
     is the same as neither having one. Cool ramp, four steps, no overlap with
     --wb2-ok / --wb2-dan / --wb2-warn. */
  accent: string;
  tools: Tool[];
}

/** Badge chip colours (bg, fg) — from the v3 design's badge map. */
export const BADGE_COLORS: Record<ToolBadge, [string, string]> = {
  Popular: ["rgba(0,229,192,0.1)", "#00A389"],
  New: ["rgba(46,104,255,0.1)", "#2E68FF"],
  Beta: ["rgba(255,51,102,0.1)", "#FF3366"],
};

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    key: "calculators",
    title: "Calculators",
    sub: "Precise field calculations",
    icon: "calc",
    accent: "#00E5C0",
    tools: [
      {
        name: "Heat Load",
        desc: "Instant room sizing check",
        href: "/dashboard/toolbox/heat-load",
        addedOn: "2026-07-18",
      },
    ],
  },
  {
    key: "troubleshooting",
    title: "Troubleshooting",
    sub: "Diagnose & resolve",
    icon: "alert",
    accent: "#2E68FF",
    tools: [
      {
        name: "Running Pressures",
        desc: "Expected pressures & diagnosis",
        href: "/dashboard/toolbox/running-pressures",
        icon: "gauge",
        addedOn: "2026-07-18",
      },
      {
        name: "Fault Finder",
        desc: "Guided step-by-step diagnosis",
        href: "/dashboard/toolbox/troubleshooting",
        addedOn: "2026-07-18",
      },
    ],
  },
  {
    key: "design",
    title: "Design Tools",
    sub: "System design & layout",
    icon: "layers",
    accent: "#007fa8",
    tools: [],
  },
  {
    key: "reference",
    /* "Reference Library" until the naming pass: the app had four things
       called a library, and the only one that should own the word outright is
       Tiff's, which is an actual library of documents. This is a shelf of
       reference TOOLS, so it says what it is. */
    title: "Reference",
    sub: "Specs & standards",
    icon: "library",
    accent: "#8A2BE2",
    tools: [
      {
        name: "Outdoor Unit Placement",
        desc: "Where it can sit — NSW",
        href: "/dashboard/toolbox/outdoor-unit",
        addedOn: "2026-07-24",
      },
    ],
  },
];

/** Which badge a tool wears today, if any.

    New wins when it applies: a tool can be both new and in beta, and "just
    landed" is the more useful of the two to someone scanning the list. Pure and
    date-in, so the whole rule is one testable function and the screen only ever
    renders what it returns. */
export function toolBadge(tool: Tool, today: string): ToolBadge | null {
  if (tool.addedOn && daysUntil(tool.addedOn, today) > -NEW_FOR_DAYS) return "New";
  return tool.badge ?? null;
}

/** Case-insensitive name+desc match used by the Toolbox search box. */
export function toolMatches(tool: Tool, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (tool.name + " " + tool.desc).toLowerCase().includes(q);
}

/* ─────────────────── the landing screen's shape ───────────────────

   THE TILE IS THE TOOL, NOT THE CATEGORY. The old landing gave each category
   a card and each tool a row inside it, which meant four tools lived in three
   containers: a 54px gradient chip, a 20px title, a subtitle and a count pill
   to introduce one or two 15px links, and a 2-column grid of three cards that
   could only ever be ragged. The taxonomy was bigger than the inventory.

   Categories still exist — they are how a tool is found once there are twenty
   — but they cost a filter chip now instead of a card. */

/** One tool, carrying the category it belongs to. */
export interface ShelvedTool {
  tool: Tool;
  cat: ToolCategory;
}

/** Every live tool in registry order, each with its category attached. */
export function allTools(): ShelvedTool[] {
  return TOOL_CATEGORIES.flatMap((cat) => cat.tools.map((tool) => ({ tool, cat })));
}

/** The glyph a tool's tile wears — its own, or its category's. */
export function toolIcon({ tool, cat }: ShelvedTool): string {
  return tool.icon ?? cat.icon;
}

/** A filter chip: a category that has at least one tool matching the search.

    Counts are of the SEARCH RESULT, not the registry, so a chip can never
    read "2" over a grid the search has emptied. A category the search has
    wiped out loses its chip entirely rather than sitting there at zero. */
export interface CategoryChip {
  key: string;
  title: string;
  accent: string;
  count: number;
}

export function categoryChips(query: string): CategoryChip[] {
  return TOOL_CATEGORIES.map((c) => ({
    key: c.key,
    title: c.title,
    accent: c.accent,
    count: c.tools.filter((t) => toolMatches(t, query)).length,
  })).filter((c) => c.count > 0);
}

/** The tiles to draw, for a search and a chosen category ("all" or a key).

    `category` is a REQUEST, not a guarantee: search runs first, and if it has
    emptied the chosen category then that chip is already gone from the row,
    so honouring the request would leave the screen filtered by something the
    user can no longer see or undo. It falls back to everything the search
    found — the same rule `categoryChips` uses to decide what to render, kept
    here so the two can't disagree. */
export function visibleTools(query: string, category: string): ShelvedTool[] {
  const matched = allTools().filter(({ tool }) => toolMatches(tool, query));
  const inCategory = matched.filter(({ cat }) => cat.key === category);
  return inCategory.length > 0 ? inCategory : matched;
}
