import { redirect } from "next/navigation";

/* Tax and EOFY is a view in Reports (Isaac, 25 October 2026: "Tax and EOFY
   as a view in Reports"). This address was the page; a saved link, or one
   sent to an accountant, lands on the view with its year. Reports gates
   itself (`financials` for this view). The CSV is still served from
   ./export, which keeps its own gate. */
export default async function TaxPage({ searchParams }: { searchParams: Promise<{ fy?: string | string[] }> }): Promise<never> {
  const asked = (await searchParams).fy;
  const fy = Number(Array.isArray(asked) ? asked[0] : asked);
  redirect(Number.isInteger(fy) && fy > 0 ? `/dashboard/analytics?view=tax&fy=${fy}` : "/dashboard/analytics?view=tax");
}
