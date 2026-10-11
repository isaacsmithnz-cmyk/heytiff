import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { addLine, changeLine, copyOption, namesBySignIn, readChanges, readEngine, readLines, removeLine, setEngine, undoChange } from "@/lib/quotes/lines-server";
import { addKit } from "@/lib/quotes/kits-server";
import { adoptQuote } from "@/lib/quotes/lines-adopt-server";
import { linesFit } from "@/lib/quotes/fit-server";
import { normaliseKitFacts } from "@/lib/quotes/kits";
import { approveProposal, markAccepted, nameOption, readByHand, saveProposal, setLoading, setSupplier } from "@/lib/quotes/lines-job-server";
import { approvalStands } from "@/lib/quotes/lines-proposal";
import { orgTemplates } from "@/lib/templates/query";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { sessionModelFor } from "@/lib/quotes/session/model-server";
import { readStoredProposal } from "@/lib/quotes/proposal-writer";
import { addEvents, readSession } from "@/lib/quotes/session/store-server";
import { putAcceptedOnJob } from "@/lib/quotes/accepted-materials-server";
import { makeTasksFromQuote } from "@/lib/workboard/visit-tasks-server";
import { readQuoteSettings } from "@/lib/quotes/settings-query";
import { readOrgDay } from "@/lib/quotes/org-day-server";
import { taskCheck } from "@/lib/quotes/task-hours";

/* A quote's kept lines (the engine rebuild, slices 2.1–2.3): read them with
   their history and who made each change, and change them one at a time.
   Running the board and money access, as the quote's price: every line
   carries a cost. A ROUTE, so an edit never queues behind the card's server
   actions; each change names the version it was read at (lines-server.ts). */

type Gate = { ok: true; orgId: string; userId: string } | { ok: false; res: Response };

async function gate(): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard_manage")) || !(await can("financials"))) {
    return { ok: false, res: Response.json({ ok: false, reason: "A quote's lines need Workboard manage and money access." }, { status: 403 }) };
  }
  return { ok: true, orgId, userId };
}

/** The suppliers a job can buy from: the business's own, with items. */
async function bookSuppliers(orgId: string) {
  return (await readSuppliers(orgId).catch(() => [])).filter((s) => (s.itemCount ?? 0) > 0 || (s.invoiceItems ?? 0) > 0).map((s) => ({ key: s.key, name: s.name }));
}

async function view(orgId: string, jobUuid: string, userId: string) {
  const [engine, lines, changes, byHand, settings, day, suppliers, templates] = await Promise.all([
    readEngine(orgId, jobUuid),
    readLines(orgId, jobUuid),
    readChanges(orgId, jobUuid, 50),
    readByHand(orgId, jobUuid),
    readQuoteSettings(orgId),
    readOrgDay(orgId),
    bookSuppliers(orgId),
    orgTemplates(orgId).catch(() => null),
  ]);
  /* the business's own task hours, beside each option's (slice 8.1) */
  const options = Math.max(0, ...lines.map((l) => l.optionIndex + 1));
  const tasks = Array.from({ length: options }, (_, i) => taskCheck(lines.filter((l) => l.optionIndex === i), settings.taskHours, day.hours?.hours ?? null));
  const [names, fits] = await Promise.all([
    namesBySignIn(orgId, [...changes.map((c) => c.madeBy), ...lines.map((l) => l.updatedBy), userId, ...(byHand.proposal?.approvedBy ? [byHand.proposal.approvedBy] : [])]),
    linesFit(lines).catch(() => []),
  ]);
  return {
    ok: true as const,
    engine,
    lines,
    changes,
    names,
    me: userId,
    fits,
    accepted: byHand.accepted,
    optionNames: byHand.names,
    loading: byHand.loading,
    supplier: byHand.supplier,
    researched: byHand.researched,
    suppliers,
    tasks,
    /* the proposal's words, whether an approval of them still stands, and
       the business's notes and payment terms it's set from (7.1) */
    proposal: byHand.proposal,
    approved: byHand.proposal ? approvalStands(byHand.proposal, lines.map((l) => l.updatedAt)) : false,
    noteLibrary: templates?.quoteNotes ?? [],
    paymentTerms: templates?.paymentTerms ?? null,
  };
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  /* whether Create a quote starts Tiff here (slice 4.4): she's on for the
     business, and nothing is drafted the old way */
  const [now, drafted] = await Promise.all([view(g.orgId, target.parentRemoteId, g.userId), readStoredProposal(g.orgId, target.parentRemoteId).catch(() => null)]);
  return Response.json({ ...now, tiff: sessionModelFor(g.orgId) != null, drafted: drafted != null });
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const job = typeof body?.job === "string" ? body.job.trim().slice(0, 80) : "";
  if (!body || !job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  const jobUuid = target.parentRemoteId;
  const id = typeof body.id === "string" ? body.id : "";
  const version = typeof body.version === "number" ? body.version : -1;
  const why = typeof body.why === "string" ? body.why : "";
  let result: { ok: boolean; reason?: string; stale?: true } = { ok: true };
  const opt = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(19, Math.round(v))) : 0);
  /* what marking an option accepted did to the job's own materials list */
  let onJob: { added: number; removed: number } | null = null;
  switch (body.op) {
    case "switch":
      result = (await setEngine(g.orgId, jobUuid, body.engine === "lines" ? "lines" : "old", g.userId))
        ? { ok: true }
        : { ok: false, reason: "The quote couldn't be switched. Try again." };
      break;
    case "add":
      result = await addLine(g.orgId, jobUuid, body.line, g.userId, why);
      break;
    case "change":
      result = await changeLine(g.orgId, jobUuid, id, version, body.patch, g.userId, why);
      break;
    case "remove":
      result = await removeLine(g.orgId, jobUuid, id, version, g.userId, why);
      break;
    case "kit": {
      const kit = body.kit === "ducted" ? "ducted" : "split";
      const at = { optionIndex: typeof body.optionIndex === "number" ? Math.max(0, Math.min(19, Math.round(body.optionIndex))) : 0, system: typeof body.system === "string" ? body.system.slice(0, 60) : "" };
      const model = typeof body.model === "string" ? body.model.trim().slice(0, 60) : "";
      const brand = typeof body.brand === "string" ? body.brand.trim().slice(0, 60) : "";
      result = await addKit(g.orgId, jobUuid, kit, normaliseKitFacts(body.facts), at, model && brand ? { brand, model } : null, g.userId);
      break;
    }
    case "adopt":
      result = await adoptQuote(g.orgId, jobUuid, g.userId);
      break;
    case "copy": {
      const n = (v: unknown) => (typeof v === "number" ? Math.max(0, Math.min(19, Math.round(v))) : -1);
      result = await copyOption(g.orgId, jobUuid, n(body.from), n(body.to), g.userId);
      break;
    }
    case "accept": {
      /* the client's choice: its parts go on the job's own materials list,
         as an option accepted on Tiff's proposal does */
      const i = typeof body.option === "number" ? Math.max(0, Math.min(19, Math.round(body.option))) : 0;
      const marked = await markAccepted(g.orgId, jobUuid, i, g.userId);
      result = marked;
      /* the quote's history, in Tiff's thread where there is one (slice 6.2) */
      if (marked.ok) {
        const session = await readSession(g.orgId, jobUuid).catch(() => null);
        if (session)
          await addEvents(g.orgId, session.id, null, [
            { kind: "milestone", author: g.userId, body: { text: marked.byHand.accepted.length ? `Option ${i + 1} accepted` : `Option ${i + 1} no longer accepted` } },
          ]);
      }
      if (marked.ok && marked.byHand.accepted.length > 0) {
        const put = await putAcceptedOnJob(g.orgId, g.userId, jobUuid);
        onJob = put.ok ? { added: put.added, removed: put.removed } : null;
        /* the tasks its labour was worked out from go straight onto the job
           (8.2), when it has none yet; never a call to Tiff */
        await makeTasksFromQuote(g.orgId, g.userId, jobUuid, { quoteOnly: true }).catch(() => null);
      }
      break;
    }
    case "name":
      result = await nameOption(g.orgId, jobUuid, opt(body.option), body.name, g.userId);
      break;
    case "supplier": {
      const key = typeof body.key === "string" && body.key ? body.key.slice(0, 40) : null;
      const known = key ? (await bookSuppliers(g.orgId)).find((s) => s.key === key) : null;
      if (key && !known) {
        result = { ok: false, reason: "That supplier isn't in your book." };
        break;
      }
      result = await setSupplier(g.orgId, jobUuid, key, g.userId, known?.name ?? "");
      break;
    }
    case "proposal":
      result = await saveProposal(g.orgId, jobUuid, body.patch, g.userId);
      break;
    case "approve": {
      const approved = await approveProposal(g.orgId, jobUuid, g.userId);
      result = approved;
      /* marked in Tiff's thread, where there is one (slice 6.2) */
      if (approved.ok) {
        const session = await readSession(g.orgId, jobUuid).catch(() => null);
        if (session) await addEvents(g.orgId, session.id, null, [{ kind: "milestone", author: g.userId, body: { text: "Proposal approved" } }]);
      }
      break;
    }
    case "loading":
      result = await setLoading(g.orgId, jobUuid, opt(body.option), { pct: body.pct, reason: body.reason }, g.userId);
      break;
    case "undo":
      result = await undoChange(g.orgId, jobUuid, typeof body.change === "number" ? body.change : -1, g.userId);
      break;
    default:
      return Response.json({ ok: false, reason: "Not something a quote's lines can do." }, { status: 400 });
  }
  const now = await view(g.orgId, jobUuid, g.userId);
  return Response.json(result.ok ? { ...now, onJob } : { ...now, ok: false, reason: result.reason, stale: result.stale ?? false }, { status: 200 });
}
