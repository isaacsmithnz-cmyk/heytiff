import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { integrationsAddress } from "../back-to";
import type { Query } from "../load";

/* ServiceM8's own address, kept: its OAuth callback comes back here
   (api/integrations/servicem8/callback), and so do links from a job, Home
   and Reports. ServiceM8 is a group of Settings › Integrations now, so this
   sends you on to it with how the round trip ended. Owner-only, as it was. */
export default async function Servicem8IntegrationPage({ searchParams }: { searchParams: Promise<Query> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");
  redirect(integrationsAddress("servicem8", await searchParams));
}
