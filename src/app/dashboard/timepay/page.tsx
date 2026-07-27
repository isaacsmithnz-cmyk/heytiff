import { redirect } from "next/navigation";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { TimePay } from "@/components/timepay/timepay";
import { loadTimepay } from "@/lib/timepay/page-data";
import { auth0 } from "@/lib/auth0";
import { getConnectionView } from "@/lib/integrations/store";
import { driftNote } from "@/lib/integrations/drift";
import { teamClaims } from "@/lib/expenses/query";
import { owedTotal, pendingCount } from "@/lib/expenses/claim";

/* Capability-gated: this is the EVERYONE view. Your own timesheet lives at
   /dashboard/my-timesheet and is never gated.

   `financials` decides whether the query selects the wage column at all — so
   without it this screen is hours-only for everyone, INCLUDING the viewer's
   own row. Your own figures live on My timesheet; this screen is about other
   people, so it stays uniformly money-free rather than showing one row
   differently.

   The settings gear serves two audiences: pay settings need `financials`,
   the public-holiday calendar needs admin+ (it's the org's operational
   calendar, same tier as the old admin page it replaced). Either unlocks the
   gear; each section gates itself inside. */

export default async function TimePayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-timesheet");

  const [{ period }, pay, approvals, role] = await Promise.all([
    searchParams,
    can("financials"),
    can("approvals"),
    getDbRole(),
  ]);
  /* A boolean, not the calendar. The holiday manager is a year of rows plus a
     statutory top-up that can write, and it is only ever looked at inside the
     settings gear — so the section fetches it for itself when it is opened.
     This screen only has to know whether to offer the row at all. */
  const canHolidays = hasMinRole(role, "admin");

  /* All three of these are org-scoped and independent of each other, so they
     go out together. They used to run one after the next — the timesheets,
     THEN the Xero grant, THEN the expense claims — three waits stacked end to
     end for three answers that never needed to be in any order. See DEPLOY.md
     on the region pin for why a stacked wait was so expensive here.

     `xeroConnected`: only whether a grant EXISTS crosses to the client. The
     connection itself is owner business; this screen needs to know one thing,
     whether the matching section has anything to show. Both it and the claims
     are asked only behind `financials` — the tile that shows the claims is
     money, and an hours-only view of this screen carries no dollar figures at
     all, so there is nothing to compute. */
  const orgId = (await auth0.getSession())?.orgId as string | undefined;
  const askPay = pay && orgId;
  const [data, connection, claims] = await Promise.all([
    loadTimepay({ pay }, period),
    askPay ? getConnectionView(orgId, "xero") : Promise.resolve(null),
    askPay ? teamClaims(orgId) : Promise.resolve([]),
  ]);
  if (!data) redirect("/dashboard");

  const xeroConnected = connection?.status === "connected";
  /* What the last sweep found — a COUNT, never the rates. The figures behind
     it still need the gated Check pay rates read. Derived from the connection
     the block above already fetched, so it costs nothing. */
  const wageDrift = xeroConnected
    ? driftNote({
        count: connection?.driftCount ?? null,
        checkedAt: connection?.driftCheckedAt ?? null,
      })
    : null;
  const expenses = { owed: owedTotal(claims), pending: pendingCount(claims) };

  return (
    <TimePay
      staff={data.staff}
      week={data.week}
      today={data.today}
      periods={data.periods}
      periodIndex={data.periodIndex}
      settings={data.settings}
      configured={data.configured}
      sheets={data.sheets}
      canApprove={approvals}
      financials={pay}
      canHolidays={canHolidays}
      xeroConnected={xeroConnected}
      wageDrift={wageDrift}
      expenses={expenses}
    />
  );
}
