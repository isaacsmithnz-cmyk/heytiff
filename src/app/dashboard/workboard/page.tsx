import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { jobPageHref, visitHref } from "@/lib/shell/links";

/* RETIRED (the v2 audit, 20 October 2026; the old-code audit, 23 October):
   the Workboard's views are Jobs' and the Schedule's. Its address stays for
   saved links: a job opens on its own page (on its Quote section when the
   old face named it), a visit opens its sheet over Jobs, a client's search
   is Jobs' search, and the board itself is Jobs. */

export default async function WorkboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    job?: string | string[];
    face?: string | string[];
    q?: string | string[];
    visit?: string | string[];
  }>;
}): Promise<never> {
  if (!(await can("workboard"))) redirect("/dashboard");
  const asked = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
  const job = one(asked.job);
  if (job) redirect(jobPageHref(job, asked.face === "quote" ? "quote" : undefined));
  const visit = one(asked.visit);
  if (visit) redirect(visitHref(visit));
  const q = one(asked.q).slice(0, 120);
  redirect(q ? `/dashboard/jobs?q=${encodeURIComponent(q)}` : "/dashboard/jobs");
}
