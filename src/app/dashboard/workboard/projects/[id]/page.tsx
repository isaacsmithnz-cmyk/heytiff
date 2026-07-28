import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { getProjectDetail } from "@/lib/workboard/projects-query";
import { getConnectionView } from "@/lib/integrations/store";
import { ProjectDetailScreen } from "@/components/workboard/project-detail-screen";

/* One project, whole story: stage, checklist, equipment, linked jobs (with
   the mirror's garnish when connected), design link. The id names a CHOICE —
   the loader re-resolves it inside the caller's org, so a foreign id is a
   404, not a leak. */

export default async function WorkboardProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");

  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const { id } = await params;
  const [project, manage, connection] = await Promise.all([
    getProjectDetail(orgId, id),
    can("workboard_manage"),
    getConnectionView(orgId, "servicem8"),
  ]);
  if (!project) notFound();

  return (
    <ProjectDetailScreen
      project={project}
      manage={manage}
      sm8Connected={connection?.status === "connected"}
    />
  );
}
