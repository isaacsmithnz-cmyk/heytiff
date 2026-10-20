import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";

/* Retired (v2 audit, 20 October 2026): the team's claims are Team's
   Expenses view. Your own claims live at /dashboard/my-expenses and are
   never gated. */
export default async function TeamExpensesPage(): Promise<never> {
  redirect((await can("timepay_all")) ? "/dashboard/team?view=expenses" : "/dashboard/my-expenses");
}
