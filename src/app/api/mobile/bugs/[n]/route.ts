import { ok, requireMobile } from "@/lib/mobile/auth";
import { dropBug, noteBug } from "@/lib/mobile/bugs";

/* One bug: PUT keeps your note with it, DELETE is the toast's Undo (lib/mobile/bugs). */
const fail = (r: { error: string; status: number }) => Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });

export async function PUT(request: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await noteBug(ctx, (await params).n, body);
  return r.ok ? ok(r.value) : fail(r);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ n: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const r = await dropBug(ctx, (await params).n);
  return r.ok ? ok(r.value) : fail(r);
}
