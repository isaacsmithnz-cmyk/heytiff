import { createHash } from "node:crypto";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { THREADS_PER_CALL, threadIdOf, threadOf, type TiffThread } from "@/lib/tiff/threads";
import { readThreads, writeThreads, type ThreadOwner } from "@/lib/tiff/threads-server";

/* A person's conversations with Tiff (lib/tiff/threads.ts): GET reads them,
   POST keeps some and removes others. Gated as asking Tiff is, by `tiff`.

   Until docs/migrations/tiff_threads.sql is applied (NOT YET), GET answers
   503, "not kept", and the page keeps its threads in the browser. A POST
   then fails the same way and the browser's copy stands.

   `who` names the person to the browser without handing it their sign-in:
   it is how a shared browser tells one person's threads from another's. */

type Gate = { ok: true; owner: ThreadOwner; who: string } | { ok: false; res: Response };

async function gate(): Promise<Gate> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userSub = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userSub) return { ok: false, res: Response.json({ ok: false, reason: "Sign in again to keep your conversations." }, { status: 401 }) };
  if (!(await can("tiff"))) return { ok: false, res: Response.json({ ok: false, reason: "Asking Tiff isn't switched on for you." }, { status: 403 }) };
  const who = createHash("sha256").update(`${orgId}:${userSub}`).digest("hex").slice(0, 16);
  return { ok: true, owner: { orgId, userSub }, who };
}

const NOT_KEPT = { ok: false, reason: "Conversations are kept on this device for now." };

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.res;
  const read = await readThreads(g.owner);
  if (!read.kept) return Response.json(NOT_KEPT, { status: 503 });
  return Response.json({ ok: true, who: g.who, threads: read.threads });
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as { upsert?: unknown; remove?: unknown } | null;
  const upsertIn = Array.isArray(body?.upsert) ? body.upsert : [];
  const removeIn = Array.isArray(body?.remove) ? body.remove : [];
  if (upsertIn.length > THREADS_PER_CALL || removeIn.length > THREADS_PER_CALL) {
    return Response.json({ ok: false, reason: `Send at most ${THREADS_PER_CALL} at a time.` }, { status: 413 });
  }
  const upsert: TiffThread[] = [];
  for (const raw of upsertIn) {
    const t = threadOf(raw);
    if (!t) return Response.json({ ok: false, reason: "That isn't a conversation." }, { status: 400 });
    upsert.push(t);
  }
  const remove: string[] = [];
  for (const raw of removeIn) {
    const id = threadIdOf(raw);
    if (!id) return Response.json({ ok: false, reason: "That isn't a conversation." }, { status: 400 });
    remove.push(id);
  }
  if (upsert.length === 0 && remove.length === 0) return Response.json({ ok: true });
  const saved = await writeThreads(g.owner, upsert, remove);
  return saved ? Response.json({ ok: true }) : Response.json(NOT_KEPT, { status: 503 });
}
