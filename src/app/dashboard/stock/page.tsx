import { redirect } from "next/navigation";
import { can, requireOrg } from "@/lib/permissions-server";
import { readStock } from "@/lib/stock/stock-server";
import { StockPage } from "@/components/stock/stock-page";

/* STOCK (lib/stock/stock.ts): what next week's and the week after's booked
   jobs need, as a shopping list and by job, and Later, what the accepted
   jobs need past them. Gated like Jobs and Schedule,
   by `workboard`. The week and the view ride in the address, so a tab holds
   them. Until docs/migrations/stock_marks.sql is on the database it says
   so, and nothing is written. */

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function StockRoute({ searchParams }: { searchParams: Params }) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const { orgId } = await requireOrg("workboard");
  const w = (await searchParams).week;
  const week = w === "after" ? "after" : w === "later" ? "later" : "next";
  const view = await readStock(orgId, week);
  return <StockPage key={week} initial={view} />;
}
