import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { readUsedWords } from "@/lib/mobile/used-read";

/* WHAT YOU SAID YOU USED, FOUND IN THE JOB'S QUOTE OR THE PRICE BOOK
   (lib/mobile/used-read): the words in, the things back, each picked or
   with its Which one?, for the phone to show before Add. Nothing is
   written. The job sheet's tier, as the list itself. The job is the card's
   own (a visit's card reads its parent's quote), and its quote is only ever
   read within the caller's workspace. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const input = (await request.json().catch(() => null)) as { words?: unknown } | null;
  const words = typeof input?.words === "string" ? input.words.trim() : "";
  if (!words) return Response.json({ error: "Say what you used." }, { status: 400, headers: { "cache-control": "no-store" } });
  const id = (await params).id.trim().slice(0, 80);
  const job = id ? (await resolveJobCard(ctx.orgId, id)).parentRemoteId : undefined;
  const found = await readUsedWords(ctx.orgId, words, job || undefined);
  if (!found) return Response.json({ error: "Couldn't read that. Try again." }, { status: 502, headers: { "cache-control": "no-store" } });
  return ok({ found });
}
