import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { Studio } from "@/components/studio/studio";

// `studio` is on by default for every role but revocable — gate the route,
// not just the nav entry.
export default async function StudioPage() {
  if (!(await can("studio"))) redirect("/dashboard");
  return <Studio />;
}
