import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { draftBoxOf, draftRefOf, type DraftBox } from "@/lib/drafts/drafts";
import { readDraft, saveDraft } from "@/lib/drafts/drafts-server";

/* A reply box's unsent words, for the person who typed them (drafts.ts):
   GET reads the draft, PUT keeps it (empty words remove it). The quote's box
   asks what its conversation asks, the Workboard, and names the job the way
   the quote's routes do, so the draft and the send agree on which quote. */

type Gate = { ok: true; orgId: string; userSub: string; box: DraftBox; ref: string } | { ok: false; res: Response };

async function gate(boxIn: unknown, refIn: unknown): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userSub = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userSub) return { ok: false, res: Response.json({ ok: false, reason: "Sign in again to keep what you typed." }, { status: 401 }) };
  const box = draftBoxOf(boxIn);
  const ref = draftRefOf(refIn);
  if (!box || !ref) return { ok: false, res: Response.json({ ok: false, reason: "No box named." }, { status: 400 }) };
  if (box === "quote") {
    if (!(await can("workboard"))) return { ok: false, res: Response.json({ ok: false, reason: "A quote needs access to Jobs." }, { status: 403 }) };
    return { ok: true, orgId, userSub, box, ref: (await resolveJobCard(orgId, ref)).parentRemoteId };
  }
  return { ok: false, res: Response.json({ ok: false, reason: "No box named." }, { status: 400 }) };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const g = await gate(url.searchParams.get("box"), url.searchParams.get("ref"));
  if (!g.ok) return g.res;
  return Response.json({ ok: true, text: await readDraft(g) });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const g = await gate(body?.box, body?.ref);
  if (!g.ok) return g.res;
  const saved = await saveDraft(g, body?.text);
  return Response.json(saved ? { ok: true } : { ok: false, reason: "That didn't keep. It's still in the box." }, { status: saved ? 200 : 500 });
}
