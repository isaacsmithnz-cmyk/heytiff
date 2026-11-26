import { actAsPhoneUser, requireMobile } from "@/lib/mobile/auth";
import { POST as speak } from "@/app/api/tiff/speak/route";

/* HER VOICE ON THE PHONE: the web's own door (api/tiff/speak), run as the
   person the token check verified, so the gate, the cleaning of the words
   and the fallback are the web's. The phone plays what comes back, or on a
   503 says "Voice is unavailable at the moment." */

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return actAsPhoneUser(ctx, () => speak(request));
}
