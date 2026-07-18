import { ToolPage } from "@/components/toolbox/tool-page";
import { RunningPressures } from "@/components/toolbox/running-pressures";

export default function RunningPressuresPage() {
  return (
    <ToolPage
      category="Troubleshooting"
      accent="#FF3366"
      accentInk="#E0244B"
      title="Running Pressures"
      sub="R32 · R410A · R22 and every refrigerant you'll meet — expected gauge readings at a glance, the PT chart, and live superheat / subcooling."
    >
      <RunningPressures />
    </ToolPage>
  );
}
