import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { getProjectDetail } from "@/lib/workboard/projects-query";
import { loadProjectsBoard } from "@/lib/workboard/projects-board-query";
import { listIssues, listProjectEntries } from "@/lib/workboard/notes-query";
import { getConnectionView } from "@/lib/integrations/store";
import { getSm8Timezone } from "@/lib/workboard/query";
import { todayInZone } from "@/lib/workboard/dates";
import { ProjectDetailScreen } from "@/components/workboard/project-detail-screen";

/* One project, whole story: stage, trips, checklist, money, equipment,
   linked jobs (with the mirror's garnish when connected), design link. The
   id names a CHOICE — the loader re-resolves it inside the caller's org, so
   a foreign id is a 404, not a leak.

   Trips come from the SAME loader the board reads (loadProjectsBoard), so
   this page and the board can never tell different stories about a trip —
   K2's rule, applied to the route. */

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
  const today = todayInZone(await getSm8Timezone(orgId));
  // Money is its own grant (`workboard_money`, owner-tier) — asked once here
  // and handed to both loaders, so neither reads what this person may not see.
  const includeMoney = await can("workboard_money");
  const [project, board, manage, connection, entries, issues] = await Promise.all([
    getProjectDetail(orgId, id, { includeMoney }),
    loadProjectsBoard(orgId, today, { includeMoney }),
    can("workboard_manage"),
    getConnectionView(orgId, "servicem8"),
    listProjectEntries(orgId, id),
    listIssues(orgId, "project", id),
  ]);
  if (!project) notFound();

  return (
    <ProjectDetailScreen
      project={project}
      trips={board.visits.filter((v) => v.projectId === id)}
      staff={board.staff}
      today={today}
      manage={manage}
      sm8Connected={connection?.status === "connected"}
      entries={entries}
      issues={issues}
    />
  );
}
