import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { writeProposal, type ProposalRequest } from "@/lib/quotes/proposal-writer";

/* The job card's Quote tab: write a proposal draft, or change one.

   A ROUTE HANDLER, as the job summary's is: a Claude call is seconds and
   `maxDuration` is a route-segment option — as a server action it would
   inherit the page's ceiling.

   RUNNING THE BOARD, NOT READING IT. Drafting a quote is office work and
   spends API credit on every press, so it asks for workboard_manage, the
   grant that books jobs, rather than the plain workboard every tech has. */

export const maxDuration = 120;

/** Long enough for a site visit said out loud; short enough that a paste of
    a whole email thread is cut rather than paid for. */
const MAX_WORDS_CHARS = 6000;

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard_manage"))) {
    return Response.json({ ok: false, reason: "Drafting quotes needs Workboard manage access." }, { status: 403 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline: no API key is configured." });
  }

  let body: { job?: unknown; brief?: unknown; change?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const job = typeof body.job === "string" ? body.job.trim().slice(0, 80) : "";
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_WORDS_CHARS) : "");
  const brief = text(body.brief);
  const change = text(body.change);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });

  let request: ProposalRequest;
  if (change) request = { kind: "change", change };
  else if (brief) request = { kind: "draft", brief };
  else return Response.json({ ok: false, reason: "Say what the job is first." }, { status: 400 });

  const res = await writeProposal(orgId, userId, job, request);
  return Response.json(res);
}
