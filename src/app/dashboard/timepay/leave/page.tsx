import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TimepayScreen } from "@/components/timepay/timepay-screen";
import { loadTimepaySection } from "@/lib/timepay/section";

/* The Leave face of team Time & Pay — same gate as the other two faces, and
   the same combined load; this URL only picks the Leave face first. Your own
   leave lives at /dashboard/my-leave and is never gated. */

export default async function TeamLeavePage() {
  if (!(await can("timepay_all"))) redirect("/dashboard/my-leave");

  const section = await loadTimepaySection();
  if (!section) redirect("/dashboard");

  return <TimepayScreen initialTab="leave" section={section} />;
}
