import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { quoteHref } from "@/lib/shell/links";

/* THE QUOTE'S OLD PAGE (/dashboard/jobs/<id>/quote, 24 October to 15
   November 2026). The quote and the job's Price tab are one page now (the
   job page plan's build 10), so an old link lands there, asking what it
   asked: `?start=1` the quote with its reply box ready for the brief,
   `?option=N` that option, `?update=1` Update quote. The Workboard is its
   gate, as the job page's; the job page resolves the job inside the
   caller's org. */

export default async function JobQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const job = id.trim().slice(0, 80);
  if (!job) notFound();
  const raw = typeof sp.option === "string" ? Number(sp.option) : NaN;
  const option = Number.isInteger(raw) && raw >= 0 && raw <= 19 ? raw : null;
  redirect(quoteHref(job, { start: sp.start === "1", option, update: sp.update === "1" }));
}
