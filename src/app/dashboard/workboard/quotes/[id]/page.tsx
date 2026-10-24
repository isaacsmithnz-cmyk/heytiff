import { redirect } from "next/navigation";
import { quoteHref } from "@/lib/shell/links";

/* A job's quote is under its job (24 October 2026): an old link lands
   there, keeping what it asked for (`?start=1`, `?option=N`). */
export default async function OldQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<never> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const option = typeof sp.option === "string" && /^\d+$/.test(sp.option) ? Number(sp.option) : null;
  redirect(quoteHref(id, { start: sp.start === "1", option }));
}
