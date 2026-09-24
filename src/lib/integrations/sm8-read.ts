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
   call (a token, the account's counter and a lane).

   EVERY REQUEST GOES THROUGH THE ONE DOOR (sm8-http), which counts it
   against the account's limit. A turn the counter refuses is `throttled`,
   and no request was made: the screens say ServiceM8 is busy, the sync
   pauses. */

import { fetchSm8Vendor, sm8Config, type Sm8Vendor } from "./sm8";
import { sm8CallOf, sm8Request, type Sm8Call } from "./sm8-http";
import { sm8AccessResult, type Sm8AccessResult } from "./sm8-store";
import { withSm8Renewal, type RenewVerdict } from "./sm8-renew";
import { SM8_BILLING } from "./sm8-sync-plan";
import type { ReadResult } from "./xero-read";

const HTTP_TIMEOUT_MS = 10_000;

const NOT_CONNECTED = "ServiceM8 isn't connected for this workspace.";
const UNAVAILABLE = "ServiceM8 couldn't be reached just now. Try again shortly.";
const REAUTH = "The ServiceM8 connection needs reconnecting.";
/** The account's call limit had no room for this read. */
export const BUSY = "ServiceM8 is busy for this account. Try again in a minute.";

/** Why there was no token to read with, as the screen's sentence: a refresh
    that couldn't reach ServiceM8 is "try again shortly", never "reconnect". */
function noAccess(r: Extract<Sm8AccessResult, { ok: false }>): string {
  return r.reason === "unreachable" ? UNAVAILABLE : r.reason === "reauth" ? REAUTH : NOT_CONNECTED;
}

/** A renewal that ended the read, as the screen's sentence; null when the
    answer it came back with should be read as usual. */
function renewalEnded(verdict: RenewVerdict): string | null {
  if (verdict === "dead") return REAUTH; // flagged already, for this grant only
  if (verdict === "unreachable") return UNAVAILABLE;
  if (verdict === "gone") return NOT_CONNECTED;
  return null;
}

/** One live read of the account identity. Doubles as the health check: a
    connection revoked from ServiceM8's own side still has a row and
    unexpired-looking tokens here, and this is what notices — a 401 that
    survives one renewal marks the row needs_reauth, so the next render says
    "reconnect". A token that merely ran out is renewed and the read goes on:
    this runs on every render of the connection screen, and an hourly token
    expiring must not read as a dead connection. */
export async function readSm8Vendor(orgId: string): Promise<ReadResult<Sm8Vendor>> {
  if (!sm8Config()) return { ok: false, error: NOT_CONNECTED };

  const got = await sm8AccessResult(orgId);
  if (!got.ok) return { ok: false, error: noAccess(got) };

  const read = await withSm8Renewal(
    orgId,
    got.access,
    (a) => fetchSm8Vendor(sm8CallOf(a, "read")),
    (r) => !r.ok && r.unauthorized
  );
  const ended = renewalEnded(read.verdict);
  if (ended) return { ok: false, error: ended };

  const result = read.result;
  if (result.ok) return { ok: true, data: result.vendor };
  /* Deliberately NOT needs_reauth: the grant is fine, and telling someone to
     reconnect a healthy connection sends them round a loop that cannot fix a
     billing state. */
  if (result.paymentRequired) return { ok: false, error: SM8_BILLING };
  if (result.throttled) return { ok: false, error: BUSY };
  return { ok: false, error: UNAVAILABLE };
}

/* ── the import screen's staff read ── */

const STAFF_SCOPE = "Reconnect ServiceM8 to grant the Staff read — this connection predates it.";

/** Every staff member in the connected ServiceM8 account, as RAW rows — live,
    not from the sm8_staff mirror, because the mirror deliberately keeps names
    and titles only. Import is the one moment email and mobile are wanted, so
    they are read here transiently and persisted only onto cards a human
    chooses to create; the mirror's PII posture doesn't move.

    Shaping is sm8-people.ts's job, behind its tests — same split as the sync
    engine and sm8-sync-plan. */
export async function readSm8StaffRows(
  orgId: string
): Promise<ReadResult<Record<string, unknown>[]>> {
  if (!sm8Config()) return { ok: false, error: NOT_CONNECTED };

  const got = await sm8AccessResult(orgId);
  if (!got.ok) return { ok: false, error: noAccess(got) };
  let access = got.access;

  const rows: Record<string, unknown>[] = [];
  let cursor = "-1";
  /* A staff list is tens of rows; ten pages is ten thousand. Past that the
     walk is wrong, not the team big — stop rather than loop. */
  for (let pages = 0; pages < 10; pages++) {
    const read = await withSm8Renewal(
      orgId,
      access,
      (a) => fetchSm8Page(sm8CallOf(a, "read"), "staff.json", { cursor, filter: null }),
      (p) => !p.ok && p.failure === "unauthorized"
    );
    access = read.access;
    const ended = renewalEnded(read.verdict);
    if (ended) return { ok: false, error: ended };
    const page = read.result;
    if (!page.ok) {
      if (page.failure === "forbidden") return { ok: false, error: STAFF_SCOPE };
      if (page.failure === "payment_required") return { ok: false, error: SM8_BILLING };
      if (page.failure === "throttled" || page.failure === "rate_limited") return { ok: false, error: BUSY };
      return { ok: false, error: UNAVAILABLE };
    }
    rows.push(...page.rows);
    if (!page.nextCursor) return { ok: true, data: rows };
    cursor = page.nextCursor;
  }
  console.error(`[sm8] staff.json walk passed 10 pages for org ${orgId} — stopping`);
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
  | "throttled"
  | "unavailable";

export type Sm8Page =
  | { ok: true; rows: Record<string, unknown>[]; nextCursor: string | null }
  /** `called: false` — no request reached ServiceM8 (the counter refused the
      turn), so a caller counting its calls doesn't count this one. */
  | { ok: false; failure: Sm8PageFailure; called?: false };

/** One page of one object: up to 1000 rows plus the x-next-cursor header
    that names the next page (absent = walk complete). The failure kinds are
    the different DECISIONS the engine makes — dead grant, missing scope, the
    account can't be billed, ServiceM8 said back off, the account's own
    counter had no room, try later — so they come back as data, not
    sentences.

    `timeoutMs` shortens the wait for a caller that holds a clock of its
    own — the sender reading one attachment back under its row's claim. */
export async function fetchSm8Page(
  call: Sm8Call,
  endpoint: string,
  opts: { cursor: string; filter: string | null; timeoutMs?: number }
): Promise<Sm8Page> {
  const query: Record<string, string> = { cursor: opts.cursor };
  if (opts.filter) query.$filter = opts.filter;

  try {
    const answer = await sm8Request(call, endpoint, { query, timeoutMs: opts.timeoutMs ?? HTTP_TIMEOUT_MS });
    if (answer.kind === "throttled") return { ok: false, failure: "throttled", called: false };
    const res = answer.res;
    if (res.status === 401) return { ok: false, failure: "unauthorized" };
    if (res.status === 403) {
      /* The engine words this one ("Reconnect ServiceM8 to grant X") — but a
         403 can arrive WITH the grant held: on 2026-08-13 attachment.json
         refused a token whose own token-response named all fifteen scopes.
         When the worded sentence is wrong, the body is the only witness to
         which privilege the endpoint actually wanted, so it goes to the log
         (truncated, token never included). */
      await logSm8Failure(`GET ${endpoint}`, res);
      return { ok: false, failure: "forbidden" };
    }
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
