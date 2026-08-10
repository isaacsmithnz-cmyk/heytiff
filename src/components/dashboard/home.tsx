"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { HomeCalendar } from "./home-calendar";
import { HomeJournal } from "./home-journal";
import { HomeTasks } from "./home-tasks";
import { ChipRows, NoticeRows, Nothing } from "./home-rows";
import { sortChips } from "@/lib/dashboard/chips";
import { DEFAULT_TAB, homeTabs, type HomeTabKey } from "@/lib/dashboard/home-tabs";
import { currentUnreadCount, partitionNotices } from "@/lib/dashboard/notices";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* HOME — one card, five faces.

   It was a 307px hero carrying a greeting, four counter tiles that said how
   many and nothing else, and five cards stacked under them. Every one of those
   pieces has folded into this: the counts ride the tab badges, the rows they
   were counting are the tab bodies, and the greeting is gone entirely (the
   date and time live in the frame's clock now).

   NOTHING HERE IS NEW FURNITURE. The strip, the sliding thumb, the persistent
   card, the row and the tick-list are the maintenance board's, reused —
   `.wb2-vtabs`, `.wb2-vslide`, `.wb2-card`, `.wb2-trj`, `.wb2-tk`. Home was
   the last bespoke screen in the app and it isn't one any more.

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
          <ViewTabs
            items={tabs}
            active={tab}
            onGo={(k) => setTab(k as HomeTabKey)}
            ariaLabel="Home"
            idPrefix="hmtab"
            panelPrefix="hmsec"
          />

          <div className="wb2-card hm-card">
            {panel("journal", <HomeJournal entries={journal} today={today} />)}

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
                  <NoticeRows notices={active} />
                  <div className="hm-panelbar">
                    <Link className="hm-link" href="/dashboard/notices">
                      Open the board
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
                {money.map((m) => (
                  <Link className="hm-sr" href={m.href} key={m.key}>
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
