"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ViewTabs } from "@/components/shell/view-tabs";
import { DotField } from "@/components/ui/dot-field";
import { HomeDayRail } from "./home-day-rail";
import { HomeDebrief } from "./home-debrief";
import { HomeJournal } from "./home-journal";
import { HomeCalendarFace } from "./home-calendar-face";
import { HomeTasks } from "./home-tasks";
import { sortChips } from "@/lib/dashboard/chips";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import { DEFAULT_TAB, homeTabs, type HomeTabKey } from "@/lib/dashboard/home-tabs";
import { currentUnreadCount } from "@/lib/dashboard/notices";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* HOME — the day on the left, the diary on the right.

   It was one card with six faces: Journal, Urgent, Needs attention,
   Noticeboard, Tasks, Calendar. Four of those were lists of things that
   already have a whole screen, so the card could only ever show a sixth of
   itself and the day's actual work — where you have to be, and when — was on
   none of them.

   TWO ROOMS (Isaac, 2026-08-30). The left is the day: today's bookings from
   ServiceM8 and the tasks that named an hour, drawn on one timeline with the
   now marker riding it, so "where should I be" is a glance down one column.
   The right is the record: the diary, what you owe, the conversation that
   produces both, and the month ahead — who is off, four weeks of it, read
   downward as a list rather than a fortnight of squares.

   THE GLANCE SURVIVED THE TABS IT LIVED ON. Urgent and Needs attention were
   badges on faces of this card; they are chips in the page head now, and they
   are DOORS — /dashboard/action-required and /dashboard/notices are whole
   screens that already exist and say more than a panel ever did. A chip is
   absent at zero: five grey noughts is not a glance.

   Client, for the tab state alone. Every panel's data arrives resolved from
   the loader; only which face is showing lives here. */

export function DashboardHome({ data }: { data: DashboardData }) {
  const {
    chips,
    calendar,
    tasks,
    notices,
    journal,
    assignable,
    canManage,
    viewerStaffId,
    today,
    rail,
    phase,
  } = data;

  const [tab, setTab] = useState<HomeTabKey>(DEFAULT_TAB);

  /* A diary chip naming a task opens it HERE — one card, and the task is on
     the face next door. `focusTask` is handed to the Tasks panel, which
     scrolls it into view and flashes it, then clears this so pressing the
     same chip again works. */
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const openTask = useCallback((id: string) => {
    setTab("tasks");
    setFocusTask(id);
  }, []);
  const clearFocusTask = useCallback(() => setFocusTask(null), []);

  /* The same one list the topbar bell counts, split on state, so the two
     chips can never double-count an expiry or drop one between them. */
  const all = sortChips([...chips.self, ...chips.team]);
  const bad = all.filter((c) => c.state === "bad").length;
  const warn = all.filter((c) => c.state === "warn").length;
  const unread = currentUnreadCount(notices, today);

  /* Past its date, on the viewer's own tasks — the one number on this card
     that means something is wrong. */
  const overdue = tasks.mine.filter((t) => t.dueDate !== null && t.dueDate < today).length;

  const tabs = homeTabs({ openTasks: tasks.mine.length, overdueTasks: overdue });

  const panel = (key: HomeTabKey, body: React.ReactNode) => (
    <section
      className="wb2-body hm-panel"
      id={`hmsec-${key}`}
      role="tabpanel"
      aria-labelledby={`hmtab-${key}`}
      hidden={tab !== key}
    >
      {body}
    </section>
  );

  return (
    <div className="page in">
      <div className="wrap hm-wrap">
        <div className="stg">
          <header className="hm-phead">
            <h1>
              Home
              <span className="hm-pdate">{fmtAuWeekdayDateLong(today)}</span>
            </h1>

            {/* Absent at zero, all three of them. "Nothing is past its date"
                is what an empty head says, and it says it by being empty —
                the same argument the badges made on the tabs they replaced. */}
            {(bad > 0 || warn > 0 || unread > 0) && (
              <nav className="hm-glance" aria-label="Needs you">
                {bad > 0 && (
                  <Link className="hm-gl dan" href="/dashboard/action-required">
                    <b>{bad}</b> past {bad === 1 ? "its" : "their"} date
                  </Link>
                )}
                {warn > 0 && (
                  <Link className="hm-gl warn" href="/dashboard/action-required">
                    <b>{warn}</b> coming up
                  </Link>
                )}
                {unread > 0 && (
                  <Link className="hm-gl" href="/dashboard/notices">
                    <b>{unread}</b> unread
                  </Link>
                )}
              </nav>
            )}
          </header>

          <div className="hm-desk">
            <HomeDayRail rail={rail} />

            {/* The strip is inside the card, and that is load-bearing: the
                thumb IS the card's top edge, which cannot survive two
                surfaces meeting. See the HOME section of shell.css. */}
            <div className="wb2-card hm-card">
              {/* The mark, drifting on the card's floor — the same field the
                  studio's start screen wears, on its own zero-sized anchor so
                  it cannot push a panel around. */}
              <span className="hm-cloud" aria-hidden="true">
                <DotField stage="cloud" size={330} cols={26} />
              </span>

              <ViewTabs
                items={tabs}
                active={tab}
                onGo={(k) => setTab(k as HomeTabKey)}
                ariaLabel="Home"
                idPrefix="hmtab"
                panelPrefix="hmsec"
              />

              {panel(
                "diary",
                <HomeJournal entries={journal} today={today} onOpenTask={openTask} />,
              )}

              {panel(
                "tasks",
                <HomeTasks
                  today={today}
                  mine={tasks.mine}
                  team={tasks.team}
                  done={tasks.done}
                  reported={tasks.reported}
                  viewerStaffId={viewerStaffId}
                  canManage={canManage}
                  assignable={assignable}
                  focusTaskId={focusTask}
                  onFocusHandled={clearFocusTask}
                />,
              )}

              {panel(
                "debrief",
                <HomeDebrief phase={phase} last={journal[0] ?? null} today={today} />,
              )}

              {panel("calendar", <HomeCalendarFace cal={calendar} today={today} />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
