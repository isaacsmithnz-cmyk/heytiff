import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { listProjects } from "@/lib/workboard/projects-query";
import { ProjectsScreen } from "@/components/workboard/projects-screen";

/* The project list. Same door as the board itself (`workboard` — see the
   route-gate test); creating and editing check `workboard_manage` per action,
   and the screen only OFFERS what the server will allow. */

export default async function WorkboardProjectsPage() {
  if (!(await can("workboard"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const [projects, manage] = await Promise.all([
    listProjects(orgId, { includeArchived: false }),
    can("workboard_manage"),
  ]);

  return <ProjectsScreen projects={projects} manage={manage} />;
}
