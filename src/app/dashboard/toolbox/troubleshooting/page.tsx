import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { ToolPage } from "@/components/toolbox/tool-page";
import { FaultFinder } from "@/components/toolbox/fault-finder";
import { kbCategoryCounts } from "@/lib/tiff/query";

/* Deep-linkable leaf — same `toolbox` gate as the index page: the capability
   is revocable, so every route checks for itself, not just the nav entry.

   WHETHER THE LIBRARY CAN BE OFFERED IS DECIDED HERE, because both halves of
   the answer are server-side: `tiff` is a separate revocable capability from
   `toolbox`, and only ready documents can be cited. A tech without the
   assistant never sees the offer, and a workspace with an empty Library is told
   what would fill them instead of being sent to search nothing. Same rule the
   assistant's own Research toggle keeps. */
export default async function TroubleshootingPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const canAsk = await can("tiff");
  let library: "ready" | "empty" | "off" = "off";
  if (canAsk && orgId) {
    const counts = await kbCategoryCounts(orgId);
    const ready = Object.values(counts).reduce((sum, n) => sum + n, 0);
    library = ready > 0 ? "ready" : "empty";
  }

  return (
    <ToolPage
      category="Troubleshooting"
      accent="#FF3366"
      accentInk="#E0244B"
      title="Fault Finder"
      sub="Guided diagnosis for splits, ducted, multi and VRF — one question at a time, the way you'd walk an apprentice through it."
    >
      <FaultFinder library={library} />
    </ToolPage>
  );
}
