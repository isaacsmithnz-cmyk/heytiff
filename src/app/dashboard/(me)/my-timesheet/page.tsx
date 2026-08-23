import { MeScreen } from "@/components/me/me-screen";
import { loadMe } from "@/lib/me/page-data";

/* Ungated: your own timesheet is intrinsic, like your own vehicle.
   `timepay_all` gates everyone else's, never this.

   ALL FIVE FACES LOAD HERE — see lib/me/page-data.ts. This route only decides
   which one opens; the period is its own, because paging through the weeks is
   a real navigation that has to survive a reload and a shared link. */
export default async function MyTimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  return <MeScreen initialTab="timesheet" data={await loadMe(period)} />;
}
