import { redirect } from "next/navigation";
import { can, getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { TimePay } from "@/components/timepay/timepay";
import { loadTimepay } from "@/lib/timepay/page-data";
import { loadHolidayManager } from "@/lib/timepay/leave-page";
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
  const canHolidays = hasMinRole(role, "admin");
  const [data, holidayData, session] = await Promise.all([
    loadTimepay({ pay }, period),
    canHolidays ? loadHolidayManager() : Promise.resolve(null),
    auth0.getSession(),
  ]);
  if (!data) redirect("/dashboard");

  /* Only whether a grant EXISTS crosses to the client. The connection itself is
     owner business — this screen needs to know one thing: whether the matching
     section has anything to show. Asked only when the viewer holds `financials`,
     since that is the only case where the section renders at all. */
  const orgId = session?.orgId as string | undefined;
  const connection = pay && orgId ? await getConnectionView(orgId, "xero") : null;
  const xeroConnected = connection?.status === "connected";
  /* What the last sweep found — a COUNT, never the rates. The figures behind
     it still need the gated Check pay rates read. */
  const wageDrift = xeroConnected ? driftNote({ count: connection?.driftCount ?? null, checkedAt: connection?.driftCheckedAt ?? null }) : null;

  /* Only asked for behind `financials`, because the tile that shows it is
     money — an hours-only view of this screen carries no dollar figures at
     all, so there is nothing to compute. */
  const claims = pay && orgId ? await teamClaims(orgId) : [];
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
      holidayData={holidayData}
      xeroConnected={xeroConnected}
      wageDrift={wageDrift}
      expenses={expenses}
    />
  );
}
