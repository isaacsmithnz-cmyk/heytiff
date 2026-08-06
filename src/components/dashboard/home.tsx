import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { DashboardHero } from "./hero";
import { NoteToken } from "@/components/notes/note-token";
import { TasksSection } from "./tasks-section";
import { NoticesCard } from "./notices-card";
import { sortChips } from "@/lib/dashboard/chips";
import { heroStats } from "@/lib/dashboard/hero-stats";
import { currentUnreadCount } from "@/lib/dashboard/notices";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* The dashboard home — a set of summaries, each a door into the screen that
   owns it, rather than a page trying to be every screen at once:

     · the hero's four counters — urgent, tasks, needs attention, notifications
     · the noticeboard card carries unread + recent titles, linking to the board
     · Who's about today — approved leave and public holidays. `team` only, so
       the loader returns null otherwise and the whole card is absent.
     · Payroll — the pay-period status. `financials` only.

   Tasks are the exception and stay inline: they're the one thing you act on
   from here (tick it done) rather than read and move on. */

export function DashboardHome({
  greeting,
  firstName,
  date,
  data,
}: {
  greeting: string;
  firstName: string;
  date: string;
  data: DashboardData;
}) {
  const {
    chips,
    roster,
    money,
    tasks,
    notices,
    assignable,
    canManage,
    viewerStaffId,
    today,
  } = data;
  /* The hero's right-hand column. Both sections' chips, worst-first, split by
     state into the urgent and needs-attention counters — one list, so the two
     can never double-count an expiry or drop one between them. */
  const stats = heroStats({
    chips: sortChips([...chips.self, ...chips.team]),
    openTasks: tasks.mine.length,
    unreadNotices: currentUnreadCount(notices, today),
  });

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <DashboardHero greeting={greeting} firstName={firstName} date={date} stats={stats} />

          {/* THE DEBRIEF ROW — between the greeting and the day's lists,
              because that is when you'd use it: before you get stuck in.
              One sentence of what it does; the button carries the rest. */}
          <div className="dash-debrief">
            <div className="dash-debrieftext">
              <b>Got a head full of the day?</b>
              <span>
                Say it all at once — it gets sorted into tasks, knowledge and your notes.
              </span>
            </div>
            <NoteToken as="debrief" />
          </div>

          <div className="dash-cols">
            {/* the hero's Tasks counter scrolls here rather than navigating */}
            <div className="dash-col" id="dash-tasks">
              <TasksSection
                today={today}
                mine={tasks.mine}
                team={tasks.team}
                done={tasks.done}
                reported={tasks.reported}
                viewerStaffId={viewerStaffId}
                canManage={canManage}
                assignable={assignable}
              />
            </div>

            <div className="dash-col">
              <NoticesCard notices={notices} today={today} />

              {roster && (
                <div className="card2">
                  <div className="c2h">
                    <div className="ci">
                      <Icon name="users" size={19} />
                    </div>
                    <div>
                      <b>Who&rsquo;s about today</b>
                      <em>Approved leave and public holidays</em>
                    </div>
                  </div>
                  {roster.publicHoliday && (
                    <div className="dash-ph">
                      <Icon name="calendar" size={16} />
                      Public holiday — {roster.publicHoliday}. The office is
                      closed.
                    </div>
                  )}
                  {roster.onLeave.length === 0 ? (
                    <div className="dash-mini">
                      {roster.publicHoliday
                        ? "No individual leave booked."
                        : "Everyone’s in today."}
                    </div>
                  ) : (
                    roster.onLeave.map((p) => (
                      <div className="dash-row" key={p.staffId}>
                        <span className="dr-subj">{p.name}</span>
                        <span
                          className="dchip2 mute"
                          style={{ marginLeft: "auto" }}
                        >
                          {p.label}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {money.length > 0 && (
                <div className="card2">
                  <div className="c2h">
                    <div className="ci">
                      <Icon name="calc" size={19} />
                    </div>
                    <div>
                      <b>Payroll</b>
                      <em>Where this pay period is up to</em>
                    </div>
                  </div>
                  {money.map((m) => (
                    <Link className="dash-row" href={m.href} key={m.key}>
                      <span className={`dchip2 ${m.state}`}>
                        <Icon
                          name={m.state === "warn" ? "clock" : "check"}
                          size={12}
                        />
                        {m.label}
                      </span>
                      <span className="dr-detail">{m.detail}</span>
                      <span className="dr-chev">
                        <Icon name="arrowR" size={16} />
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
