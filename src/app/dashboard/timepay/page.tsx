import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TimepayScreen } from "@/components/timepay/timepay-screen";
import { loadTimepaySection } from "@/lib/timepay/section";

/* Capability-gated: this is the EVERYONE view. Your own timesheet lives at
   /dashboard/my-timesheet and is never gated.

   All three faces load here — see lib/timepay/section.ts for what moved when
   the tabs stopped being routes, and timepay-screen.tsx for the URL contract.
   `?period=` still belongs to this URL: the Timesheets face pushes it to
   itself, and that push is a real navigation because a different week IS
   different data. */

export default async function TimePayPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-timesheet");

  const { period } = await searchParams;
  const section = await loadTimepaySection(period);
  if (!section) redirect("/dashboard");

  return <TimepayScreen initialTab="sheets" section={section} />;
}
