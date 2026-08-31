/* The four faces of Home, and the number on them.

   It was six — Journal, Urgent, Needs attention, Noticeboard, Tasks,
   Calendar — and four of those were lists of things that already have a whole
   screen of their own. A tab hides its content by definition, so six faces
   meant five hidden ones and a card that could only ever show a sixth of
   itself. Urgent and Needs attention are now chips in the page head pointing
   at /dashboard/action-required, and the Noticeboard chip at
   /dashboard/notices. What is left is what Home is FOR (Isaac, 2026-08-30):
   the record, the work you owe, the conversation that produces both — and the
   month ahead.

   THE CALENDAR CAME BACK as the fourth (Isaac, 2026-08-30) — as a list, not
   the grid it was, and it is where being off lives now. Four weeks read
   downward answers "who is off, from here on"; the grid answered "what does
   this fortnight look like", which is a question this screen never asks.

   THE BADGE IS THE GLANCE, and Tasks is the only face that can want you.
   Overdue takes red because red on this app means "something is wrong" and a
   task past its date is exactly that; with nothing overdue the same badge
   falls back to the plain count, which is work rather than a state. Diary is
   where you land, so a number on it counts what you are already reading;
   Debrief is a door to a conversation, and a count on a conversation is not a
   thing that exists. */

import type { ViewTab } from "@/components/shell/view-tabs";

export type HomeTabKey = "diary" | "tasks" | "debrief" | "calendar";

/** Diary leads: you land on what you told Tiff, with the day beside it. */
export const DEFAULT_TAB: HomeTabKey = "diary";

export function homeTabs(input: {
  /** Open tasks assigned to the viewer. */
  openTasks: number;
  /** How many of those are past their date. */
  overdueTasks: number;
  /** Has anything been filed today? The debrief wears a dot until it has. */
  debriefedToday?: boolean;
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
      /* No badge, ever. The debrief is a conversation you either had or
         haven't; "1" would be a number on the door of a room, and the room
         itself says which of the day's three questions it is asking. */
      key: "debrief",
      label: "Debrief",
      /* NOT a count — a state. See ViewTab.dot: the debrief is had or it
         isn't, and the dot goes out the moment something lands in today's
         record. */
      dot: !input.debriefedToday,
      dotLabel: "nothing filed today yet",
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
