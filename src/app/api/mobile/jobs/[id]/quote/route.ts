import { ok, requireMobile } from "@/lib/mobile/auth";
import { changePhoneLines, phoneLineOpOf, pressQuote, readPhoneQuote, sendPhoneQuote } from "@/lib/mobile/phone-quote-server";

/* A JOB'S QUOTE ON THE PHONE (lib/mobile/phone-quote): GET is everything its
   screens show. POST is Mark ready to send and its Undo, Customer accepted or
   Send to ServiceM8, each the web's own press as the token's person, which
   names its own gate; or a line removed, priced or swapped, or its Undo
   (6 November 2026). */

export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const quote = await readPhoneQuote(ctx, (await params).id.trim().slice(0, 80));
  return quote ? ok(quote) : Response.json({ error: "A quote needs access to Jobs." }, { status: 403, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  const body = (await request.json().catch(() => null)) as ({ op?: unknown; option?: unknown } & Record<string, unknown>) | null;
  if (typeof body?.op === "string" && body.op.startsWith("line-")) {
    const op = phoneLineOpOf(body);
    return op ? changePhoneLines(ctx, id, op) : Response.json({ error: "That request couldn't be read." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  if (body?.op === "approve") return pressQuote(ctx, id, { op: "approve" });
  if (body?.op === "unapprove") return pressQuote(ctx, id, { op: "unapprove" });
  if (body?.op === "accept" && typeof body.option === "number") return pressQuote(ctx, id, { op: "accept", option: body.option });
  if (body?.op === "send") return sendPhoneQuote(ctx, id);
  return Response.json({ error: "That request couldn't be read." }, { status: 400, headers: { "cache-control": "no-store" } });
}
