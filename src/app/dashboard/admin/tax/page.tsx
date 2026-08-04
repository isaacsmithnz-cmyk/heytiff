import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { fyChoices, fyOf } from "@/lib/tax/fy";
import { taxYear } from "@/lib/tax/query";
import { TaxScreen } from "@/components/tax/tax-screen";

/* Tax & EOFY — gated by `financials`, the same capability as the Rate
   Calculator and for the same reason: this is the business's money, not the
   business's people. Owner has it by default and may grant it to an admin,
   which is what makes it possible to give a bookkeeper the export without
   making them an owner.

   The year lives in the URL. It means a link to a particular financial year
   can be sent to an accountant, the browser's back button does the obvious
   thing, and the export button is a plain href rather than something that has
   to be kept in sync with a piece of component state. */

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!(await can("financials"))) redirect("/dashboard");

  const orgId = session.orgId as string | undefined;
  const today = todayInAu();
  const choices = fyChoices(today);
  const asked = Number((await searchParams).fy);
  const fy = choices.includes(asked) ? asked : fyOf(today);

  const year = orgId
    ? await taxYear(orgId, fy, { signReceipts: true })
    : { fy, items: [], totals: { amount: 0, gst: 0, count: 0, withReceipt: 0, provisionalAmount: 0, byCategory: [] } };

  return <TaxScreen year={year} choices={choices} today={today} />;
}
