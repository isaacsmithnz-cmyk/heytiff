"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { TiffButton } from "@/components/notes/tiff-button";
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

   THE BADGES ARE LOAD-BEARING, not decoration. A tab hides its content by
   definition, and the counters existed for the glance — "does anything need
   me?". Journal can only be the landing tab because Urgent wears a red 2 while
   you are reading it. See lib/dashboard/home-tabs.

   Client, for the tab state alone. Every panel's data arrives already resolved
   from the server loader; only which one is showing lives here. */

export function DashboardHome({ data }: { data: DashboardData }) {
  const {
    chips,
    roster,
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
          >
            {/* The board's capture slot. Tiff sits here rather than inside the
                Journal tab so a debrief is one press away from every face of
                the card, not only the one that shows the record. */}
            <TiffButton />
          </ViewTabs>

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
          </div>

          {/* Who's about and Payroll are the day's context rather than a face
              of it — nothing to act on, nothing to count. They sit under the
              card as one quiet strip, and each is absent without its
              capability rather than rendering an empty shell. */}
          {(roster || money.length > 0) && (
            <div className="hm-strip">
              {roster && (
                <div className="hm-stripcol">
                  <div className="wb2-sect">Who&rsquo;s about today</div>
                  {roster.publicHoliday && (
                    <p className="hm-ph">
                      <Icon name="calendar" size={14} />
                      Public holiday — {roster.publicHoliday}. The office is closed.
                    </p>
                  )}
                  {roster.onLeave.length === 0 ? (
                    <p className="hm-none">
                      {roster.publicHoliday ? "No individual leave booked." : "Everyone’s in today."}
                    </p>
                  ) : (
                    roster.onLeave.map((p) => (
                      <div className="hm-sr" key={p.staffId}>
                        <b>{p.name}</b>
                        <em>{p.label}</em>
                      </div>
                    ))
                  )}
                </div>
              )}

              {money.length > 0 && (
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
