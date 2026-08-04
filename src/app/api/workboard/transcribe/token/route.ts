import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { mintRealtimeToken, prepareKeyterms, TRADE_KEYTERMS } from "@/lib/voice/transcribe";
import { REALTIME_KEYTERM_LIMIT, REALTIME_KEYTERM_MAX_CHARS } from "@/lib/voice/realtime";

/* The live path's front door. No audio comes through here — the browser
   streams that straight to the vendor — so this route hands out the two
   things the browser can't work out for itself: a short-lived token, and
   the words this org would otherwise be misheard on.

   WHY THE BROWSER AND NOT US: a WebSocket has to stay open for the length
   of the sentence, and Vercel Hobby functions don't hold one. Proxying the
   audio isn't a design choice we passed over, it's a thing that doesn't
   work here. The vendor's single-use token is the way around it — 15
   minutes, consumed on use, no account access — so `ELEVENLABS_API_KEY`
   still never leaves the server.

   SAME GATE AS THE AUDIO ROUTE, for the same reason: a route handler is
   reachable directly, so `workboard` is checked here rather than only on
   the screen that calls it. Minting a token IS spending money, and it is
   the only thing on this route worth abusing.

   Keyterms ride along because they're derived from data the browser has no
   business querying — and because the socket takes a SMALLER list than the
   batch endpoint (50 terms of 20 characters), so the trimming has to happen
   somewhere that knows which transport is being fed. */

export async function POST() {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!session || !orgId) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (!(await can("workboard"))) {
    return Response.json({ error: "You don't have access to the Workboard." }, { status: 403 });
  }

  const result = await mintRealtimeToken();
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });

  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("full_name")
    .eq("org_id", orgId)
    .limit(200);

  /* Names first: with only fifty slots, "Luke" earns its place ahead of
     "scissor lift" — a misheard name routes a task to nobody. */
  const names = ((data ?? []) as { full_name: string | null }[])
    .flatMap((s) => (s.full_name ?? "").trim().split(/\s+/))
    .filter(Boolean);

  const keyterms = prepareKeyterms([...names, ...TRADE_KEYTERMS], {
    maxChars: REALTIME_KEYTERM_MAX_CHARS,
    maxTerms: REALTIME_KEYTERM_LIMIT,
  });

  return Response.json({ token: result.token, keyterms });
}
