import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { addLine, changeLine, copyOption, namesBySignIn, readChanges, readEngine, readLines, removeLine, setEngine, undoChange } from "@/lib/quotes/lines-server";
import { addKit } from "@/lib/quotes/kits-server";
import { adoptQuote } from "@/lib/quotes/lines-adopt-server";
import { normaliseKitFacts } from "@/lib/quotes/kits";

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

async function view(orgId: string, jobUuid: string, userId: string) {
  const [engine, lines, changes] = await Promise.all([readEngine(orgId, jobUuid), readLines(orgId, jobUuid), readChanges(orgId, jobUuid, 50)]);
  const names = await namesBySignIn(orgId, [...changes.map((c) => c.madeBy), ...lines.map((l) => l.updatedBy)]);
  return { ok: true as const, engine, lines, changes, names, me: userId };
}

export async function GET(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(g.orgId, job);
  return Response.json(await view(g.orgId, target.parentRemoteId, g.userId));
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
    case "undo":
      result = await undoChange(g.orgId, jobUuid, typeof body.change === "number" ? body.change : -1, g.userId);
      break;
    default:
      return Response.json({ ok: false, reason: "Not something a quote's lines can do." }, { status: 400 });
  }
  const now = await view(g.orgId, jobUuid, g.userId);
  return Response.json(result.ok ? now : { ...now, ok: false, reason: result.reason, stale: result.stale ?? false }, { status: 200 });
}
