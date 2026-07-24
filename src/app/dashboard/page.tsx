import { auth0 } from "@/lib/auth0";
import { DashboardHome } from "@/components/dashboard/home";
import { loadDashboard } from "@/lib/dashboard/page-data";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardHomePage() {
  const session = await auth0.getSession();
  const email = session?.user.email ?? "";
  const name = (session?.user.name as string | undefined) ?? email.split("@")[0] ?? "there";
  const firstName = name.trim().split(/\s+/)[0] || "there";

  const now = new Date();
  const date = now.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const data = await loadDashboard();

  return (
    <DashboardHome
      greeting={greetingFor(now.getHours())}
      firstName={firstName}
      date={date}
      data={data}
    />
  );
}
