import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { ToolPage } from "@/components/toolbox/tool-page";
import { OutdoorUnit } from "@/components/toolbox/outdoor-unit";

export const metadata = { title: "Outdoor Unit Placement · Toolbox" };

// Deep-linkable leaf — same `toolbox` gate as the index page: the capability
// is revocable, so every route checks for itself, not just the nav entry.
export default async function OutdoorUnitPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
  return (
    <ToolPage
      category="Reference Library"
      accent="#8A2BE2"
      accentInk="#6D28D9"
      title="Outdoor Unit Placement"
      sub="Where an outdoor unit can sit in NSW without council approval."
      compact
    >
      <OutdoorUnit />
    </ToolPage>
  );
}
