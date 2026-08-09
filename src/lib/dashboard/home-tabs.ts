/* The five faces of Home, and the numbers on them.

   This replaces `hero-stats.ts`. The counters it fed were four tiles that said
   how many and nothing else, so reading one meant leaving the page; the tabs
   they became carry the same numbers AND the rows behind them. That is the
   whole argument for the change: a tab hides its content by definition, so the
   count has to ride on the tab or the glance — "does anything need me?" — is
   lost. `.wb2-vtn` already had the badge, danger and warning variants included.

   Urgent and Needs attention still split the SAME chip list on state, through
   the same `chipSummary` the topbar bell counts with, which is what keeps the
   two from ever double-counting an expiry or dropping one between them: a chip
   is bad or warn, never both.

   TONE IS NOT DECORATION. Only the two tabs whose count means SEVERITY take a
   colour. Noticeboard and Tasks count places and work, so they wear the plain
   grey badge — the app's rule is that red and amber never stop meaning
   "something is wrong". */

import { chipSummary, type ActionChip } from "./chips";
import type { ViewTab } from "@/components/shell/view-tabs";

export type HomeTabKey = "journal" | "urgent" | "attention" | "board" | "tasks";

/** Where a tab's rows live in full, for the "see all" door in its panel. */
export const TAB_HOME: Record<Exclude<HomeTabKey, "journal">, string> = {
  urgent: "/dashboard/action-required",
  attention: "/dashboard/action-required",
  board: "/dashboard/notices",
  tasks: "/dashboard/action-required",
};

/** Journal leads: you land on what you told Tiff, and the badges say whether
    anything else wants you. That default is only safe BECAUSE of the badges. */
export const DEFAULT_TAB: HomeTabKey = "journal";

export function homeTabs(input: {
  /** Every action-required chip the viewer may see, self and team. */
  chips: readonly ActionChip[];
  /** Open tasks assigned to the viewer. */
  openTasks: number;
  /** Unread notices currently on the board. */
  unreadNotices: number;
}): ViewTab[] {
  const s = chipSummary(input.chips);
  return [
    {
      /* No badge. It is the default tab, so a number on it counts something
         you are already looking at. */
      key: "journal",
      label: "Journal",
    },
    {
      key: "urgent",
      label: "Urgent",
      count: s.bad,
      tone: "dan",
      countLabel: (n) => `${n} past ${n === 1 ? "its date" : "their date"}`,
    },
    {
      key: "attention",
      label: "Needs attention",
      count: s.warn,
      tone: "warn",
      countLabel: (n) => `${n} coming up`,
    },
    {
      key: "board",
      label: "Noticeboard",
      count: input.unreadNotices,
      countLabel: (n) => `${n} unread`,
    },
    {
      key: "tasks",
      label: "Tasks",
      count: input.openTasks,
      countLabel: (n) => `${n} open`,
    },
  ];
}

/** Nothing anywhere. Every badge absent, which is what a clear day looks like
    in this design — there is no "all clear" panel to render, because the
    absence of five numbers IS the statement. */
export function allClear(tabs: readonly ViewTab[]): boolean {
  return tabs.every((t) => !t.count);
}
