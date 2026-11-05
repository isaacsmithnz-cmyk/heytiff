import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";
import { POST as token } from "@/app/api/workboard/transcribe/token/route";

/* SPEAKING TO THE PHONE, LIVE: the web's own live-dictation door (api/
   workboard/transcribe/token), run as the person the token check verified,
   so its gate (`canDictate`), its single-use key and its words (staff names
   first, then the trade's) are the web's. The phone opens the socket itself
   with the key and streams to it while you talk, so the words are right as
   you say them and there when you stop (Isaac, 5 November 2026: "the initial
   voice to text is fairly inaccurate. Claude's is almost instant"). No audio
   comes through here. */

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return actAsPhoneUser(ctx, () => token());
}
