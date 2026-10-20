import { redirect } from "next/navigation";

/* Retired (v2 audit, 20 October 2026): the projects are Jobs' Projects
   view. A project's own page, /dashboard/workboard/projects/<id>, stays. */
export default function ProjectsPage(): never {
  redirect("/dashboard/jobs?view=projects");
}
