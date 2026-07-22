/* Toolbox tool registry — single source of truth for the Toolbox screen.
   Categories mirror the v3 design's four cards (_design/shell-scripts.js
   toolbox()); tools ship here one at a time as they're built. A tool with an
   href renders as a live row linking to its /dashboard/toolbox/* page; the
   design's remaining seed tools stay out of the registry until built (their
   category shows the "No tools yet" hint instead). */

export type ToolBadge = "Popular" | "New" | "Beta";

export interface Tool {
  name: string;
  desc: string;
  href: string;
  badge?: ToolBadge;
}

export interface ToolCategory {
  key: string;
  title: string;
  sub: string;
  icon: string; // shell icon.tsx name
  accent: string; // hex, matches the v3 category colours
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
        badge: "New",
      },
    ],
  },
  {
    key: "troubleshooting",
    title: "Troubleshooting",
    sub: "Diagnose & resolve",
    icon: "alert",
    accent: "#FF3366",
    tools: [
      {
        name: "Running Pressures",
        desc: "Expected pressures & diagnosis",
        href: "/dashboard/toolbox/running-pressures",
        badge: "New",
      },
      {
        name: "Fault Finder",
        desc: "Symptom-based diagnosis",
        href: "/dashboard/toolbox/troubleshooting",
        badge: "New",
      },
    ],
  },
  {
    key: "design",
    title: "Design Tools",
    sub: "System design & layout",
    icon: "layers",
    accent: "#2E68FF",
    tools: [],
  },
  {
    key: "reference",
    title: "Reference Library",
    sub: "Specs & standards",
    icon: "library",
    accent: "#8A2BE2",
    tools: [
      {
        name: "Outdoor Unit Placement",
        desc: "Where it can sit — NSW",
        href: "/dashboard/toolbox/outdoor-unit",
        badge: "New",
      },
    ],
  },
];

/** Case-insensitive name+desc match used by the Toolbox search box. */
export function toolMatches(tool: Tool, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (tool.name + " " + tool.desc).toLowerCase().includes(q);
}
