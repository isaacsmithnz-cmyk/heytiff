import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";
import { POST as transcribe } from "@/app/api/workboard/transcribe/route";

/* SPEAKING TO THE PHONE: the web's own dictation door (api/workboard/
   transcribe), run as the person the token check verified (actAsPhoneUser),
   so its gate (`canDictate`), its limits, its keyterms and its words are the
   web's. Audio in, words out; the recording is never kept. */

export const maxDuration = 120;

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return actAsPhoneUser(ctx, () => transcribe(request));
}
