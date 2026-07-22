import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { ToolboxScreen } from "@/components/toolbox/toolbox-screen";

// `toolbox` is on by default for every role, but it is revocable — so the
// route has to check, not just the nav entry.
export default async function ToolboxPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
  return <ToolboxScreen />;
}
