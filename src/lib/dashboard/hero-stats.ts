/* The hero's four counters — the right-hand column of the dashboard hero.

   The hero already says who you are and what the worst outstanding item is.
   These are the four numbers that decide whether you need to do anything today,
   and each is a door into the screen that owns it:

     Urgent          — action-required items already PAST their date.
     Tasks           — open tasks assigned to you.
     Needs attention — action-required items inside their warning window
                       (a rego about to expire, an unverified visa).
     Notifications   — unread posts on the noticeboard.

   Urgent and Needs attention split the SAME chip list on state, which is what
   keeps the two tiles from ever double-counting one thing: a chip is bad or
   warn, never both, and `chipSummary` is the one place that tally is computed.

   Every tile is returned even at zero, because a missing tile would mean "we
   didn't check" where a zero tile means "checked, nothing there". When ALL FOUR
   are zero the hero says it once, in words, instead of four times in zeroes —
   see `allClear`, which is what the right-hand column switches on. */

import { chipSummary, type ActionChip } from "./chips";

export type HeroStatKey = "urgent" | "tasks" | "attention" | "notices";

/** Tile tint. Urgency keeps the semantic colours; the other two take a domain
    hue, so the red/amber pair still reads as "something is wrong" at a glance
    rather than competing with a task count for attention. */
export type HeroStatTone = "bad" | "warn" | "blue" | "violet";

export type HeroStat = {
  key: HeroStatKey;
  /** ICON_PATHS name. */
  icon: string;
  label: string;
  count: number;
  href: string;
  tone: HeroStatTone;
};

export function heroStats(input: {
  /** Every action-required chip the viewer may see, self and team. */
  chips: readonly ActionChip[];
  /** Open tasks assigned to the viewer. */
  openTasks: number;
  /** Unread notices currently on the board. */
  unreadNotices: number;
}): HeroStat[] {
  const s = chipSummary(input.chips);
  return [
    {
      key: "urgent",
      icon: "alert",
      label: "Urgent",
      count: s.bad,
      href: "/dashboard/action-required",
      tone: "bad",
    },
    {
      key: "tasks",
      icon: "listCheck",
      label: "Tasks",
      count: input.openTasks,
      // the tasks section is on this page, so the tile scrolls to it rather
      // than navigating away from the numbers you just read
      href: "#dash-tasks",
      tone: "blue",
    },
    {
      key: "attention",
      icon: "clock",
      label: "Needs attention",
      count: s.warn,
      href: "/dashboard/action-required",
      tone: "warn",
    },
    {
      key: "notices",
      /* Called "Notifications" until the naming pass, which is not what it
         counts and not where it goes: it counts unread NOTICES and lands on
         the Noticeboard. The word also collided with the topbar bell, which
         now means the action-required board — two "notifications" on one
         screen pointing at two different places. It says its destination. */
      icon: "note",
      label: "Noticeboard",
      count: input.unreadNotices,
      href: "/dashboard/notices",
      tone: "violet",
    },
  ];
}

/* Nothing anywhere. Four zeroes are still four things to read, and they make a
   quiet day look like a busy one from across the room — so the column collapses
   to a single statement instead. The check is over the SAME stats the tiles
   would have rendered, so the two can never disagree about whether it's true. */
export function allClear(stats: readonly HeroStat[]): boolean {
  return stats.every((s) => s.count === 0);
}
