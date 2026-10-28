import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";

/* OFF THE TOOLBOX FOR NOW (Isaac, 28 October 2026: "remove the New South
   Wales unit placement thing. Just have the three of them in for now"). A
   link someone kept lands on the Toolbox; the rules and the drawing stay in
   lib/toolbox/outdoor-unit and components/toolbox/outdoor-unit for when it
   comes back. Same `toolbox` gate as every leaf: revoked goes to Home. */
export default async function OutdoorUnitPage() {
  if (!(await can("toolbox"))) redirect("/dashboard");
  redirect("/dashboard/tiff/library?view=toolbox");
}
