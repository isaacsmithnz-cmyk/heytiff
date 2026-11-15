import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readSiteNotesFor, siteNoteCountFor } from "@/lib/sites/site-notes-server";
import { getSm8Timezone } from "@/lib/workboard/query";

/* A JOB'S SITE NOTES, READ (build 9; components/jobs/site-notes.tsx): the
   site's notes and the other jobs there, or with `count=1` only how many
   notes there are, for the mark on the facts card's button. For whoever is
   on the board (`workboard`), as the server actions that write them are.

   A ROUTE, as job-tracker and quote-price are: the job page's server
   actions run one at a time, and on the walk of 15 November 2026 the
   pop-up's first open sat on "Reading the site's notes" for about ten
   seconds behind them (3416). The writes stay server actions. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !session?.user?.sub || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "Site notes need access to Jobs." }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const job = (params.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  if (params.get("count") === "1") return Response.json({ ok: true, count: await siteNoteCountFor(orgId, job) });
  const read = await readSiteNotesFor({ orgId, jobUuid: job, tz: await getSm8Timezone(orgId) });
  if (!read) return Response.json({ ok: false, reason: "That job isn't here." }, { status: 404 });
  return Response.json({ ok: true, read });
}
