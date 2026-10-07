import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { analyse, DEFAULT_PERIOD, isPeriodKey, periodSpan, spanBefore } from "@/lib/analytics/job-analytics";
import { readAnalyticsJobs, readClientNames, readDecisions } from "@/lib/analytics/analytics-query";
import { AnalyticsScreen } from "@/components/analytics/analytics-screen";

/* Analytics — what the business's own jobs say about its quoting: win rate,
   prices by job type, the 180-day rule (docs/job-analytics-plan.md). Gated by
   `workboard_money`, because every figure on it is job money: owner-tier by
   default, granted per person. The gate lives here because a leaf route is
   deep-linkable. */

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("workboard_money"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const asked = (await searchParams).period;
  const period = isPeriodKey(asked) ? asked : DEFAULT_PERIOD;

  /* Needs-reauth is not disconnected (page-data): the copy is still whole,
     only refreshing it waits. With no connection there is nothing to read. */
  if ((await getConnectionView(orgId, "servicem8")) === null) {
    return <AnalyticsScreen state={{ kind: "standalone" }} period={period} />;
  }

  const today = todayInZone(await getSm8Timezone(orgId));
  const [read, kept] = await Promise.all([readAnalyticsJobs(orgId, spanBefore(periodSpan(period, today)).from), readDecisions(orgId)]);
  if (!read) return <AnalyticsScreen state={{ kind: "unread" }} period={period} />;
  const data = analyse(read.jobs, today, period, kept.decisions);
  /* the client names the To decide rows show, and only theirs */
  const names = await readClientNames(
    orgId,
    data.toDecide.asks.map((a) => a.job.clientId).filter((c): c is string => !!c),
  );
  return (
    <AnalyticsScreen
      state={{ kind: "ready", data, truncated: read.truncated, names, canDecide: kept.ready }}
      period={period}
    />
  );
}
