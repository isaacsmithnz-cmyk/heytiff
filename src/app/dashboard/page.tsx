import { auth0 } from "@/lib/auth0";
import { auHourNow, fmtAuWeekdayDateLong, todayInAu } from "@/lib/au-dates";
import { DashboardHome } from "@/components/dashboard/home";
import { loadDashboard } from "@/lib/dashboard/page-data";
import { getViewerName } from "@/lib/staff/query";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardHomePage() {
  const session = await auth0.getSession();
  const email = session?.user.email ?? "";
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;

  // Greet people by their name, not their email address — the staff record owns
  // it, and a preferred name wins when they've set one. Same cached read the
  // shell topbar uses, so this costs nothing extra.
  const fallback = (session?.user.name as string | undefined) ?? email.split("@")[0] ?? "there";
  const firstName =
    orgId && userId ? (await getViewerName(orgId, userId, fallback)).first : fallback;

  // The greeting reads the YARD's clock, not the server's: this renders on
  // UTC Vercel, where every AU morning is still yesterday evening — raw
  // new Date() showed the wrong date and said "Good evening" at 9am Sydney.
  const date = fmtAuWeekdayDateLong(todayInAu());

  const data = await loadDashboard();

  return (
    <DashboardHome
      greeting={greetingFor(auHourNow())}
      firstName={firstName}
      date={date}
      data={data}
    />
  );
}
