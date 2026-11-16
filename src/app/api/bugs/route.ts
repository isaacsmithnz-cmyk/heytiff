import { openBug } from "@/lib/mobile/bugs";
import { bugReply, webBugCtx } from "@/lib/mobile/bugs-web";

/* The website's bug (Your name, Report bug): the next number, held, and a
   slot for the picture, in the phone's folder (lib/mobile/bugs). */
export async function POST(request: Request) {
  const ctx = await webBugCtx();
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await openBug(ctx, { page: body.page, app: "Web" });
  return r.ok ? bugReply(r.value) : bugReply({ error: r.error }, r.status);
}
