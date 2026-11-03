import { ok, requireMobile } from "@/lib/mobile/auth";
import { readUsedWords } from "@/lib/mobile/used-read";

/* WHAT YOU SAID YOU USED, FOUND IN THE PRICE BOOK (lib/mobile/used-read):
   the words in, the things back, each picked from the book or with its
   Which one?, for the phone to show before Add. Nothing is written. The
   job sheet's tier, as the list itself. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const input = (await request.json().catch(() => null)) as { words?: unknown } | null;
  const words = typeof input?.words === "string" ? input.words.trim() : "";
  if (!words) return Response.json({ error: "Say what you used." }, { status: 400, headers: { "cache-control": "no-store" } });
  const found = await readUsedWords(ctx.orgId, words);
  if (!found) return Response.json({ error: "Couldn't read that. Try again." }, { status: 502, headers: { "cache-control": "no-store" } });
  return ok({ found });
}
