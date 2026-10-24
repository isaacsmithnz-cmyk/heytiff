import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { readLines } from "@/lib/quotes/lines-server";
import { readByHand } from "@/lib/quotes/lines-job-server";
import { approvalStands } from "@/lib/quotes/lines-proposal";
import { readVersions } from "@/lib/quotes/quote-versions-server";
import { hasTalked, readOpenQuestions, readSession } from "@/lib/quotes/session/store-server";
import { readStoredProposal } from "@/lib/quotes/old-draft-server";
import { readLanding } from "@/lib/quotes/quote-landing-server";
import { toConfirmOf, type QuoteFacts } from "@/lib/quotes/quote-card";

/* WHERE A JOB'S QUOTE STANDS, for the job card (quote-card.ts): counts and
   days, never a price, so it goes to anyone on the Workboard (Isaac,
   2026-10-12: "the quoting section should still be accessible. For techs
   who are quoting a job"). Read only.

   `landing=1` is the Quote tab's landing (quote-landing.ts): its name, who
   is on it and when, its versions and variations, and what each comes to,
   that last only for a reader with money access (`financials`, as the
   quote's own lines are), never only hidden on the page. */

export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) return Response.json({ ok: false, reason: "A quote needs access to Jobs." }, { status: 403 });
  const url = new URL(req.url);
  const job = (url.searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const jobUuid = (await resolveJobCard(orgId, job)).parentRemoteId;
  const [lines, byHand, versions, talk, drafted] = await Promise.all([
    readLines(orgId, jobUuid),
    readByHand(orgId, jobUuid),
    readVersions(orgId, jobUuid).catch(() => []),
    readSession(orgId, jobUuid).catch(() => null),
    readStoredProposal(orgId, jobUuid).catch(() => null),
  ]);
  const [asked, talked] = talk ? await Promise.all([readOpenQuestions(orgId, talk.id).then((q) => q.length).catch(() => 0), hasTalked(orgId, talk.id).catch(() => false)]) : [0, false];
  const changedAt = lines.reduce<string | null>((at, l) => (!at || l.updatedAt > at ? l.updatedAt : at), null);
  const facts: QuoteFacts = {
    lines: lines.length,
    options: Math.max(0, ...lines.map((l) => l.optionIndex + 1)),
    toConfirm: toConfirmOf(lines, asked),
    changedAt,
    talked,
    drafted: drafted != null,
    approved: byHand.proposal ? approvalStands(byHand.proposal, lines.map((l) => l.updatedAt)) : false,
    version: (versions[0]?.n ?? 0) + 1,
    sent: byHand.sent ? { at: byHand.sent.at, trial: byHand.sent.trial } : null,
    accepted: byHand.accepted,
  };
  if (url.searchParams.get("landing") !== "1") return Response.json({ ok: true, facts });
  const money = await can("financials");
  const landing = await readLanding(orgId, jobUuid, { byHand, versions, lines, session: talk, money });
  return Response.json({ ok: true, facts, landing });
}
