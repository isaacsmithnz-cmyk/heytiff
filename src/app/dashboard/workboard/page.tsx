import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadWorkboardPage } from "@/lib/workboard/page-data";
import { OverviewScreen } from "@/components/workboard/overview-screen";

/* The Workboard — Overview today; Projects and Maintenance land as their own
   sub-pages. Gated by the `workboard` capability (a staff DEFAULT — the board
   is for the people on the tools), and the gate lives here because a leaf
   route is deep-linkable: a revoked member typing the URL lands back on
   /dashboard exactly as if the nav entry weren't there. */

export default async function WorkboardPage() {
  if (!(await can("workboard"))) redirect("/dashboard");

  const data = await loadWorkboardPage();
  if (!data) redirect("/dashboard");

  return <OverviewScreen data={data} />;
}
