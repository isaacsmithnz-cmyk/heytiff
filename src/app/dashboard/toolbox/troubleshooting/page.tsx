import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { ToolPage } from "@/components/toolbox/tool-page";
import { FaultFinder } from "@/components/toolbox/fault-finder";

// Deep-linkable leaf — same `toolbox` gate as the index page: the capability
// is revocable, so every route checks for itself, not just the nav entry.
export default async function TroubleshootingPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
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
