import { after, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8WebhooksState } from "@/lib/integrations/sm8-hooks-switch";
import {
  PING_BODY_MAX,
  PING_QUEUE_CAP,
  ROUTE_DRAIN_MS,
  functionDeadline,
  hookHashOf,
  isHookSecret,
  parsePing,
  redactHook,
  type Ping,
} from "@/lib/integrations/sm8-hook-plan";

/* Where ServiceM8's pings land (two-way phase 4, PR E):
   /api/integrations/servicem8/webhook/<hook>.

   A PING IS A DOORBELL, NEVER DATA. ServiceM8 POSTs
   {object, entry:[{uuid, changed_fields, time}], resource_url} each time a
   subscribed field changes, and nothing else: no values, no account, no
   signature. So the only things read from it are the object (normalised,
   one of the six we mirror) and the entries' uuids (pattern-checked,
   lowercased, at most ten) — parsePing's whole output. `resource_url` is
   never fetched, and `time` and `changed_fields` are never looked at: the
   drain reads each record itself, through the one door, and the record's
   own edit_date orders it (sm8-hook-drain).

   THE PROOF IS THE ADDRESS. <hook> is 32 random bytes minted when we
   subscribed; the database holds only its SHA-256 (sm8_webhook_hooks). It
   is hashed here and looked up in ONE round trip, sm8_take_ping, which also
   queues or merges the records the ping names. What it says:
   - unknown (never ours, retired more than 72 h ago, or wiped by a
     disconnect) and stale (the account it was minted for is no longer the
     connection's) answer 410, which ServiceM8 documents as unsubscribing;
   - known answers a challenge with the challenge alone;
   - queued answers 200 and, behind the response, runs the drain, waiting
     for its rows to go quiet — single-flight, so a burst of pings runs one;
   - merged (every record was already waiting: a drain is on it) and full
     (the queue's cap: the next ordinary sync is asked for, by the RPC)
     answer 200 and start nothing. NOTHING HERE RUNS A SYNC.
   A failed lookup is 503, NEVER 410: a blip must not unsubscribe us.
   Nothing answers 429, which would throttle the whole account.

   THE SECRET IS NEVER WRITTEN DOWN. Not in a log line, not in an error:
   the one line logged per request names the verdict, the body's kind and
   how many records, and anything else that might carry the path goes
   through redactHook first. (Vercel's own request log does show the path,
   for an hour: spec risk 3.)

   OFF, IT DOES NOTHING. With SM8_WEBHOOKS anything but on or gone
   (sm8-hooks-switch — and anywhere but Production), every request is 404
   before a byte is read: no database, no after(). `gone` is the rollback:
   a well-formed hook path answers 410, still with no database read, so
   ServiceM8 drops each subscription at its next ping. sm8-hooks-prod.test
   holds both.

   The proxy lets this path straight through (proxy.ts): no canonical-host
   308, which would turn ServiceM8's POST into nothing, and no session work
   on a machine's call. The hook check below is the whole gate. */

/* The drain behind a `queued` answer reads one record a second under the
   sync lease; every budget it keeps comes from this number
   (functionDeadline). The platform's whole 300 s. */
export const maxDuration = 300;
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

type BodyKind = "json" | "json_text" | "form" | "query" | "none";

function answer(status: number): Response {
  return new Response(null, { status, headers: NO_STORE });
}

/** The one line a request leaves. Never the hook, the path or the body. */
function logLine(verdict: string, body: BodyKind, uuids: number, extra = ""): void {
  console.info(`[sm8] webhook: ${verdict} (${body}, ${uuids} uuid${uuids === 1 ? "" : "s"})${extra}`);
}

/** The body, read up to PING_BODY_MAX bytes; null when it runs past. */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > PING_BODY_MAX) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

/** A Content-Length that says the body is too big to read. A missing or
    unreadable one isn't trusted either way: the read is capped. */
function saysOversized(request: Request): boolean {
  const len = request.headers.get("content-length");
  if (len === null || !/^\d+$/.test(len.trim())) return false;
  return Number(len.trim()) > PING_BODY_MAX;
}

function bodyKindOf(ping: Ping): BodyKind {
  if (ping.kind === "challenge") return ping.via;
  if (ping.kind === "change" || ping.kind === "ignored") return ping.body;
  return "none";
}

type Verdict = "unknown" | "stale" | "known" | "queued" | "merged" | "full";
const VERDICTS: readonly string[] = ["unknown", "stale", "known", "queued", "merged", "full"];

/** sm8_take_ping's one row, or null for a failed or unreadable answer. */
async function takePing(
  hook: string,
  ping: Extract<Ping, { kind: "challenge" | "change" }>
): Promise<{ verdict: Verdict; org: string | null } | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("sm8_take_ping", {
      p_hash: hookHashOf(hook),
      p_object: ping.kind === "change" ? ping.object : null,
      p_uuids: ping.kind === "change" ? ping.uuids : null,
      p_cap: PING_QUEUE_CAP,
    });
    if (error) {
      console.error(`[sm8] webhook: the lookup failed: ${redactHook(String(error.message ?? ""), [hook])}`);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { verdict?: unknown; hook_org?: unknown } | null | undefined;
    const verdict = row?.verdict;
    if (typeof verdict !== "string" || !VERDICTS.includes(verdict)) {
      console.error("[sm8] webhook: the lookup answered nothing readable");
      return null;
    }
    return { verdict: verdict as Verdict, org: typeof row?.hook_org === "string" ? row.hook_org : null };
  } catch (err) {
    console.error(`[sm8] webhook: the lookup threw: ${redactHook(err instanceof Error ? err.message : String(err), [hook])}`);
    return null;
  }
}

/** Behind a `queued` answer: the drain, loaded only now, waiting for its
    rows to go quiet, inside this function's own deadline. `hook` is here
    only to be redacted from a failure's words. */
function drainBehind(orgId: string, startedAt: number, hook: string): void {
  after(async () => {
    try {
      const { drainSm8Hooks } = await import("@/lib/integrations/sm8-hook-drain");
      await drainSm8Hooks(orgId, { deadline: functionDeadline(startedAt, maxDuration), maxMs: ROUTE_DRAIN_MS, wait: true });
    } catch (err) {
      console.error(`[sm8] webhook: the drain for org ${orgId} didn't run: ${redactHook(err instanceof Error ? err.message : String(err), [hook])}`);
    }
  });
}

async function handle(request: NextRequest, params: Promise<{ hook: string }>, method: "GET" | "POST"): Promise<Response> {
  const startedAt = Date.now();
  const state = sm8WebhooksState();
  if (state === "off") return answer(404);

  const { hook } = await params;
  if (!isHookSecret(hook)) return answer(404);
  if (state === "gone") return answer(410);

  try {
    let text = "";
    if (method === "POST") {
      if (saysOversized(request)) {
        logLine("oversized", "none", 0);
        return answer(200);
      }
      const read = await readCapped(request);
      if (read === null) {
        logLine("oversized", "none", 0);
        return answer(200);
      }
      text = read;
    }

    const ping = parsePing(method === "POST" ? request.headers.get("content-type") : null, text, request.nextUrl.searchParams);
    const kind = bodyKindOf(ping);
    if (ping.kind === "junk") {
      logLine("junk", kind, 0, ping.challengeLength !== undefined ? `, a challenge of ${ping.challengeLength} refused` : "");
      return answer(200);
    }
    if (ping.kind === "ignored") {
      logLine("ignored", kind, 0);
      return answer(200);
    }

    const uuids = ping.kind === "change" ? ping.uuids.length : 0;
    const took = await takePing(hook, ping);
    if (took === null) {
      logLine("error", kind, uuids);
      return answer(503);
    }
    const { verdict, org } = took;
    logLine(verdict, kind, uuids);

    if (verdict === "unknown" || verdict === "stale") return answer(410);

    if (ping.kind === "challenge") {
      if (verdict !== "known") return answer(503);
      return new Response(ping.challenge, {
        status: 200,
        headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" },
      });
    }

    if (verdict === "queued") {
      if (org) drainBehind(org, startedAt, hook);
      else console.error("[sm8] webhook: queued with no workspace named; the backstops will read it");
      return answer(200);
    }
    if (verdict === "merged" || verdict === "full") return answer(200);
    return answer(503);
  } catch (err) {
    console.error(`[sm8] webhook: ${redactHook(err instanceof Error ? err.message : String(err), [hook])}`);
    return answer(503);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ hook: string }> }): Promise<Response> {
  return handle(request, params, "GET");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ hook: string }> }): Promise<Response> {
  return handle(request, params, "POST");
}
