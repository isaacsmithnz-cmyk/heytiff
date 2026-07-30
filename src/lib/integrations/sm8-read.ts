/* Reading from ServiceM8 on behalf of an org — the thin layer between
   sm8-store's tokens and anything that renders. xero-read.ts's sibling, and
   the same three-sentence posture: every failure a screen can see is one of
   OUR sentences, never an upstream body.

   Two reads live here: the vendor proof-of-life the connection screen runs,
   and the raw page fetcher the sync engine walks objects with. The page
   fetcher classifies failures instead of wording them — the engine decides
   what a 403 MEANS for one object versus a 429 for the whole run — and it
   never parses rows: shaping is sm8-sync-plan.ts's job, behind its tests.

   NO SESSION HERE — callers establish the right to ask (the page behind its
   owner gate, the cron behind CRON_SECRET) and hand in a bare orgId or a
   bare access token. */

import { fetchSm8Vendor, SM8_API_BASE, sm8Config, type Sm8Vendor } from "./sm8";
import { markSm8NeedsReauth, sm8Access } from "./sm8-store";
import { SM8_BILLING } from "./sm8-sync-plan";
import type { ReadResult } from "./xero-read";

const HTTP_TIMEOUT_MS = 10_000;

const NOT_CONNECTED = "ServiceM8 isn't connected for this workspace.";
const UNAVAILABLE = "ServiceM8 couldn't be reached just now. Try again shortly.";
const REAUTH = "The ServiceM8 connection needs reconnecting.";

/** One live read of the account identity. Doubles as the health check: a
    connection revoked from ServiceM8's own side still has a row and
    unexpired-looking tokens here, and this is what notices — the 401 marks
    the row needs_reauth, so the next render says "reconnect". */
export async function readSm8Vendor(orgId: string): Promise<ReadResult<Sm8Vendor>> {
  if (!sm8Config()) return { ok: false, error: NOT_CONNECTED };

  const access = await sm8Access(orgId);
  if (!access) return { ok: false, error: NOT_CONNECTED };

  const result = await fetchSm8Vendor(access.accessToken);
  if (result.ok) return { ok: true, data: result.vendor };

  if (result.unauthorized) {
    await markSm8NeedsReauth(orgId, "ServiceM8 no longer accepts this connection. Reconnect ServiceM8.");
    return { ok: false, error: REAUTH };
  }
  /* Deliberately NOT needs_reauth: the grant is fine, and telling someone to
     reconnect a healthy connection sends them round a loop that cannot fix a
     billing state. */
  if (result.paymentRequired) return { ok: false, error: SM8_BILLING };
  return { ok: false, error: UNAVAILABLE };
}

/* ── what a failure tells the SERVER ── */

/* The classification a screen sees is deliberately coarse — four decisions,
   our own sentences, no upstream text. That is right for a page and useless
   for a diagnosis: on 2026-07-30 the first live connection reported "couldn't
   be reached" for every object, and because the status was discarded a 404, a
   500 and a 200-that-isn't-an-array were one indistinguishable outcome. This
   is the same hole #223 closed in the voice adapter, in a different file.

   The status IS the diagnosis: 400 our query, 404 a wrong endpoint or a
   dropped path segment, 5xx theirs, and a non-array 200 means the shape
   assumption is wrong. The body is a vendor's error text, so it is truncated
   and goes to the server log — never to a page, never near the token. */
async function logSm8Failure(what: string, res: Response, note?: string): Promise<void> {
  let detail = note ?? "";
  if (!note) {
    try {
      detail = (await res.text()).slice(0, 500);
    } catch {
      detail = "<unreadable body>";
    }
  }
  console.error(`[sm8] ${what} ${res.status} ${res.statusText}: ${detail}`);
}

/* ── the sync engine's page reader ── */

export type Sm8PageFailure =
  | "unauthorized"
  | "forbidden"
  | "payment_required"
  | "rate_limited"
  | "unavailable";

export type Sm8Page =
  | { ok: true; rows: Record<string, unknown>[]; nextCursor: string | null }
  | { ok: false; failure: Sm8PageFailure };

/** One page of one object: up to 1000 rows plus the x-next-cursor header
    that names the next page (absent = walk complete). The five failure kinds
    are the five different DECISIONS the engine makes — dead grant, missing
    scope, the account can't be billed, back off, try later — so they come back
    as data, not sentences. */
export async function fetchSm8Page(
  accessToken: string,
  endpoint: string,
  opts: { cursor: string; filter: string | null }
): Promise<Sm8Page> {
  const url = new URL(endpoint, SM8_API_BASE);
  url.searchParams.set("cursor", opts.cursor);
  if (opts.filter) url.searchParams.set("$filter", opts.filter);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.status === 401) return { ok: false, failure: "unauthorized" };
    if (res.status === 403) return { ok: false, failure: "forbidden" };
    if (res.status === 402) return { ok: false, failure: "payment_required" };
    if (res.status === 429) return { ok: false, failure: "rate_limited" };
    if (!res.ok) {
      await logSm8Failure(`GET ${endpoint}`, res);
      return { ok: false, failure: "unavailable" };
    }

    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      // A 200 we can't walk: the shape assumption, not the connection.
      await logSm8Failure(`GET ${endpoint}`, res, "200 but body is not a JSON array");
      return { ok: false, failure: "unavailable" };
    }
    return {
      ok: true,
      rows: body.filter((r): r is Record<string, unknown> => !!r && typeof r === "object"),
      nextCursor: res.headers.get("x-next-cursor"),
    };
  } catch (err) {
    /* Reaching the host at all failed — DNS, TLS, or the 10s timeout. Worth
       distinguishing from a served error, because nothing above logged it. */
    console.error(
      `[sm8] GET ${endpoint} request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { ok: false, failure: "unavailable" };
  }
}
