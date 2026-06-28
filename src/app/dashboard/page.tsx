import { auth0 } from "@/lib/auth0";
import { Screen } from "@/components/shell/screen";
import { homeHtml } from "@/components/shell/screens";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardHome() {
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

  return (
    <Screen html={homeHtml({ greeting: greetingFor(now.getHours()), firstName, date })} />
  );
}
