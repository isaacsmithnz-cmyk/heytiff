"use client";

import { useCallback, useState } from "react";
import { HomeDayBand } from "./home-day-band";
import { HomeDebrief } from "./home-debrief";
import { HomeDiary } from "./home-diary";
import { HomeCalendarFace } from "./home-calendar-face";
import { HomeRailNav } from "./home-rail-nav";
import { HomeTasks } from "./home-tasks";
import { sortChips } from "@/lib/dashboard/chips";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import { DEFAULT_TAB, homeTabs, type HomeTabKey } from "@/lib/dashboard/home-tabs";
import { currentUnreadCount } from "@/lib/dashboard/notices";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* HOME — one card, three rooms.

   The day across the top; under it a rail of the four faces, the list the
   face holds, and the page the chosen row opens onto. That is the
   three-room handoff of 2026-09-14, redrawn to the ink-and-paper laws (see
   docs/design.md). It replaced the desk — a day rail down the left beside a
   card of four tabs — which had put the day and the record in two materials
   and left the tabs' faces a sixth of the height each.

   THE DATE IS THE TITLE. The screen's name is on the shell's rail one column
   to the left, so the h1 does not repeat it (Isaac, 2026-09-15: "do we need
   the home title at the top?"); the day is what this screen is about, and
   the day names it. It formats the loader's `today`, never a clock read in
   render — see the hydration trap.

   THE GLANCE LIVES ON THE RAIL. What needs attention and what is unread were
   chips in the page head, then words on the strip; they are doors, so they
   stand with the other doors, at the foot of the rail, absent at zero.

   Client, for the state the rooms share: which face is up, which entry the
   diary is reading, and which task a diary door just named. Every panel's
   data arrives resolved from the loader. */

export function DashboardHome({ data }: { data: DashboardData }) {
  const {
    chips,
    calendar,
    tasks,
    notices,
    journal,
    issues,
    assignable,
    canManage,
    viewerStaffId,
    today,
    rail,
    phase,
  } = data;

  const [tab, setTab] = useState<HomeTabKey>(DEFAULT_TAB);
  /* The entry the diary's pane is reading — null reads the newest. Home
     owns it so a task's "Open in diary" can choose one from next door. */
  const [entryId, setEntryId] = useState<string | null>(null);

  /* A diary door naming a task — or an issue, which stands on the same face
     — opens it HERE: one card, and the row is next door. `focusTask` is
     handed to the Tasks face, which chooses the row, scrolls it into view
     and marks it, then clears this so pressing the same door again works. */
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const openTask = useCallback((id: string) => {
    setTab("tasks");
    setFocusTask(id);
  }, []);
  const clearFocusTask = useCallback(() => setFocusTask(null), []);
  const openEntry = useCallback((id: string) => {
    setTab("diary");
    setEntryId(id);
  }, []);

  /* ONE NUMBER, NOT TWO (Isaac, 2026-09-01). The dated states were always one
     list — the same one the bell counts — split on state purely so each half
     could have its own chip; both pointed at the same screen. The severity
     moves onto the number's colour: anything past its date makes it red,
     otherwise amber. Unread notices stay their own count — a different screen
     and a different kind of fact. */
  const all = sortChips([...chips.self, ...chips.team]);
  /* `chipsOverdue`, not `overdue` — the viewer's own tasks have their own
     overdue below, and the two count different things. */
  const chipsOverdue = all.filter((c) => c.state === "bad").length;
  const attention = chipsOverdue + all.filter((c) => c.state === "warn").length;
  const unread = currentUnreadCount(notices, today);

  /* Past its date, on the viewer's own tasks — the one number on this card
     that means something is wrong. The same comparison the Tasks face
     groups on. */
  const overdue = tasks.mine.filter((t) => t.dueDate !== null && t.dueDate < today).length;

  /* The dot goes out the moment anything lands in today's record — the
     debrief is one way to file, and a note typed straight into the diary is
     another. Both count as "you have told it something today". */
  const debriefedToday = journal.some((e) => e.day === today);

  const tabs = homeTabs({
    openTasks: tasks.mine.length,
    overdueTasks: overdue,
    debriefedToday,
  });

  const panel = (key: HomeTabKey, shape: "two" | "one", body: React.ReactNode) => (
    <section
      className={`hm-face ${shape}`}
      id={`hmsec-${key}`}
      role="tabpanel"
      aria-labelledby={`hmtab-${key}`}
      hidden={tab !== key}
    >
      {body}
    </section>
  );

  return (
    /* `full`: paper to the frame, so the day's card is the screen rather than
       a card floating on a grey margin (2026-09-20). */
    <div className="page in full">
      <div className="wrap hm-wrap">
        <div className="stg">
          <div className="hm-card">
            <section className="hm-band" aria-label="Today">
              <h1 className="hm-date">{fmtAuWeekdayDateLong(today)}</h1>
              <HomeDayBand rail={rail} />
            </section>

            <div className="hm-body">
              <HomeRailNav
                tabs={tabs}
                active={tab}
                onGo={(k) => setTab(k as HomeTabKey)}
                attention={attention}
                chipsOverdue={chipsOverdue}
                unread={unread}
              />

              {panel(
                "diary",
                "two",
                <HomeDiary
                  entries={journal}
                  today={today}
                  selectedId={entryId}
                  onSelect={setEntryId}
                  onOpenTask={openTask}
                  onOpenIssue={openTask}
                />,
              )}

              {panel(
                "tasks",
                "two",
                <HomeTasks
                  today={today}
                  mine={tasks.mine}
                  team={tasks.team}
                  done={tasks.done}
                  reported={tasks.reported}
                  issues={issues}
                  viewerStaffId={viewerStaffId}
                  canManage={canManage}
                  assignable={assignable}
                  journal={journal}
                  tz={rail.tz}
                  onOpenEntry={openEntry}
                  focusTaskId={focusTask}
                  onFocusHandled={clearFocusTask}
                />,
              )}

              {panel(
                "debrief",
                "one",
                <HomeDebrief
                  phase={phase}
                  /* Filtered here rather than loaded separately: the journal
                     is already in hand (60 entries, whole history), so the
                     debriefs are a subset of something the page has, not a
                     second round trip. */
                  debriefs={journal.filter((e) => e.isDebrief)}
                  today={today}
                />,
              )}

              {panel("calendar", "one", <HomeCalendarFace cal={calendar} today={today} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
