/* TEAM'S VIEWS (v2, step 5; the board "Team, People").

   Seven views of one place: People, then the three approvals (Timesheets,
   Leave, Expenses), Vehicles, Purchases and Notices. "Left" is not a view: it is a
   choice inside People. Which views a reader has follows today's gates
   exactly: the approvals are Time & Pay's (`timepay_all`), Vehicles is the
   register's (`assets_all`), Purchases is money's (`financials`: what was
   paid, and what it did to the price book), and People and Notices come with Team itself.

   The view rides in the address (`?view=`), so an open tab holds it; a view
   this reader doesn't have, or a word that names none, opens People. */

export const TEAM_VIEWS = ["people", "timesheets", "leave", "expenses", "vehicles", "purchases", "notices"] as const;

export type TeamView = (typeof TEAM_VIEWS)[number];

export const TEAM_VIEW_LABEL: Record<TeamView, string> = {
  people: "People",
  timesheets: "Timesheets",
  leave: "Leave",
  expenses: "Expenses",
  vehicles: "Vehicles",
  purchases: "Purchases",
  notices: "Notices",
};

export type TeamGates = { timepay: boolean; fleet: boolean; purchases?: boolean };

/** The views this reader has, in the board's order. */
export function teamViewsFor(gates: TeamGates): TeamView[] {
  return TEAM_VIEWS.filter((v) => {
    if (v === "timesheets" || v === "leave" || v === "expenses") return gates.timepay;
    if (v === "vehicles") return gates.fleet;
    if (v === "purchases") return !!gates.purchases;
    return true;
  });
}

/** `?view=` read against the views this reader has. */
export function readTeamView(raw: unknown, available: readonly TeamView[]): TeamView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && (available as readonly string[]).includes(v) ? (v as TeamView) : "people";
}

/** The address of a view, keeping whatever else the address holds. */
export function teamViewHref(view: TeamView, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  if (view !== "people") q.set("view", view);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `/dashboard/team?${s}` : "/dashboard/team";
}
