import { THREADS_PER_CALL, threadIdOf, threadOf, type TiffThread } from "@/lib/tiff/threads";
import { readThreads, writeThreads } from "@/lib/tiff/threads-server";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* YOUR CONVERSATIONS WITH TIFF, from the phone: the same threads as the
   web's Conversations (tiff_threads, lib/tiff/threads), read and kept for
   the person the phone's token check verified, so a conversation started
   on the phone is there on the laptop. Gated as asking Tiff is, by `tiff`. */

const NOT_KEPT = "Conversations couldn't be kept just now.";
const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const read = await readThreads({ orgId: ctx.orgId, userSub: ctx.userId });
  if (!read.kept) return no(503, NOT_KEPT);
  return ok({ threads: read.threads });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { upsert?: unknown; remove?: unknown } | null;
  const upsertIn = Array.isArray(body?.upsert) ? body.upsert : [];
  const removeIn = Array.isArray(body?.remove) ? body.remove : [];
  if (upsertIn.length > THREADS_PER_CALL || removeIn.length > THREADS_PER_CALL) return no(413, `Send at most ${THREADS_PER_CALL} at a time.`);
  const upsert: TiffThread[] = [];
  for (const raw of upsertIn) {
    const t = threadOf(raw);
    if (!t) return no(400, "That isn't a conversation.");
    upsert.push(t);
  }
  const remove: string[] = [];
  for (const raw of removeIn) {
    const id = threadIdOf(raw);
    if (!id) return no(400, "That isn't a conversation.");
    remove.push(id);
  }
  if (upsert.length === 0 && remove.length === 0) return ok({ kept: true });
  const saved = await writeThreads({ orgId: ctx.orgId, userSub: ctx.userId }, upsert, remove);
  return saved ? ok({ kept: true }) : no(503, NOT_KEPT);
}
