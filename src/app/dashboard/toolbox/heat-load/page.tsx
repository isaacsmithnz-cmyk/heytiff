import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { ToolPage } from "@/components/toolbox/tool-page";
import { HeatLoadCalculator } from "@/components/toolbox/heat-load";

// Deep-linkable leaf — same `toolbox` gate as the index page: the capability
// is revocable, so every route checks for itself, not just the nav entry.
export default async function HeatLoadPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
  return (
    <ToolPage
      category="Calculators"
      accent="#00E5C0"
      accentInk="#00A389"
      title="Heat Load"
      sub="Instant sizing check — type the room, get the kW and the unit class. Same engine as the Design Studio."
    >
      <HeatLoadCalculator />
    </ToolPage>
  );
}
