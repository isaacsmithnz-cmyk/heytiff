/* The one door to ServiceM8's REST API — server only.

   Every request HeyTiff makes to api.servicem8.com goes through
   `sm8Request`, and a test (sm8-one-door) holds it: no other file may call
   fetch on the REST API. The OAuth token endpoint is a different host and
   stays in sm8.ts.

   IN ORDER, FOR EVERY REQUEST:
   1. THE ADDRESS IS CHECKED. The path is resolved against the API base and
      refused unless it stays on https://api.servicem8.com/api_1.0/ — so a
      value from outside (a webhook's link, one day) can never make HeyTiff
      fetch somewhere else with an owner's token on it.
   2. A TURN IS TAKEN from the account's counter (sm8-meter). A short wait
      for the per-minute bucket is slept through, once, when it fits the
      lane's patience; anything longer — a cooldown after a 429, or the day's
      cap — comes back as `throttled`, and no request is made.
   3. THE REQUEST, with the bearer token and a timeout. A network error is
      thrown, as fetch's own, so the callers' existing catches still work.
   4. A 429 IS RECORDED against the account, as the kind ServiceM8 named,
      so every other caller waits out the same cooldown. The response still
      comes back to the caller, with the kind beside it.

   `meter: null` skips the counter. It is for the callback's connect-time
   vendor read alone: the account isn't known until that read answers.

   NOTHING HERE LOGS. The token is in the call and nowhere else. */

import { noteSm8Throttle, sm8LimitOf, SM8_METER, takeSm8Call, type MeterRefusal, type Sm8Lane } from "./sm8-meter";

export type { Sm8Lane };

export const SM8_API_BASE = "https://api.servicem8.com/api_1.0/";

const API_ORIGIN = "https://api.servicem8.com";
const API_PATH = "/api_1.0/";

/* Generous for a cold serverless start, short enough that a wedged upstream
   fails the page rather than hanging it. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Who is asking, and with what: a token, the account's counter (null only
    for the connect-time read), and the lane its turn is taken on. */
export type Sm8Call = { accessToken: string; meter: string | null; lane: Sm8Lane };

export type Sm8Answer =
  /** `limit` is set on a 429 only: which of ServiceM8's limits it was. */
  | { kind: "response"; res: Response; limit: "minute" | "day" | null }
  /** No request was made: the counter had no turn for this call. */
  | { kind: "throttled"; waitMs: number; why: MeterRefusal };

/** A call on `lane` with an access the store handed out. */
export function sm8CallOf(access: { accessToken: string; meter: string }, lane: Sm8Lane): Sm8Call {
  return { accessToken: access.accessToken, meter: access.meter, lane };
}

/** The address a path names, or a throw when it leaves the API. */
export function sm8Url(path: string, query?: Record<string, string>): URL {
  const url = new URL(path, SM8_API_BASE);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith(API_PATH) || url.username || url.password) {
    throw new Error("[sm8] refused a request outside ServiceM8's API");
  }
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A 429's body, read from a copy so the caller can still read the
    original. Empty when it can't be read. */
async function bodyOf(res: Response): Promise<string> {
  try {
    return await res.clone().text();
  } catch {
    return "";
  }
}

export async function sm8Request(
  call: Sm8Call,
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: BodyInit;
    query?: Record<string, string>;
    timeoutMs?: number;
  } = {},
  deps: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<Sm8Answer> {
  const url = sm8Url(path, init.query);

  if (call.meter !== null) {
    let turn = await takeSm8Call(call.meter, call.lane);
    if (!turn.ok && turn.why === "minute" && turn.waitMs <= SM8_METER.maxWaitMs[call.lane]) {
      await (deps.sleep ?? sleepFor)(turn.waitMs);
      turn = await takeSm8Call(call.meter, call.lane);
    }
    if (!turn.ok) return { kind: "throttled", waitMs: turn.waitMs, why: turn.why };
  }

  const res = await fetch(url.toString(), {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${call.accessToken}` },
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (res.status !== 429) return { kind: "response", res, limit: null };
  const limit = sm8LimitOf(await bodyOf(res));
  if (call.meter !== null) await noteSm8Throttle(call.meter, limit);
  return { kind: "response", res, limit };
}
