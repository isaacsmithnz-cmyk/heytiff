import { ToolPage } from "@/components/toolbox/tool-page";
import { FaultFinder } from "@/components/toolbox/fault-finder";

export default function TroubleshootingPage() {
  return (
    <ToolPage
      category="Troubleshooting"
      accent="#FF3366"
      accentInk="#E0244B"
      title="Fault Finder"
      sub="Symptom-based diagnosis for splits and ducted systems — likely causes first, with what to check and how to fix it."
    >
      <FaultFinder />
    </ToolPage>
  );
}
