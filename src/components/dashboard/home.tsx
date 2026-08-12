"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { HomeCalendar } from "./home-calendar";
import { HomeJournal } from "./home-journal";
import { HomeTasks } from "./home-tasks";
import { ChipRows, NoticeRows, Nothing } from "./home-rows";
import { sortChips } from "@/lib/dashboard/chips";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import {
  DEFAULT_TAB,
  HOME_NOTICE_ROWS,
  homeTabs,
  type HomeTabKey,
} from "@/lib/dashboard/home-tabs";
import { currentUnreadCount, partitionNotices } from "@/lib/dashboard/notices";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* HOME — one ink-glass card, six faces.

   It was a 307px hero carrying a greeting, four counter tiles that said how
   many and nothing else, and five cards stacked under them. Every one of those
   pieces has folded into this: the counts ride the tab badges, the rows they
   were counting are the tab bodies, and the greeting is gone entirely (the
   date and time live in the frame's clock now).

   THE MECHANICS ARE THE BOARD'S, THE MATERIAL IS TIFF'S. The strip, the
   sliding thumb, the persistent card and the tick-list are still
   `.wb2-vtabs` / `.wb2-vslide` / `.wb2-card` / `.wb2-tk` — but the card
   wears the capture sheet's smoked glass on the daylight well (Isaac,
   2026-08-10), the thumb wears the card's material because it IS the card's
   top edge, and the row views are Home's own identity rows now rather than
   the board's five-column `.wb2-trj`. See the HOME section of shell.css.

   HOME HAS NO TIFF BUTTON OF ITS OWN. One sat in the tab strip's right cap so
   a debrief was "one press away from every face of the card" — but the frame's
   topbar button is one press away from every face of every SCREEN, and the two
   were identical 44px glass circles 167px apart in the same corner. The strip
   keeps its cap for boards that dock something there; Home docks nothing.

   THE BADGES ARE LOAD-BEARING, not decoration. A tab hides its content by
   definition, and the counters existed for the glance — "does anything need
   me?". Journal can only be the landing tab because Urgent wears a red 2 while
   you are reading it. See lib/dashboard/home-tabs.

   Client, for the tab state alone. Every panel's data arrives already resolved
   from the server loader; only which one is showing lives here. */

export function DashboardHome({ data }: { data: DashboardData }) {
  const {
    chips,
    calendar,
    money,
    tasks,
    notices,
    journal,
    assignable,
    canManage,
    viewerStaffId,
    today,
  } = data;

  const [tab, setTab] = useState<HomeTabKey>(DEFAULT_TAB);

  /* A journal chip naming a task opens it HERE — one card, six faces, and the
     task is on the face next door. Crossing to a route and back would lose the
     journal's scroll position for a row that was already on this screen.
     `focusTask` is handed to the Tasks panel, which scrolls it into view and
     flashes it, then clears this so pressing the same chip again works. */
  const [focusTask, setFocusTask] = useState<string | null>(null);
  const openTask = useCallback((id: string) => {
    setTab("tasks");
    setFocusTask(id);
  }, []);
  const clearFocusTask = useCallback(() => setFocusTask(null), []);

  /* Worst first, and split by state — the same one list the topbar bell
     counts, so Urgent and Needs attention can never double-count an expiry or
     drop one between them. */
  const all = sortChips([...chips.self, ...chips.team]);
  const bad = all.filter((c) => c.state === "bad");
  const warn = all.filter((c) => c.state === "warn");
  const { active } = partitionNotices(notices, today);

  const tabs = homeTabs({
    chips: all,
    openTasks: tasks.mine.length,
    unreadNotices: currentUnreadCount(notices, today),
  });

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
          {/* THE PAGE HEAD. Home was the only screen without one: the hero was
              deleted in #321 and nothing replaced it, so the page opened on a
              tab strip with no name on it while Workboard, Assets and Tiff all
              say who they are (Isaac, 2026-08-10). Same anatomy as
              `.wb2-head` — the closest sibling, being the other tabbed board.

              The date rides beside the title because it is the screen's
              context, not the Journal's: Urgent, Tasks and Calendar are all
              answers to "what about today". It comes from the loader's AU
              calendar date, never `new Date()` in a render body — see
              project_hydration_clock_trap. */}
          <header className="hm-phead">
            <h1>
              Home
              <span className="hm-pdate">{fmtAuWeekdayDateLong(today)}</span>
            </h1>
            <p className="hm-psub">
              What you&rsquo;ve told Tiff, what needs you, and what&rsquo;s coming up.
            </p>
          </header>

          {/* THE STRIP IS INSIDE THE CARD NOW, and that is the whole fix.

              The board's strip works by having the active tab's thumb BE the
              card's top edge — an opaque-surface technique. It cannot survive
              a translucent card: the 1px overlap that made the tab and the
              card continuous double-paints instead (.86 over .86 = .98, a
              dark band), the inverted corner flares are flat pseudos that
              cannot carry the card's blur, and the card's own top border
              draws a light line straight through the join. Three materials
              meeting where there should be one — "thrown together instead of
              one clean piece of glass" (Isaac, 2026-08-10).

              So the glass is ONE rectangle and the tabs live in it. The thumb
              stays and still slides; it is a lit pill ON the glass rather
              than a second sheet of it. Nothing about ViewTabs changed — the
              whole difference is which element it sits in, and CSS scoped to
              `.hm-card`. */}
          <div className="wb2-card hm-card">
            <ViewTabs
              items={tabs}
              active={tab}
              onGo={(k) => setTab(k as HomeTabKey)}
              ariaLabel="Home"
              idPrefix="hmtab"
              panelPrefix="hmsec"
            />

            {panel(
              "journal",
              <HomeJournal entries={journal} today={today} onOpenTask={openTask} />,
            )}

            {panel(
              "urgent",
              bad.length === 0 ? (
                <Nothing>Nothing is past its date. Checked licences, work rights, rego,
                  insurance and service intervals.</Nothing>
              ) : (
                <>
                  <div className="wb2-sect">Past their date</div>
                  <ChipRows chips={bad} sev="over" />
                </>
              ),
            )}

            {panel(
              "attention",
              warn.length === 0 ? (
                <Nothing>Nothing coming up inside its warning window.</Nothing>
              ) : (
                <>
                  <div className="wb2-sect">Coming up</div>
                  <ChipRows chips={warn} sev="soon" />
                </>
              ),
            )}

            {panel(
              "board",
              active.length === 0 ? (
                <Nothing>Nothing on the board right now.</Nothing>
              ) : (
                <>
                  {/* THE PANEL IS A GLANCE, THE BADGE IS THE COUNT. Home and
                      the board now read the same window (NOTICE_WINDOW), which
                      is what stops the "N unread" badge disagreeing with the
                      board it links to — but that window is a hundred posts
                      and this is a tab on a card. So the rows are capped and
                      the door says what is behind it, rather than the panel
                      quietly being the whole board on a thin month and a
                      truncation on a busy one. Pinned posts lead, because
                      that is the order they arrive in. */}
                  <NoticeRows notices={active.slice(0, HOME_NOTICE_ROWS)} />
                  <div className="hm-panelbar">
                    <Link className="hm-link" href="/dashboard/notices">
                      {active.length > HOME_NOTICE_ROWS
                        ? `Open the board · ${active.length - HOME_NOTICE_ROWS} more`
                        : "Open the board"}
                      <Icon name="arrowR" size={13} />
                    </Link>
                  </div>
                </>
              ),
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

            {panel("calendar", <HomeCalendar cal={calendar} today={today} />)}
          </div>

          {/* Payroll is the day's context rather than a face of it — nothing to
              act on, nothing to count — so it sits under the card as one quiet
              strip, absent without `financials` rather than rendering an empty
              shell.

              "Who's about today" used to share this strip and is gone: it spent
              half the page's width to say "Everyone's in today", and the one
              thing in it that mattered — the office closed for a public holiday,
              announced on this screen and nowhere else in the app — is now a
              tinted cell on the Calendar tab. Four weeks instead of one day, and
              for everyone instead of managers only. */}
          {money.length > 0 && (
            <div className="hm-strip">
              <div className="hm-stripcol">
                <div className="wb2-sect">Payroll</div>
                {/* `data-state` is the point, not decoration. `payRunItem`
                    decides warn vs ok on the one thing that matters here —
                    whether the period has CLOSED with work still outstanding,
                    which is when payroll can't complete without someone acting
                    — and this row rendered the label, the detail and a chevron
                    and dropped it on the floor. The whole distinction rode on
                    reading "Pay run due" instead of "Timesheets this period".
                    Every chip row two panels up carries its state as
                    `data-sev`; this is the same idea on the same screen. */}
                {money.map((m) => (
                  <Link className="hm-sr" href={m.href} key={m.key} data-state={m.state}>
                    <b>{m.label}</b>
                    <em>{m.detail}</em>
                    <span className="hm-rowgo">
                      <Icon name="arrowR" size={14} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
