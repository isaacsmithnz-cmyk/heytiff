import { ToolPage } from "@/components/toolbox/tool-page";
import { RunningPressures } from "@/components/toolbox/running-pressures";

export default function RunningPressuresPage() {
  return (
    <ToolPage
      category="Troubleshooting"
      accent="#FF3366"
      accentInk="#E0244B"
      title="Running Pressures"
      sub="R32 / R410A saturation reference — typical operating windows, the full PT chart, and a live superheat / subcooling calculator."
    >
      <RunningPressures />
    </ToolPage>
  );
}
