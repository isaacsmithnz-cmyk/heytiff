import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { todayInAu } from "@/lib/au-dates";
import { analyse, DEFAULT_PERIOD, isPeriodKey, periodSpan, spanBefore, type PeriodKey } from "@/lib/analytics/job-analytics";
import { readAnalyticsJobs, readAnalyticsSettings, readClientNames, readDecisions } from "@/lib/analytics/analytics-query";
import { rulesOf } from "@/lib/analytics/settings";
import { lostOffer, workOrderOffer } from "@/lib/analytics/cleanup-offer";
import { fyChoices, fyOf } from "@/lib/tax/fy";
import { taxYear } from "@/lib/tax/query";
import { AnalyticsScreen, type AnalyticsState } from "@/components/analytics/analytics-screen";
import type { TaxState } from "@/components/analytics/tax-view";

/* Reports — what the business's own jobs say about its quoting (win rate,
   prices by job type, the 180-day rule; docs/job-analytics-plan.md), counted
   by the business's own settings (Settings, Reports), and Tax and EOFY, a
   year's field spend and its receipts (it was Admin, Tax & EOFY; Isaac, 25
   October 2026: "Tax and EOFY as a view in Reports").

   EACH VIEW GATES ON ITS OWN, and the page lets in whoever holds either
   (rule 7: Reports shows to whoever holds the permission each report
   needs). The jobs' three need `workboard_money`, because every figure on
   them is job money: owner-tier by default, granted per person. Tax and
   EOFY needs `financials`, the business's money rather than its jobs', which
   is what lets a bookkeeper have the export without the jobs' money or an
   owner's seat. Neither is read for a viewer without its grant. The gates
   live here because a leaf route is deep-linkable.

   The period and the year live in the address (`?period=`, `?view=tax&fy=`),
   so a link to a year can be sent to an accountant as it is. */

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[]; view?: string | string[]; fy?: string | string[] }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const [jobMoney, financials] = await Promise.all([can("workboard_money"), can("financials")]);
  if (!jobMoney && !financials) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const params = await searchParams;
  const asked = first(params.period);
  const period = isPeriodKey(asked) ? asked : DEFAULT_PERIOD;

  const [state, tax] = await Promise.all([
    jobMoney ? jobReports(orgId, period) : Promise.resolve(null),
    financials ? taxReport(orgId, first(params.fy)) : Promise.resolve(null),
  ]);
  return <AnalyticsScreen state={state} period={period} tax={tax} initialView={first(params.view) === "tax" ? "tax" : undefined} />;
}

/** The jobs' three views, off ServiceM8's copy. */
async function jobReports(orgId: string, period: PeriodKey): Promise<AnalyticsState> {
  /* Needs-reauth is not disconnected (page-data): the copy is still whole,
     only refreshing it waits. With no connection there is nothing to read. */
  if ((await getConnectionView(orgId, "servicem8")) === null) return { kind: "standalone" };

  /* how this business counts its jobs (Settings, Reports), before the jobs are read by it */
  const [zone, { settings }] = await Promise.all([getSm8Timezone(orgId), readAnalyticsSettings(orgId)]);
  const today = todayInZone(zone);
  const [read, kept, workOrders, lostWrites] = await Promise.all([
    readAnalyticsJobs(orgId, spanBefore(periodSpan(period, today)).from, settings),
    readDecisions(orgId),
    workOrderOffer(orgId),
    lostOffer(orgId),
  ]);
  if (!read) return { kind: "unread" };
  const data = analyse(read.jobs, today, period, kept.decisions, rulesOf(settings, read.found.closeAge?.days ?? null));
  /* the client names the rows of jobs show, and only theirs */
  const names = await readClientNames(
    orgId,
    [...data.toDecide.asks.map((a) => a.job), ...data.quotes.lostJobs.map((l) => l.job), ...data.voided]
      .map((j) => j.clientId)
      .filter((c): c is string => !!c),
  );
  return { kind: "ready", data, truncated: read.truncated, names, canDecide: kept.ready, workOrders, lostWrites };
}

/** Tax and EOFY: the year asked for, if the picker offers it, else the one
    running. The receipts are signed for the page, and expire. */
async function taxReport(orgId: string, askedFy: string | undefined): Promise<TaxState> {
  const today = todayInAu();
  const choices = fyChoices(today);
  const asked = Number(askedFy);
  const fy = choices.includes(asked) ? asked : fyOf(today);
  return { year: await taxYear(orgId, fy, { signReceipts: true }), choices, today };
}
