import { ToolPage } from "@/components/toolbox/tool-page";
import { FaultFinder } from "@/components/toolbox/fault-finder";

export default function TroubleshootingPage() {
  return (
    <ToolPage
      category="Troubleshooting"
      accent="#FF3366"
      accentInk="#E0244B"
      title="Fault Finder"
      sub="Guided diagnosis for splits, ducted, multi and VRF — one question at a time, the way you'd walk an apprentice through it."
    >
      <FaultFinder />
    </ToolPage>
  );
}
