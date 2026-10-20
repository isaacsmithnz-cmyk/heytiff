import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";

/* Retired (v2 audit, 20 October 2026): the team's leave is Team's Leave
   view. Your own leave lives at /dashboard/my-leave and is never gated. */
export default async function TeamLeavePage(): Promise<never> {
  redirect((await can("timepay_all")) ? "/dashboard/team?view=leave" : "/dashboard/my-leave");
}
