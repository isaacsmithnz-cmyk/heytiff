import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { IntegrationsIndex } from "@/components/integrations/integrations-index";
import { PROVIDERS } from "@/lib/integrations/providers";
import { getConnectionView } from "@/lib/integrations/store";
import type { ConnectionView } from "@/lib/integrations/connection";

/* Integrations — owner-only, the same gate as organisation settings and as
   both OAuth route handlers. A connected accounting system is not a delegable
   capability: one grant reaches wages, bills and the P&L at once.

   The connection lookups run per provider so a new entry in PROVIDERS needs
   nothing here. */

export default async function IntegrationsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");

  const orgId = session.orgId as string;
  const views = await Promise.all(PROVIDERS.map((p) => getConnectionView(orgId, p.id)));

  const connections: Record<string, ConnectionView | undefined> = {};
  PROVIDERS.forEach((p, i) => {
    connections[p.id] = views[i] ?? undefined;
  });

  return <IntegrationsIndex connections={connections} />;
}
