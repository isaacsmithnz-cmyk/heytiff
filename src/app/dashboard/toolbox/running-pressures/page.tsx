import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { ToolPage } from "@/components/toolbox/tool-page";
import { RunningPressures } from "@/components/toolbox/running-pressures";

// Deep-linkable leaf — same `toolbox` gate as the index page: the capability
// is revocable, so every route checks for itself, not just the nav entry.
export default async function RunningPressuresPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
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
