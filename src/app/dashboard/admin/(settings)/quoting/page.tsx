import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readQuoteSettings } from "@/lib/quotes/settings-query";
import { readCalcDay } from "@/lib/quotes/org-day-server";
import { QuotingScreen } from "@/components/admin/quoting-screen";

/* SETTINGS › QUOTING — the settings a quote is priced by: the charge-out
   rate and the working day (else the Rate Calculator's), markup on units
   and on materials, the duct contingency, the profit target, the
   allowances, the task hours and what every job starts with. What prices
   each part is the Price book's section now. Gated by `financials`, the
   Rate Calculator's grant, because this is the business's margin. */

export default async function QuotingPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [settings, calc] = await Promise.all([readQuoteSettings(orgId), readCalcDay(orgId)]);
  return <QuotingScreen initial={settings} calc={calc} />;
}
