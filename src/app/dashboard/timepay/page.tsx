import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";

/* Retired (v2 audit, 20 October 2026): the team's timesheets are Team's
   Timesheets view, which reads the same `?period=`. Your own timesheet is
   /dashboard/my-timesheet and is never gated. */
export default async function TimePayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}): Promise<never> {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-timesheet");
  const { period } = await searchParams;
  const q = new URLSearchParams({ view: "timesheets" });
  if (typeof period === "string" && period) q.set("period", period);
  redirect(`/dashboard/team?${q}`);
}
