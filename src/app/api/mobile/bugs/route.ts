import { ok, requireMobile } from "@/lib/mobile/auth";
import { openBug } from "@/lib/mobile/bugs";

/* The phone's bug: the next number, and a slot for the screen's picture (lib/mobile/bugs). */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await openBug(ctx, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
