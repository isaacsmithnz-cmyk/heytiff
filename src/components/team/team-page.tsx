"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { IconButton } from "@/components/parts/button";
import { TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Tick } from "@/components/parts/tick";
import { ViewTabs } from "@/components/parts/tabs";
import { AddPersonButton } from "@/components/team/person-form";
import { PEOPLE_SORTS, TeamPeople, type PeopleData, type PeopleSort } from "@/components/team/team-people";
import { TimePay } from "@/components/timepay/timepay";
import { TeamLeave } from "@/components/timepay/team-leave";
import { TeamExpenses } from "@/components/timepay/team-expenses";
import { FleetRegister } from "@/components/fleet/register";
import { useFleetActions } from "@/components/fleet/fleet-state";
import type { Register } from "@/components/fleet/assets-screen";
import { NoticesBoard } from "@/components/dashboard/notices-board";
import type { TimepaySection } from "@/lib/timepay/section";
import type { NoticeBoardData } from "@/lib/dashboard/page-data";
import { partitionNotices } from "@/lib/dashboard/notices";
import { TEAM_VIEW_LABEL, teamViewHref, type TeamView } from "@/lib/team/views";

/* TEAM (v2, step 5; the board "Team, People"). The title with how many
   people beside it in grey, the search and Add a person on the right; the
   views as soft tabs (rule 29); then the view.

   People is drawn here, new. The other five are today's screens, each
   under its own engine and its own approve, decline, send back and mark
   paid, placed in the view the board gives it: Time & Pay's three faces,
   the Fleet register and the noticeboard. They wear their own dress until
   their own boards are built; only their frame went.

   The view is the address (`?view=`), written with replaceState, so a tab
   holds it and switching asks nothing of the server: every view's rows
   came with the page. */

export type TeamPageData = {
  people: PeopleData;
  /** Time & Pay's load, present only with `timepay_all` */
  timepay: TimepaySection | null;
  /** the Fleet register, present only with `assets_all` */
  fleet: { register: Register; today: string; warnDays: number } | null;
  notices: NoticeBoardData;
  /** the views this reader has, in order */
  views: TeamView[];
};

const PANEL = "tm2-panel";

/** The register, under Fleet's own actions. A hook needs a component. */
function TeamVehicles({ fleet }: { fleet: NonNullable<TeamPageData["fleet"]> }) {
  const actions = useFleetActions();
  return (
    <FleetRegister
      fleet={{ ...actions, ...fleet.register }}
      staff={fleet.register.staff}
      today={fleet.today}
      warnDays={fleet.warnDays}
    />
  );
}

export function TeamPage({ data, view: asked }: { data: TeamPageData; view: TeamView }) {
  const [view, setView] = useState<TeamView>(asked);
  /* A link on this page that names another view (the Expenses tile on
     Timesheets, a period) lands on the same address, which doesn't remount
     the page; the view it names is taken here, once per naming. */
  const [taken, setTaken] = useState<TeamView>(asked);
  if (asked !== taken) {
    setTaken(asked);
    setView(asked);
  }
  const [query, setQuery] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [sort, setSort] = useState<PeopleSort>("name");

  const go = (next: TeamView) => {
    setView(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "people") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      if (next !== "timesheets") url.searchParams.delete("period");
      window.history.replaceState(null, "", url.toString());
    }
  };

  const { people, timepay, fleet, notices } = data;
  const working = useMemo(() => people.staff.filter((s) => s.status === "Active"), [people.staff]);
  const leftCount = people.staff.length - working.length;
  const counts = useMemo((): Record<TeamView, number> => {
    const live = partitionNotices(notices.notices, notices.today).active;
    return {
      people: working.length,
      timesheets: timepay ? Object.values(timepay.sheets.sheets).filter((s) => s.status === "submitted").length : 0,
      leave: timepay ? timepay.leave.pending.length : 0,
      expenses: timepay ? timepay.expenses.pending : 0,
      vehicles: fleet ? fleet.register.vehicles.filter((v) => v.status !== "sold").length : 0,
      notices: live.length,
    };
  }, [working, timepay, fleet, notices]);

  const countWords: Record<TeamView, (n: number) => string> = {
    people: (n) => `${n} working`,
    timesheets: (n) => `${n} waiting for approval`,
    leave: (n) => `${n} waiting for a decision`,
    expenses: (n) => `${n} waiting for a decision`,
    vehicles: (n) => `${n} working vehicles`,
    notices: (n) => `${n} on the board`,
  };

  const onPeople = view === "people";

  return (
    <div className="tm2">
      <header className="tm2-head">
        <div className="tm2-title">
          <h1>Team</h1>
          <span className="tm2-count">
            {working.length} {working.length === 1 ? "person" : "people"}
          </span>
        </div>
        <div className="tm2-headacts">
          {onPeople && (
            <div className="tm2-search" role="search">
              <span className="tm2-search-icon" aria-hidden="true">
                <Icon name="search" size={16} />
              </span>
              <TextInput
                className="tm2-search-input"
                aria-label="Search people by name or role"
                placeholder="Search people"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) setQuery("");
                }}
              />
              {query && (
                <IconButton glyph="clear" label="Clear the search box" size={32} className="tm2-search-clear" onClick={() => setQuery("")} />
              )}
            </div>
          )}
          {people.canInvite && <AddPersonButton roles={people.inviteRoles} />}
        </div>
      </header>

      <div className="tm2-bar">
        <ViewTabs
          ariaLabel="Views of the team"
          idPrefix="tm2-view"
          panelPrefix={PANEL}
          current={view}
          onGo={(k) => go(k as TeamView)}
          items={data.views.map((v) => ({ key: v, label: TEAM_VIEW_LABEL[v], count: counts[v], countLabel: countWords[v] }))}
        />
        {onPeople && (
          <div className="tm2-picks">
            {/* "Left" is not a view: the people who have left are behind this
                choice, and only once there is somebody to show */}
            {leftCount > 0 && <Tick label={`Show people who have left, ${leftCount}`} checked={showLeft} onChange={setShowLeft} />}
            <div className="tm2-pick">
              <span className="tm2-pick-word" aria-hidden="true">
                Sort
              </span>
              <Chooser aria-label="Sort" className="tm2-pick-ch" options={PEOPLE_SORTS} value={sort} onChange={(v) => setSort(v as PeopleSort)} />
            </div>
          </div>
        )}
      </div>

      <section role="tabpanel" id={`${PANEL}-${view}`} aria-labelledby={`tm2-view-${view}`} className="tm2-panel">
        {view === "people" && (
          <TeamPeople data={people} query={query} onClearQuery={() => setQuery("")} showLeft={showLeft} sort={sort} />
        )}
        {view === "timesheets" && timepay && (
          <TimePay
            staff={timepay.sheets.staff}
            week={timepay.sheets.week}
            today={timepay.sheets.today}
            through={timepay.sheets.through}
            periods={timepay.sheets.periods}
            periodIndex={timepay.sheets.periodIndex}
            settings={timepay.sheets.settings}
            configured={timepay.sheets.configured}
            sheets={timepay.sheets.sheets}
            canApprove={timepay.canApprove}
            financials={timepay.financials}
            canHolidays={timepay.canHolidays}
            xeroConnected={timepay.xeroConnected}
            wageDrift={timepay.wageDrift}
            expenses={timepay.expenses}
            periodHref={(start) => teamViewHref("timesheets", { period: start })}
            expensesHref={teamViewHref("expenses")}
          />
        )}
        {view === "leave" && timepay && (
          <TeamLeave
            pending={timepay.leave.pending}
            calendar={timepay.leave.calendar}
            balances={timepay.leave.balances}
            canApprove={timepay.canApprove}
            canManage={timepay.canManage}
          />
        )}
        {view === "expenses" && timepay && (
          <TeamExpenses claims={timepay.claims} canApprove={timepay.canApprove} canPay={timepay.financials} />
        )}
        {view === "vehicles" && fleet && <TeamVehicles fleet={fleet} />}
        {view === "notices" && (
          <NoticesBoard
            embedded
            notices={notices.notices}
            canManage={notices.canManage}
            canRead={notices.canRead}
            today={notices.today}
            staff={notices.staff}
            viewerStaffId={notices.viewerStaffId}
          />
        )}
      </section>
    </div>
  );
}
