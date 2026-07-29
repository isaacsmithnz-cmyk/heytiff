import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { transcribeAudio, TRADE_KEYTERMS } from "@/lib/voice/transcribe";

/* Audio in, words out. A route handler rather than a Server Function for one
   concrete reason: Server Functions cap request bodies at 1MB by default, and
   a two-minute site recording is comfortably past that. Raising that limit
   globally to carry audio would widen the limit for every action in the app,
   so the audio gets its own door instead.

   The recording is never stored. It is transcribed and dropped; only the
   transcript reaches the database, because the transcript is the evidence
   for what gets applied and the recording is a voice in a customer's house.

   GATED `workboard`, not `workboard_manage`: dictating your own day is the
   whole point, and a route handler is reachable directly, so the gate is
   here rather than only on the screen that posts to it. */

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await can("workboard"))) {
    return Response.json({ error: "You don't have access to the Workboard." }, { status: 403 });
  }

  let audio: Blob;
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob) || file.size === 0) {
      return Response.json({ error: "There was no recording to read." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: "That recording is too long. Keep it under a couple of minutes." }, { status: 413 });
    }
    audio = file;
  } catch {
    return Response.json({ error: "That recording couldn't be read." }, { status: 400 });
  }

  /* Staff first names are the keyterms that matter most — "tell Luke" only
     routes if the transcriber heard "Luke". They are boosted alongside the
     trade vocabulary a general model mishears on an Australian site. */
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name")
    .eq("org_id", orgId)
    .limit(200);

  const names = ((data ?? []) as { full_name: string | null }[])
    .flatMap((s) => (s.full_name ?? "").trim().split(/\s+/))
    .filter(Boolean);

  const result = await transcribeAudio(audio, { keyterms: [...names, ...TRADE_KEYTERMS] });
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });

  return Response.json({ text: result.text });
}
