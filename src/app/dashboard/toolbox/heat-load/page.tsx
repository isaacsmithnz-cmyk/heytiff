import { ToolPage } from "@/components/toolbox/tool-page";
import { HeatLoadCalculator } from "@/components/toolbox/heat-load";

export default function HeatLoadPage() {
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
