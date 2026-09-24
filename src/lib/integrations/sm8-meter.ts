/* One call counter per ServiceM8 account — server only.

   ServiceM8 limits an ACCOUNT, not a caller: 180 requests a minute and
   20,000 a day, shared by the sync, the screens' live reads and every file
   sent. Each of those used to spend the limit on its own, and the first to
   notice the others was a 429. This is the one counter they all take a turn
   from (sm8-http's sm8Request, the only door to the REST API), kept in the
   database so every serverless worker sees the same count.

   THE NUMBERS LIVE HERE, AND ARE TESTED. The SQL function
   (docs/migrations/sm8_calls_echo_freshness.sql, sm8_take_call) only carries
   them out: a token bucket of `burst`, refilled at `perSecond`, with a
   floor each lane must leave behind and a cap per UTC day.

   - THE FLOORS ARE WHAT GIVE A SEND PRIORITY. The sync can never take the
     last 10 tokens and a read never the last 4, so a person's Send always
     finds room while a backfill walks beside it.
   - THE DAILY CAPS STOP THE SYNC FIRST (12,000), then the reads (16,000),
     then the writes (18,000), all under ServiceM8's 20,000. The sync's own
     2,000 a day per workspace (DAILY_CALL_BUDGET) stays as it is.
   - A 429 IS SHARED. Whoever meets one records it (noteSm8Throttle), and
     every caller then waits out the cooldown instead of asking to be told
     again.

   A COUNTER THAT CAN'T BE READ LETS CALLS THROUGH. Before the migration, or
   on a database blip, the RPC errors; the answer is then "go", logged once
   per worker. That is how every call behaved before this existed, and
   blocking instead would stop all ServiceM8 traffic on a missing function. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { SM8_PER_DAY } from "./sm8-write-plan";

/** Who is asking: a write a person pressed, a live read a screen needs, or
    the sync's walk. */
export type Sm8Lane = "write" | "read" | "sync";

export const SM8_METER = {
  /** Tokens the bucket holds; refilled at `perSecond`. The worst 60 s is
      burst + 60 × perSecond = 140 calls, against ServiceM8's 180. */
  burst: 20,
  perSecond: 2,
  /** Tokens each lane must leave behind. */
  floor: { write: 0, read: 4, sync: 10 },
  /** Calls each lane may make per UTC day, counted across all three. */
  dayCap: { write: 18_000, read: 16_000, sync: 12_000 },
  /** The longest a caller sleeps for a turn before it is handed back. */
  maxWaitMs: { write: 5_000, read: 2_000, sync: 3_000 },
  /** How long every caller holds off after a 429 of each kind. */
  cooldownMs: { minute: 60_000, day: 3_600_000 },
} as const;

export type MeterRefusal = "minute" | "day" | "cooldown_minute" | "cooldown_day";

export type MeterAnswer = { ok: true } | { ok: false; waitMs: number; why: MeterRefusal };

const REFUSALS: readonly MeterRefusal[] = ["minute", "day", "cooldown_minute", "cooldown_day"];

let warned = false;

/** Once per worker: the counter isn't there, or couldn't be asked. */
function unavailable(code: string | null | undefined): MeterAnswer {
  if (!warned) {
    warned = true;
    console.error(`[sm8] call meter unavailable (${code ?? "no code"}) — calls are not being counted`);
  }
  return { ok: true };
}

/** A turn for `n` calls to the account `meter` names, on `lane`. Never
    throws: a counter that can't be asked answers "go" (see the header). */
export async function takeSm8Call(meter: string, lane: Sm8Lane, n = 1): Promise<MeterAnswer> {
  let data: unknown;
  try {
    const res = await supabaseAdmin.rpc("sm8_take_call", {
      p_meter: meter,
      p_n: n,
      p_burst: SM8_METER.burst,
      p_per_second: SM8_METER.perSecond,
      p_floor: SM8_METER.floor[lane],
      p_day_cap: SM8_METER.dayCap[lane],
    });
    if (res.error) return unavailable(res.error.code);
    data = res.data;
  } catch (err) {
    return unavailable(err instanceof Error ? err.message.slice(0, 80) : null);
  }
  /* RETURNS TABLE comes back as an array of one row */
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== "object" || typeof row.ok !== "boolean") return unavailable("no row");
  if (row.ok) return { ok: true };
  const why = REFUSALS.includes(row.why as MeterRefusal) ? (row.why as MeterRefusal) : "minute";
  const waitMs = Math.max(0, Math.ceil(Number(row.wait_ms) || 0));
  return { ok: false, waitMs, why };
}

/** ServiceM8 said 429: every caller on this account waits out a cooldown —
    a minute for the per-minute limit, an hour for the daily one. Never
    throws; a counter that can't be written is logged once, like one that
    can't be read. */
export async function noteSm8Throttle(meter: string, limit: "minute" | "day"): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("sm8_note_throttle", {
      p_meter: meter,
      p_kind: limit,
      p_cooldown_ms: SM8_METER.cooldownMs[limit],
    });
    if (error) unavailable(error.code);
  } catch (err) {
    unavailable(err instanceof Error ? err.message.slice(0, 80) : null);
  }
}

/** Which of ServiceM8's limits a 429's body names: "Number of allowed API
    requests per day exceeded" is the daily one, anything else the minute.
    The same words the sender reads (SM8_PER_DAY), plain text or JSON. */
export function sm8LimitOf(body: string): "minute" | "day" {
  return SM8_PER_DAY.test(body) ? "day" : "minute";
}
