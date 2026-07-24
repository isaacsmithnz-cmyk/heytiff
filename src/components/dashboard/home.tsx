import { Icon } from "@/components/shell/icon";
import { heroHtml } from "@/components/shell/screens";
import { TasksSection } from "./tasks-section";
import { NoticesCard } from "./notices-card";
import type { ActionChip } from "@/lib/dashboard/chips";
import type { DashboardData } from "@/lib/dashboard/page-data";

/* The dashboard home. The greeting hero is unchanged (reused verbatim from
   screens.ts); everything beneath it is real, capability-scoped data:

     · Action required — your own expiries always, the team's / fleet's when you
       hold `team` / `assets_all`. Empty means genuinely nothing is due.
     · Who's about today — approved leave and public holidays. `team` only, so
       the loader returns null otherwise and the whole card is absent.
     · Payroll — the pay-period status. `financials` only.

   No interactivity here yet (tasks & notices, with their read/ack, arrive in a
   later slice), so this stays a server component. */

function ChipRow({ chip }: { chip: ActionChip }) {
  return (
    <a className="dash-row" href={chip.href}>
      <span className={`dchip2 ${chip.state}`}>
        <Icon name={chip.state === "bad" ? "alert" : "clock"} size={12} />
        {chip.label}
      </span>
      <span className="dr-subj">{chip.subject}</span>
      <span className="dr-chev">
        <Icon name="arrowR" size={16} />
      </span>
    </a>
  );
}

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
  const { chips, roster, money, tasks, notices, assignable, canManage, viewerStaffId } = data;
  const hasChips = chips.self.length > 0 || chips.team.length > 0;
  const bothSections = chips.self.length > 0 && chips.team.length > 0;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div dangerouslySetInnerHTML={{ __html: heroHtml({ greeting, firstName, date }) }} />

          <div className="card2">
            <div className="c2h">
              <div className="ci">
                <Icon name="alert" size={19} />
              </div>
              <div>
                <b>Action required</b>
                <em>Licences, work rights, vehicles and insurance coming due</em>
              </div>
            </div>
            {!hasChips ? (
              <div className="dash-mini">
                Nothing needs your attention right now — you&rsquo;re all caught up.
              </div>
            ) : (
              <>
                {chips.self.length > 0 && (
                  <>
                    {bothSections && <div className="dash-sub">Yours</div>}
                    {chips.self.map((c) => (
                      <ChipRow key={c.key} chip={c} />
                    ))}
                  </>
                )}
                {chips.team.length > 0 && (
                  <>
                    <div className="dash-sub">Across the team</div>
                    {chips.team.map((c) => (
                      <ChipRow key={c.key} chip={c} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          <TasksSection
            today={data.today}
            mine={tasks.mine}
            team={tasks.team}
            done={tasks.done}
            reported={tasks.reported}
            viewerStaffId={viewerStaffId}
            canManage={canManage}
            assignable={assignable}
          />

          <NoticesCard notices={notices} />

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
                  Public holiday — {roster.publicHoliday}. The office is closed.
                </div>
              )}
              {roster.onLeave.length === 0 ? (
                <div className="dash-mini">
                  {roster.publicHoliday ? "No individual leave booked." : "Everyone’s in today."}
                </div>
              ) : (
                roster.onLeave.map((p) => (
                  <div className="dash-row" key={p.staffId}>
                    <span className="dr-subj">{p.name}</span>
                    <span className="dchip2 mute" style={{ marginLeft: "auto" }}>
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
                <a className="dash-row" href={m.href} key={m.key}>
                  <span className={`dchip2 ${m.state}`}>
                    <Icon name={m.state === "warn" ? "clock" : "check"} size={12} />
                    {m.label}
                  </span>
                  <span className="dr-detail">{m.detail}</span>
                  <span className="dr-chev">
                    <Icon name="arrowR" size={16} />
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
