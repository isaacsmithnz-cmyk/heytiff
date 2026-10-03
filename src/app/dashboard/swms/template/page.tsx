import { redirect } from "next/navigation";

/* The SWMS template moved to Admin → Templates (2026-10-03). This address
   stays so links already sent, and old bell items, still land on it. */
export default function SwmsTemplatePage() {
  redirect("/dashboard/admin/templates?sec=swms");
}
