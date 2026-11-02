import { POST as talkPost } from "@/app/api/workboard/quote-session/route";
import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";
import { asPhone, readPhoneSources, readPhoneTalk } from "@/lib/mobile/phone-quote-server";

/* TIFF'S SESSION ON A QUOTE, from the phone: the web's own route as the token's
   person, the same thread on either. GET reads it, or with ?sources=1 what she'd
   read; POST is a message, with the sources left ticked where it starts the quote,
   or a tapped answer. Her turn runs on after the answer. */

export const maxDuration = 300;

const web = "https://phone.local/api/workboard/quote-session";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = (await params).id.trim().slice(0, 80);
  return new URL(request.url).searchParams.get("sources") === "1" ? readPhoneSources(ctx, job) : readPhoneTalk(ctx, job);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const job = (await params).id.trim().slice(0, 80);
  const body = (await request.json().catch(() => null)) as { message?: unknown; sources?: unknown; op?: unknown; event?: unknown; answer?: unknown } | null;
  if (!body) return Response.json({ error: "That request couldn't be read." }, { status: 400, headers: { "cache-control": "no-store" } });
  /* only what the phone sends: a researched price stays on the web */
  const said = body.op === "answer" ? { job, op: "answer", event: body.event, answer: body.answer } : { job, message: body.message, ...(Array.isArray(body.sources) ? { sources: body.sources } : {}) };
  return actAsPhoneUser(ctx, async () =>
    asPhone(await talkPost(new Request(web, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(said) }))),
  );
}
