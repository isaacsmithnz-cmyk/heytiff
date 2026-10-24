import { redirect } from "next/navigation";
import { projectHref } from "@/lib/shell/links";

/* A project's page is under Jobs (24 October 2026): an old link lands there. */
export default async function OldProjectPage({ params }: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await params;
  redirect(projectHref(id));
}
