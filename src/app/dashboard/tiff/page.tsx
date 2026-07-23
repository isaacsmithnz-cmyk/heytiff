import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { TiffAssistant } from "@/components/tiff/assistant";

// `tiff` is on by default for every role but revocable — gate the route, not
// just the nav entry.
//
// The knowledge base is empty until real uploads land (Documents/storage
// track); the assistant renders its own empty state from that.
export default async function TiffPage() {
  if (!(await can("tiff"))) redirect("/dashboard");
  return <TiffAssistant docs={[]} />;
}
