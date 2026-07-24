import { ToolPage } from "@/components/toolbox/tool-page";
import { OutdoorUnit } from "@/components/toolbox/outdoor-unit";

export const metadata = { title: "Outdoor Unit Placement · Toolbox" };

export default function OutdoorUnitPage() {
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
