import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { loadRateCalcState } from "@/app/actions/rate-calc";
import { rosterForRateCalc } from "@/lib/staff/rate-roster";
import { RateCalculator } from "@/components/rate-calculator/rate-calculator";
import { getConnectionView } from "@/lib/integrations/store";

// Gated by `financials`, not by role: charge-out is built from wages. Owner
// has it by default; an admin only if the owner grants it in Team.

export default async function RateCalculatorPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");

  const orgId = session.orgId as string | undefined;
  // Staff are read from the roster now — the tool never writes wages. The same
  // `financials` gate on this page protects the wage columns the query selects.
  const [row, roster, connection] = await Promise.all([
    loadRateCalcState(),
    orgId ? rosterForRateCalc(orgId) : Promise.resolve([]),
    // Only whether a grant exists — the Business step offers Xero as a source
    // of overheads, and needs nothing else about the connection to do that.
    orgId ? getConnectionView(orgId, "xero") : Promise.resolve(null),
  ]);

  return (
    <RateCalculator
      initialState={row?.state ?? null}
      initialUpdatedAt={row?.updatedAt ?? null}
      roster={roster}
      xeroConnected={connection?.status === "connected"}
    />
  );
}
