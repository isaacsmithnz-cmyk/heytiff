import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { periodSpan, spanBefore } from "@/lib/analytics/job-analytics";
import { readAnalyticsJobs, readAnalyticsSettings, readCategories, readClientNames } from "@/lib/analytics/analytics-query";
import { AnalyticsSettingsScreen, type ClientView } from "@/components/admin/analytics-settings-screen";

/* Admin, Analytics — how the business's jobs are counted (Isaac, 2026-10-07:
   "Settings options maybe?"; src/lib/analytics/settings.ts). Gated by
   `workboard_money`, the Analytics page's own grant: every setting moves a
   figure of job money. The jobs of the last two years are read for what a
   setting stands in for: the clients whose cards are bookings, and the age
   ServiceM8 closes an unanswered Quote at. */

export default async function AnalyticsSettingsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("workboard_money"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [{ settings, ready }, connected, zone] = await Promise.all([
    readAnalyticsSettings(orgId),
    getConnectionView(orgId, "servicem8"),
    getSm8Timezone(orgId),
  ]);
  const today = todayInZone(zone);
  const [categories, read] = connected
    ? await Promise.all([readCategories(orgId), readAnalyticsJobs(orgId, spanBefore(periodSpan("12m", today)).from, settings)])
    : [[], null];
  const found = read?.found ?? null;

  const foundClients = found?.bookingClients ?? [];
  const listedOnly = (settings.notCustomers ?? []).filter((id) => !foundClients.some((c) => c.clientId === id));
  const names = await readClientNames(orgId, [...foundClients.map((c) => c.clientId), ...listedOnly]);
  const clients: ClientView[] = [
    ...foundClients.map((c) => ({ id: c.clientId, name: names[c.clientId] ?? "A client with no name", cards: c.cards })),
    ...listedOnly.map((id) => ({ id, name: names[id] ?? "A client no longer in ServiceM8's copy", cards: null })),
  ];

  return (
    <AnalyticsSettingsScreen
      initial={settings}
      ready={ready}
      categories={categories.map((c) => ({ ...c, jobs: found?.byCategory[c.uuid] ?? 0 }))}
      clients={clients}
      closeAge={found?.closeAge ?? null}
    />
  );
}
