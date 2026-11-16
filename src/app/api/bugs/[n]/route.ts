import { dropBug, noteBug } from "@/lib/mobile/bugs";
import { bugReply, webBugCtx } from "@/lib/mobile/bugs-web";

/* One of the website's bugs: PUT keeps what's wrong with it, DELETE is
   Cancel and the toast's Undo (lib/mobile/bugs). */
export async function PUT(request: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await webBugCtx();
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await noteBug(ctx, (await params).n, body);
  return r.ok ? bugReply(r.value) : bugReply({ error: r.error }, r.status);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await webBugCtx();
  if (ctx instanceof Response) return ctx;
  const r = await dropBug(ctx, (await params).n);
  return r.ok ? bugReply(r.value) : bugReply({ error: r.error }, r.status);
}
