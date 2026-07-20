import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { loadRateCalcState } from "@/app/actions/rate-calc";
import { RateCalculator } from "@/components/rate-calculator/rate-calculator";

// Gated by `financials`, not by role: charge-out is built from wages. Owner
// has it by default; an admin only if the owner grants it in Team.

export default async function RateCalculatorPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  if (!(await can("financials"))) redirect("/dashboard");

  const row = await loadRateCalcState();
  return (
    <RateCalculator
      initialState={row?.state ?? null}
      initialUpdatedAt={row?.updatedAt ?? null}
    />
  );
}
