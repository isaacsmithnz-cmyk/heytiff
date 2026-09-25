/* The three faces of Home, and the number on them.

   It was six — Journal, Urgent, Needs attention, Noticeboard, Tasks,
   Calendar — and four of those were lists of things that already have a whole
   screen of their own. A tab hides its content by definition, so six faces
   meant five hidden ones and a card that could only ever show a sixth of
   itself. Urgent and Needs attention are now chips in the page head pointing
   at /dashboard/action-required, and the Noticeboard chip at
   /dashboard/notices. What is left is what Home is FOR (Isaac, 2026-08-30):
   the record, the work you owe — and the month ahead.

   THE CALENDAR CAME BACK as the fourth (Isaac, 2026-08-30) — as a list, not
   the grid it was, and it is where being off lives now. Four weeks read
   downward answers "who is off, from here on"; the grid answered "what does
   this fortnight look like", which is a question this screen never asks.

   THE DEBRIEF WENT (Isaac, 2026-09-25: "remove the debrief section.
   Entirely."). It was a room with one button in it, asking the whole day at
   once; the diary, the tasks and the Tiff button already take the same words
   one thought at a time, so the room left and its dot with it.

   THE BADGE IS THE GLANCE, and Tasks is the only face that can want you.
   Overdue takes red because red on this app means "something is wrong" and a
   task past its date is exactly that; with nothing overdue the same badge
   falls back to the plain count, which is work rather than a state. Diary is
   where you land, so a number on it counts what you are already reading. */

import type { ViewTab } from "@/components/shell/view-tabs";

export type HomeTabKey = "diary" | "tasks" | "calendar";

/** Diary leads: you land on what you told Tiff, with the day beside it. */
export const DEFAULT_TAB: HomeTabKey = "diary";

export function homeTabs(input: {
  /** Open tasks assigned to the viewer. */
  openTasks: number;
  /** How many of those are past their date. */
  overdueTasks: number;
}): ViewTab[] {
  const overdue = input.overdueTasks > 0;
  return [
    {
      key: "diary",
      label: "Diary",
    },
    {
      key: "tasks",
      label: "Tasks",
      count: overdue ? input.overdueTasks : input.openTasks,
      tone: overdue ? "dan" : undefined,
      countLabel: overdue
        ? (n) => `${n} past ${n === 1 ? "its date" : "their date"}`
        : (n) => `${n} open`,
    },
    {
      /* No badge either, and for a reason worth keeping: a number here would
         count people being off, which is not something that needs you. Red
         and amber especially never appear on this tab — leave is not a
         readiness problem. See ./calendar. */
      key: "calendar",
      label: "Calendar",
    },
  ];
}
