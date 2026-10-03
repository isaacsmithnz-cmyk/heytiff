import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { normaliseDraft } from "@/lib/quotes/proposal";
import { orgTemplates } from "@/lib/templates/query";
import {
  CHANGED_MEANWHILE,
  SAVE_FAILED,
  readStoredProposal,
  storeProposal,
  writeProposal,
  type ProposalRequest,
} from "@/lib/quotes/proposal-writer";

/* The job card's Quote tab: read the draft, write or change it with Tiff,
   and save a person's own edits and checklist answers.

   A ROUTE, NOT SERVER ACTIONS, for two reasons. A Claude call is seconds and
   `maxDuration` is a route-segment option. And the job card fires its own
   server actions as it opens (the record, the media cache rounds), which
   the client runs one at a time: a read queued behind them sat on "Reading
   the proposal" for ten to fifteen seconds on job 3343. Route requests run
   alongside them.

   RUNNING THE BOARD, NOT READING IT. Drafting a quote is office work and
   spends API credit on every press, so every method asks for
   workboard_manage, the grant that books jobs. */

/* Room for the model to think and write a long draft, and for the backup
   model to take over inside the same call. */
export const maxDuration = 300;

/** Long enough for a site visit said out loud; short enough that a paste of
    a whole email thread is cut rather than paid for. */
const MAX_WORDS_CHARS = 6000;

async function gate(): Promise<{ orgId: string; userId: string } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard_manage"))) {
    return Response.json({ ok: false, reason: "Drafting quotes needs Workboard manage access." }, { status: 403 });
  }
  return { orgId, userId };
}

const jobOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const job = jobOf(new URL(req.url).searchParams.get("job"));
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(who.orgId, job);
  const [proposal, t] = await Promise.all([readStoredProposal(who.orgId, target.parentRemoteId), orgTemplates(who.orgId)]);
  return Response.json({ ok: true, proposal, templates: { notes: t.quoteNotes, terms: t.paymentTerms } });
}

export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline: no API key is configured." });
  }

  let body: { job?: unknown; brief?: unknown; change?: unknown; apply?: unknown; replace?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const job = jobOf(body.job);
  const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_WORDS_CHARS) : "");
  const brief = text(body.brief);
  const change = text(body.change);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });

  let request: ProposalRequest;
  if (change || body.apply === true) request = { kind: "change", change };
  else if (brief) request = { kind: "draft", brief, replace: body.replace === true };
  else return Response.json({ ok: false, reason: "Say what the job is first." }, { status: 400 });

  return Response.json(await writeProposal(who.orgId, who.userId, job, request));
}

/** A person's own edit, or an answer on the checklist: the whole draft back,
    through the same gate a model's answer goes through, with the updatedAt
    it was made on (`base`) so a save made on an old copy can't undo a newer
    one. */
export async function PUT(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  let body: { job?: unknown; draft?: unknown; base?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const job = jobOf(body.job);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const draft = normaliseDraft(body.draft);
  if (!draft) return Response.json({ ok: false, reason: "A proposal needs at least one option with some scope." });
  const target = await resolveJobCard(who.orgId, job);
  const current = await readStoredProposal(who.orgId, target.parentRemoteId);
  if (!current) return Response.json({ ok: false, reason: "There's no proposal on this job to edit." });
  const base = typeof body.base === "string" ? body.base : current.updatedAt;
  if (base !== current.updatedAt) return Response.json({ ok: false, reason: CHANGED_MEANWHILE, proposal: current });
  const stored = await storeProposal(who.orgId, who.userId, current.cardId, draft, current.brief, current.changes, base);
  if (stored.ok) return Response.json(stored);
  if (!stored.conflict) return Response.json({ ok: false, reason: SAVE_FAILED });
  return Response.json({
    ok: false,
    reason: CHANGED_MEANWHILE,
    proposal: await readStoredProposal(who.orgId, current.cardId),
  });
}
