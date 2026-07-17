import { ToolPage } from "@/components/toolbox/tool-page";
import { HeatLoadCalculator } from "@/components/toolbox/heat-load";

export default function HeatLoadPage() {
  return (
    <ToolPage
      category="Calculators"
      accent="#00E5C0"
      accentInk="#00A389"
      title="Heat Load"
      sub="Room-by-room design load sizing — the same rule-of-thumb engine the Design Studio uses, for quick quotes and sanity checks in the field."
    >
      <HeatLoadCalculator />
    </ToolPage>
  );
}
