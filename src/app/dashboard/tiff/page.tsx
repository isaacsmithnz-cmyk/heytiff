import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TiffAssistant } from "@/components/tiff/assistant";
import { demoKbDocs } from "@/mock/demo";

// `tiff` is on by default for every role but revocable — gate the route, not
// just the nav entry.
export default async function TiffPage() {
  if (!(await can("tiff"))) redirect("/dashboard");
  return <TiffAssistant docs={demoKbDocs} />;
}
