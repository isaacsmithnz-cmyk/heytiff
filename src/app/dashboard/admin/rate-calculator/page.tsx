import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getOrgRole, hasMinRole } from "@/lib/roles";
import { loadRateCalcState } from "@/app/actions/rate-calc";
import { RateCalculator } from "@/components/rate-calculator/rate-calculator";

export default async function RateCalculatorPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const role = await getOrgRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");

  const row = await loadRateCalcState();
  return (
    <RateCalculator
      initialState={row?.state ?? null}
      initialUpdatedAt={row?.updatedAt ?? null}
    />
  );
}
