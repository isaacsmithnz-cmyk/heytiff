import { auth0 } from "@/lib/auth0";
import { canDictate } from "@/lib/voice/can-dictate";
import { speakable, synthesize } from "@/lib/voice/speak";

/* HER VOICE'S FRONT DOOR (lib/voice/speak.ts says why it is built this way).
   Words in, her voice out, streamed so the first sound comes while the rest
   is still being made.

   THE SAME GATE AS HER EARS: whoever can speak to the app can be spoken to,
   and the route spends money per call, so "signed in" is not the bar.

   When she can't speak in her own voice (no voice set yet, or the key isn't
   allowed text to speech) the answer is 503 with the words cleaned for
   saying, `{ fallback: true, say }`, and the screen says them in the
   device's voice. That is the only case the screen hears about; a vendor's
   words never leave this file. */

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await canDictate())) {
    return Response.json({ error: "You don't have access to Tiff's voice." }, { status: 403 });
  }

  let raw = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && typeof (body as Record<string, unknown>).text === "string") {
      raw = (body as Record<string, unknown>).text as string;
    }
  } catch {
    /* not JSON: treated as nothing to say */
  }
  /* Read before the cap, so a pasted book can't cost a parse either. */
  const say = speakable(raw.slice(0, 20_000));
  if (!say) return Response.json({ error: "Nothing to say." }, { status: 400 });

  const result = await synthesize(say);
  if (result.ok) {
    return new Response(result.audio, {
      headers: { "Content-Type": result.contentType, "Cache-Control": "no-store" },
    });
  }
  if (result.fallback) return Response.json({ fallback: true, say }, { status: 503 });
  return Response.json({ error: "Tiff couldn't say that just now.", say }, { status: 502 });
}
