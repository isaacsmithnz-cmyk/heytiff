import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { IntegrationsScreen } from "@/components/integrations/integrations-screen";
import { loadServicem8, loadXero, type Query } from "./load";

/* SETTINGS › INTEGRATIONS (v2, 25 October 2026): ServiceM8 and Xero on one
   page, as the mock draws them (Isaac: "just should be called integration.
   Or integrations"). Owner-only, the same gate as the business's details
   and as both OAuth route handlers: a connected accounting system is not a
   delegable capability, since one grant reaches wages, bills and the P&L at
   once.

   The two apps' reads run side by side. An OAuth round trip comes back to
   its own app's old address, which sends it here with `from` naming the
   app, so the sentence it ends in is said in that app's group and nowhere
   else. */

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");

  const params = await searchParams;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const orgId = session.orgId as string;
  const [servicem8, xero] = await Promise.all([
    loadServicem8(orgId, from === "servicem8" ? params : {}),
    loadXero(orgId, from === "xero" ? params : {}),
  ]);

  return <IntegrationsScreen servicem8={servicem8} xero={xero} />;
}
