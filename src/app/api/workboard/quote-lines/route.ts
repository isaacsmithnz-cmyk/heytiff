import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { addLine, changeLine, copyOption, namesBySignIn, readChanges, readEngine, readLines, removeLine, setEngine, undoChange } from "@/lib/quotes/lines-server";
import { addKit } from "@/lib/quotes/kits-server";
import { packMakers } from "@/lib/quotes/lookups-server";
import { linesFit } from "@/lib/quotes/fit-server";
import { normaliseKitFacts } from "@/lib/quotes/kits";
import { approveProposal, markAccepted, markVariation, nameOption, readByHand, saveProposal, setLoading, setSupplier, startVariation, startVersion } from "@/lib/quotes/lines-job-server";
import { readVersions } from "@/lib/quotes/quote-versions-server";
import { stageNamed, variationMaterials } from "@/lib/quotes/lines-job";
import { approvalStands } from "@/lib/quotes/lines-proposal";
import { orgTemplates } from "@/lib/templates/query";
import { readSuppliers } from "@/lib/quotes/price-book-server";
import { addEvents, readSession } from "@/lib/quotes/session/store-server";
import { putAcceptedOnJob, putVariationOnJob } from "@/lib/quotes/accepted-materials-server";
import { addTasksToJob, makeTasksFromQuote } from "@/lib/workboard/visit-tasks-server";
import { variationTasks } from "@/lib/workboard/task-plan";
import { readQuoteSettings } from "@/lib/quotes/settings-query";
import { readOrgDay } from "@/lib/quotes/org-day-server";
import { taskCheck } from "@/lib/quotes/task-hours";
import { changesWithoutMoney, lineWithoutMoney, patchWithoutMoney } from "@/lib/quotes/money-hidden";

/* A quote's kept lines (the engine rebuild, slices 2.1–2.3): read them with
   their history and who made each change, and change them one at a time.
   Running the board and money access, as the quote's price: every line
   carries a cost. A ROUTE, so an edit never queues behind the card's server
   actions; each change names the version it was read at (lines-server.ts). */

/* WHO QUOTES (Isaac, 2026-10-12: "the quoting section should still be
   accessible. For techs who are quoting a job, but… the money visibility
   can be hidden… anyone with money access can review the quote and check
   the pricing"): anyone on the Workboard builds a quote and talks it
   through with Tiff; its money goes only to `financials`, taken out here
   (money-hidden.ts), and pricing it, approving it and what follows are
   theirs. Marking it accepted is the board's managers'. */
type Gate = { ok: true; orgId: string; userId: string; money: boolean; manage: boolean } | { ok: false; res: Response };

async function gate(): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard"))) {
    return { ok: false, res: Response.json({ ok: false, reason: "A quote needs access to Jobs." }, { status: 403 }) };
  }
  const [money, manage] = await Promise.all([can("financials"), can("workboard_manage")]);
  return { ok: true, orgId, userId, money, manage };
}

/* what only someone who sees money may do to a quote, and what only a manager */
const MONEY_OPS = new Set(["supplier", "proposal", "approve", "loading", "version", "variation", "variation-approve", "variation-accept"]);
const MANAGE_OPS = new Set(["accept"]);

/** The suppliers a job can buy from: the business's own, with items. */
async function bookSuppliers(orgId: string) {
  return (await readSuppliers(orgId).catch(() => [])).filter((s) => (s.itemCount ?? 0) > 0 || (s.invoiceItems ?? 0) > 0).map((s) => ({ key: s.key, name: s.name }));
}

async function view(orgId: string, jobUuid: string, userId: string, money = true) {
  const [engine, lines, changes, byHand, settings, day, suppliers, templates, versions, packs] = await Promise.all([
    readEngine(orgId, jobUuid),
    readLines(orgId, jobUuid),
    readChanges(orgId, jobUuid, 50),
    readByHand(orgId, jobUuid),
    readQuoteSettings(orgId),
    readOrgDay(orgId),
    bookSuppliers(orgId),
    orgTemplates(orgId).catch(() => null),
    readVersions(orgId, jobUuid).catch(() => []),
    packMakers(),
  ]);
  /* the business's own task hours, beside each option's (slice 8.1) */
  const options = Math.max(0, ...lines.map((l) => l.optionIndex + 1));
  const tasks = Array.from({ length: options }, (_, i) => taskCheck(lines.filter((l) => l.optionIndex === i), settings.taskHours, day.hours?.hours ?? null));
  const [names, fits] = await Promise.all([
    namesBySignIn(orgId, [...changes.map((c) => c.madeBy), ...lines.map((l) => l.updatedBy), userId, ...(byHand.proposal?.approvedBy ? [byHand.proposal.approvedBy] : [])]),
    linesFit(lines, orgId).catch(() => []),
  ]);
  return {
    ok: true as const,
    /* whether this person sees its money: without it, every price is out */
    money,
    engine,
    lines: money ? lines : lines.map(lineWithoutMoney),
    changes: money ? changes : changesWithoutMoney(changes),
    names,
    me: userId,
    fits,
    accepted: byHand.accepted,
    optionNames: byHand.names,
    loading: byHand.loading,
    supplier: byHand.supplier,
    researched: byHand.researched,
    variations: byHand.variations,
    /* sent to ServiceM8 as a quote (7.3) */
    sent: byHand.sent ?? null,
    /* the quote as it stood at each approval before this one, newest first */
    versions: money ? versions : [],
    suppliers: money ? suppliers : [],
    /* the makers a kit's unit can be read off: every installed pack */
    packs,
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
  return Response.json(await view(g.orgId, target.parentRemoteId, g.userId, g.money));
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
  const op = typeof body.op === "string" ? body.op : "";
  if (MONEY_OPS.has(op) && !g.money) return Response.json({ ok: false, reason: "Pricing and approving a quote need money access." }, { status: 403 });
  if (MANAGE_OPS.has(op) && !g.manage) return Response.json({ ok: false, reason: "Marking a quote accepted needs Make and change jobs." }, { status: 403 });
  /* a change without money access: its work, never its price */
  if (!g.money && (op === "add" || op === "change")) {
    if (op === "add") body.line = patchWithoutMoney(body.line);
    else body.patch = patchWithoutMoney(body.patch);
  }
  if (!g.money && op === "undo") {
    const c = (await readChanges(g.orgId, jobUuid, 200)).find((x) => x.id === body.change);
    const priced = (f: Record<string, unknown> | null) => !!f && ("costCents" in f || "sellCents" in f);
    if (!c || priced(c.before as Record<string, unknown> | null) || priced(c.after as Record<string, unknown> | null))
      return Response.json({ ok: false, reason: "Undoing a price needs money access." }, { status: 403 });
  }
  /* what marking an option accepted did to the job's own materials list */
  let onJob: { added: number; removed: number } | null = null;
  /* a variation just started: the option to open */
  let opened: number | null = null;
  /* the quote's history, in Tiff's thread where there is one (slice 6.2) */
  const mark = async (text: string) => {
    const session = await readSession(g.orgId, jobUuid).catch(() => null);
    if (session) await addEvents(g.orgId, session.id, null, [{ kind: "milestone", author: g.userId, body: { text } }]);
  };
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
    /* A VARIATION (Isaac, 2026-10-10): started on an accepted quote, then
       approved, then accepted by the client, its new work onto the job */
    case "variation": {
      const what = typeof body.what === "string" ? body.what : "";
      const started = await startVariation(g.orgId, jobUuid, what, g.userId);
      result = started;
      if (started.ok) {
        opened = started.option;
        await mark(`Variation ${started.n} started${what.trim() ? `: ${what.trim().slice(0, 200)}` : ""}`);
      }
      break;
    }
    /* VERSION 2 (quote-versions.ts): an approved quote, not yet accepted,
       kept as it stood; the approval comes off */
    case "version": {
      const what = typeof body.what === "string" ? body.what : "";
      const kept = await startVersion(g.orgId, jobUuid, what, g.userId);
      result = kept;
      if (kept.ok) await mark(`Version ${kept.n + 1} started${what.trim() ? `: ${what.trim().slice(0, 200)}` : ""}`);
      break;
    }
    case "variation-approve":
    case "variation-accept": {
      const option = opt(body.option);
      const was = (await readByHand(g.orgId, jobUuid)).variations.find((v) => v.option === option);
      if (!was) {
        result = { ok: false, reason: "That option isn't a variation." };
        break;
      }
      const key = body.op === "variation-approve" ? "approvedAt" : "acceptedAt";
      const marked = await markVariation(g.orgId, jobUuid, option, key, g.userId);
      result = marked;
      if (!marked.ok) break;
      const now = marked.byHand.variations.find((v) => v.option === option)!;
      await mark(`Variation ${now.n} ${now[key] ? (key === "approvedAt" ? "approved" : "accepted") : key === "approvedAt" ? "no longer approved" : "no longer accepted"}`);
      /* accepted: its new work onto the job, on no visit, for the days,
         and its new parts onto the job's materials list */
      if (key === "acceptedAt" && now.acceptedAt) {
        const all = await readLines(g.orgId, jobUuid);
        const base = all.filter((l) => l.optionIndex === now.of);
        const varied = all.filter((l) => l.optionIndex === option);
        await addTasksToJob(g.orgId, g.userId, jobUuid, variationTasks(base, varied, stageNamed)).catch(() => null);
        const put = await putVariationOnJob(g.orgId, g.userId, jobUuid, variationMaterials(base, varied, now.n)).catch(() => null);
        onJob = put?.ok ? { added: put.added, removed: 0 } : null;
      }
      break;
    }
    case "undo":
      result = await undoChange(g.orgId, jobUuid, typeof body.change === "number" ? body.change : -1, g.userId);
      break;
    default:
      return Response.json({ ok: false, reason: "Not something a quote's lines can do." }, { status: 400 });
  }
  const now = await view(g.orgId, jobUuid, g.userId, g.money);
  return Response.json(result.ok ? { ...now, onJob, opened } : { ...now, ok: false, reason: result.reason, stale: result.stale ?? false }, { status: 200 });
}
