import { auth0 } from "@/lib/auth0";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { getConnectionView } from "@/lib/integrations/store";
import { driftNote } from "@/lib/integrations/drift";
import { teamClaims } from "@/lib/expenses/query";
import { owedTotal, pendingCount } from "@/lib/expenses/claim";
import { loadTimepay } from "./page-data";
import { loadTeamLeave } from "./leave-page";

/* Everything team Time & Pay shows, in one ask — all three faces.

   The faces were three routes loading three payloads, switched by
   route-navigation tabs; every switch was a server round trip that read as a
   page reload beside Team's instant switcher. Now any of the three URLs loads
   the lot and the shell switches faces on the client, so this module is the
   one place the section's data comes from.

   WHAT MOVED AND WHAT DIDN'T:
   - `approvals` still resolves BEFORE loadTeamLeave, deliberately sequential —
     it decides whether pending rows carry their medical certificates at all,
     and one extra round trip is the price of not shipping health information
     to a viewer who can't act on it (the old leave page's law, kept).
   - `financials` still decides whether the timesheet query selects the wage
     column at all, and the Xero grant is only asked about behind it.
   - `teamClaims` is UNGATED now where the old index asked only behind
     `financials`: the Expenses FACE has always shown claims to any
     `timepay_all` holder (an approver sees what was spent, never what anyone
     earns), and it needs the rows on every entry URL. The stat TILE that
     turns them into dollars stays behind `financials` in the component. */

export async function loadTimepaySection(period?: string) {
  const [pay, approvals, role, team] = await Promise.all([
    can("financials"),
    can("approvals"),
    getDbRole(),
    can("team"),
  ]);
  const canHolidays = hasMinRole(role, "admin");

  const orgId = (await auth0.getSession())?.orgId as string | undefined;
  const askPay = pay && orgId;
  const [sheets, connection, claims, leave] = await Promise.all([
    loadTimepay({ pay }, period),
    askPay ? getConnectionView(orgId, "xero") : Promise.resolve(null),
    orgId ? teamClaims(orgId) : Promise.resolve([]),
    loadTeamLeave(approvals),
  ]);
  if (!sheets || !leave) return null;

  const xeroConnected = connection?.status === "connected";
  /* What the last sweep found — a COUNT, never the rates. */
  const wageDrift = xeroConnected
    ? driftNote({
        count: connection?.driftCount ?? null,
        checkedAt: connection?.driftCheckedAt ?? null,
      })
    : null;

  return {
    sheets,
    leave,
    claims,
    canApprove: approvals,
    financials: pay,
    canHolidays,
    canManage: team,
    xeroConnected,
    wageDrift,
    expenses: { owed: owedTotal(claims), pending: pendingCount(claims) },
  };
}

export type TimepaySection = NonNullable<Awaited<ReturnType<typeof loadTimepaySection>>>;
