import { ActionRequiredBoard } from "@/components/dashboard/action-required-board";
import { loadActionRequired } from "@/lib/dashboard/page-data";

/* Ungated, like the dashboard itself — everyone has their own expiries to see.
   What the team's and the fleet's chips add is decided by capability inside
   assembleChips, so there is nothing to gate at the route. */
export default async function ActionRequiredPage() {
  const chips = await loadActionRequired();
  return <ActionRequiredBoard chips={chips} />;
}
