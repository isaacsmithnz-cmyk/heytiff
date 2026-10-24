import { redirect } from "next/navigation";
import { projectsHref } from "@/lib/shell/links";

/* The projects are Jobs' Projects view; a project's own page is below this. */
export default function JobsProjectsPage(): never {
  redirect(projectsHref);
}
