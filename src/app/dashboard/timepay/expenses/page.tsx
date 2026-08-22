import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TimepayScreen } from "@/components/timepay/timepay-screen";
import { loadTimepaySection } from "@/lib/timepay/section";

/* The Expenses face of team Time & Pay — same `timepay_all` gate and the same
   combined load; this URL only picks the Expenses face first. Your own claims
   live at /dashboard/my-expenses and are never gated.

   The `approvals` / `financials` split the old page described still holds —
   it just crosses inside the section payload now: an approver decides whether
   a spend was legitimate, `financials` records that the money moved, and no
   wage column is read anywhere in this path. */

export default async function TeamExpensesPage() {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-expenses");

  const section = await loadTimepaySection();
  if (!section) redirect("/dashboard");

  return <TimepayScreen initialTab="expenses" section={section} />;
}
