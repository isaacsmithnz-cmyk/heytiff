import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";
import { ToolboxScreen } from "@/components/toolbox/toolbox-screen";

/* The field tools are the Library's Toolbox category (v2 audit, 20 October
   2026), so this address opens it there. Someone with the tools and not
   the Library (`toolbox` without `tiff`) has no Library to open, and keeps
   the tools' own list here. */
export default async function ToolboxPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
  if (await can("tiff")) redirect("/dashboard/tiff/library?view=toolbox");
  return <ToolboxScreen today={todayInAu()} />;
}
