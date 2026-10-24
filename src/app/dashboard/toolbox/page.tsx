import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";

/* The field tools are the Library's Toolbox shelf (v2 audit, 20 October
   2026), so this address opens it there: someone with the tools and not
   the Library gets that shelf alone (24 October 2026; the old Toolbox
   screen went). */
export default async function ToolboxPage(): Promise<never> {
  if (!(await can("toolbox"))) redirect("/dashboard");
  redirect("/dashboard/tiff/library?view=toolbox");
}
