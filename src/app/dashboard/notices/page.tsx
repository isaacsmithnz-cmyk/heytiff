import { redirect } from "next/navigation";

/* Retired (the v2 audit, 20 October 2026): the notices are Team's Notices
   view, and everyone has Team (Isaac, 20 October 2026). */
export default function NoticesPage(): never {
  redirect("/dashboard/team?view=notices");
}
