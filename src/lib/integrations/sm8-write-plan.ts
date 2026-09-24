/* Writing to ServiceM8 — the decisions, pure.

   sm8-sync-plan's sibling for the other direction. Everything here is a
   function of its arguments, so the rules that decide what a write BECOMES
   are pinned in a test with no network and no database. sm8-write.ts makes
   the request; sm8-writes.ts is the plumbing that carries these out.

   THE SHAPE OF A WRITE, whatever its kind (docs/migrations/sm8_writes.sql):
   - it is a ROW before it is a request, carrying the uuid ServiceM8 will
     know it by, chosen up front, so a retry names the same record and can't
     make a second copy;
   - one sender at a time holds it, by a lease on the row, and a sender that
     dies mid-request leaves the lease to lapse rather than the write to be
     lost;
   - what came back decides what it becomes: sent, tried again later, or
     stopped with a sentence somebody can act on. Those decisions are this
     file.

   THE SENTENCES ARE OURS. ServiceM8's response body goes to the server log,
   truncated, and never to a screen: the same rule the read side keeps
   (sm8-read.ts). A short copy of what it said (remote_code, remote_message)
   is kept on the row for whoever diagnoses it, and is never shown. */

import { SM8_WRITE_KIND_SCOPES } from "./providers";

/* ── the owner's switch ── */

/** `paused` stops everything going without losing anything waiting: the
    owner's own "not now", or HeyTiff's when a workspace sends more than
    WRITE_HOURLY_CAP in an hour. */
export type Sm8WriteMode = "off" | "trial" | "live" | "paused";

/** The switch as stored. Anything unreadable is off: a write path must fail
    closed. (What the SENDER does with an unreadable value is stricter still:
    it holds, and cancels nothing — see sm8-writes' runSm8Writes.) */
export function readWriteMode(v: unknown): Sm8WriteMode {
  return v === "trial" || v === "live" || v === "paused" ? v : "off";
}

/** Who paused sending: the owner, or HeyTiff's hourly cap. */
export type Sm8PausedReason = "owner" | "cap";

export function readPausedReason(v: unknown): Sm8PausedReason | null {
  return v === "owner" || v === "cap" ? v : null;
}

/* ── kinds ── */

/** A kind of write — the keys of the scope table, so a kind can't exist
    without the permission it needs. */
export type Sm8WriteKind = keyof typeof SM8_WRITE_KIND_SCOPES;

const KINDS = Object.keys(SM8_WRITE_KIND_SCOPES) as Sm8WriteKind[];

const isKind = (v: string): v is Sm8WriteKind => (KINDS as string[]).includes(v);

/** The kinds a deployment allows, from SM8_WRITES: the operator's switch.
    "1" is files (what it always meant); otherwise a comma list of kinds,
    unknown names dropped. Unset, empty or "0" is nothing, so a preview never
    writes. */
export function sm8WriteKindsFrom(env: string | undefined | null): Sm8WriteKind[] {
  const raw = (env ?? "").trim();
  if (raw === "" || raw === "0") return [];
  if (raw === "1") return ["attachment"];
  const out: Sm8WriteKind[] = [];
  for (const part of raw.split(",")) {
    const k = part.trim();
    if (isKind(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The kinds whose every scope the grant holds. */
export function grantedKinds(scopes: string | readonly string[] | null | undefined): Sm8WriteKind[] {
  const have = new Set(typeof scopes === "string" || scopes == null ? (scopes ?? "").split(/\s+/).filter(Boolean) : scopes);
  return KINDS.filter((k) => SM8_WRITE_KIND_SCOPES[k].every((s) => have.has(s)));
}

/** The kinds ServiceM8 refused for scope SINCE THE LAST CONNECT. `raw` is
    the connection's write_scope_refused, `{kind: when}`; a refusal older than
    `connected_at` belongs to an earlier grant, so a reconnect clears it
    without anything having to write. Junk reads as nothing refused. */
export function refusedKinds(raw: unknown, connectedAt: string | null | undefined): Sm8WriteKind[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const since = connectedAt ? Date.parse(connectedAt) : NaN;
  const out: Sm8WriteKind[] = [];
  for (const [k, at] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKind(k) || typeof at !== "string") continue;
    const when = Date.parse(at);
    if (Number.isNaN(when)) continue;
    if (Number.isNaN(since) || when > since) out.push(k);
  }
  return out;
}

/** Where writing stands for one workspace, as the sender and the card both
    need it. Built from the connection row and the deployment's switch. */
export type Sm8WriteState = {
  /** The connection row could be read. False means HOLD EVERYTHING AND
      CANCEL NOTHING: a failed read is not a switched-off workspace. */
  readable: boolean;
  /** The kinds this deployment allows (SM8_WRITES) — the operator's switch,
      above every owner's. None on a preview, so a branch can never write to
      a business's ServiceM8. */
  kinds: readonly Sm8WriteKind[];
  /** `kinds.length > 0`. */
  deployment: boolean;
  /** The owner's setting, read. */
  mode: Sm8WriteMode;
  /** The setting exactly as stored — null with no connection row. Only a
      stored "off" cancels what is waiting; any other value `mode` reads as
      off (junk) holds. */
  modeStored: string | null;
  pausedReason: Sm8PausedReason | null;
  /** When sending was last paused. Kept on resume: the hourly cap counts
      presses since the later of an hour ago and this. */
  pausedAt: string | null;
  /** There is a connection row at all. None means disconnected, and what is
      still waiting is cancelled with the disconnect's words. */
  linked: boolean;
  /** The grant works (not needs_reauth). */
  connected: boolean;
  /** The ServiceM8 account connected now — what every write is checked
      against before it goes. */
  tenantId: string | null;
  /** The kinds whose scopes the grant holds. */
  granted: readonly Sm8WriteKind[];
  /** The kinds ServiceM8 refused for scope since the last connect. */
  refused: readonly Sm8WriteKind[];
  /** The ServiceM8 account's time zone, for when its daily limit resets. */
  timezoneName: string | null;
};

/** Whether `kind` can go now, as far as the switches and the grant go. A
    trial run sends nothing, so it needs no permission. */
export function kindReady(s: Sm8WriteState, kind: Sm8WriteKind): boolean {
  if (!s.kinds.includes(kind)) return false;
  if (s.mode !== "live") return true;
  return s.granted.includes(kind) && !s.refused.includes(kind);
}

const WHERE = "An owner can change that in Integrations, ServiceM8.";

/** Why a press of Send to ServiceM8 can't be taken, in words — or null when
    it can. The order is the order of the fixes: nothing an owner does helps
    a deployment that can't write, a switch that is off outranks a pause, and
    both outrank a permission nobody has been asked for. */
export function sendRefusal(s: Sm8WriteState, kind: Sm8WriteKind = "attachment"): string | null {
  if (!s.kinds.includes(kind)) return "Sending to ServiceM8 isn't available yet.";
  if (!s.readable) return WRITE_WORDS.settingsUnread;
  if (!s.tenantId) return "ServiceM8 isn't connected.";
  if (s.mode === "off") return `Sending to ServiceM8 is switched off. ${WHERE}`;
  if (s.mode === "paused") return WRITE_WORDS.paused;
  if (!s.connected) return `ServiceM8 needs reconnecting. ${WHERE}`;
  if (s.mode === "live" && !kindReady(s, kind)) {
    return `ServiceM8 hasn't given HeyTiff permission to add files yet. ${WHERE}`;
  }
  return null;
}

/** Whether the card offers Send to ServiceM8 at all. Only where an owner
    has switched it on: a button that could only ever explain itself is
    furniture. A switched-on workspace whose grant has lapsed, or whose
    sending is paused, keeps the button, and the press says what's wrong. */
export function offersSend(s: Sm8WriteState, kind: Sm8WriteKind = "attachment"): boolean {
  return s.readable && s.kinds.includes(kind) && !!s.tenantId && s.mode !== "off";
}

/** What is holding a workspace's waiting writes, as the card and the owner's
    list say it: the owner's (or the cap's) pause, or a reconnect ServiceM8
    needs before anything more can go. */
export type SendHold = "paused" | "reconnect" | null;

export function sendHold(s: Sm8WriteState, kind: Sm8WriteKind = "attachment"): SendHold {
  if (s.mode === "paused") return "paused";
  if (s.mode === "live" && (!s.connected || !kindReady(s, kind))) return "reconnect";
  return null;
}

/* ── the row ── */

export type Sm8WriteStatus = "queued" | "sending" | "sent" | "failed" | "trial" | "cancelled";

const STATUSES: readonly Sm8WriteStatus[] = ["queued", "sending", "sent", "failed", "trial", "cancelled"];

export function readWriteStatus(v: unknown): Sm8WriteStatus {
  return STATUSES.includes(v as Sm8WriteStatus) ? (v as Sm8WriteStatus) : "failed";
}

/** The subject a file is written under — the caller's own name for what it
    wrote, unique per job (see the migration). */
export const documentSubject = (documentId: string) => `document:${documentId}`;

export function subjectDocumentId(subject: string): string | null {
  const m = /^document:(.+)$/.exec(subject);
  return m ? m[1] : null;
}

/** ONE ROW PER THING WRITTEN, a job or no job. The generated column
    sm8_writes.dedupe_key is exactly this expression
    (docs/migrations/sm8_writes_safety.sql): a NULL job can't slip past a
    unique index the way it slips past (org, kind, job, subject). */
export const dedupeKey = (kind: string, jobUuid: string | null, subject: string) =>
  `${kind}:${jobUuid ?? ""}:${subject}`;

/* ── how much, how often ── */

/** Writes one run sends. ServiceM8 allows 180 requests a minute; this keeps
    one run well inside it even with a sync walking beside it. */
export const WRITE_BATCH = 10;

/** How long a claimed row is held while its request is in flight. Longer
    than everything a send does under it (see WRITE_SEND_BY_MS), so a live
    send never has its row taken from under it. */
export const WRITE_LEASE_MS = 120_000;

/** THE CLOCKS UNDER ONE CLAIM, each a hard timeout on its own request:
    - the file's bytes, read from storage;
    - the upload (a file of a few MB to a host in Australia, from a function
      in Singapore: generous);
    - a read of one attachment back from ServiceM8 — the check before a
      re-press, and the confirmation after a 409;
    - a margin for the database writes around them. */
export const WRITE_DOWNLOAD_TIMEOUT_MS = 20_000;
export const WRITE_TIMEOUT_MS = 60_000;
export const WRITE_READ_TIMEOUT_MS = 10_000;
export const WRITE_LEASE_MARGIN_MS = 15_000;

/** THE LAST MOMENT INTO A CLAIM AN UPLOAD MAY START, the first or the one
    after a renewed token: its own timeout, a read-back after it and the
    margin all still end inside the lease. A send that reaches this late (a
    slow read of the file, a slow check first) lets go of its row instead,
    untouched, and the next run takes it. 35 s. */
export const WRITE_SEND_BY_MS = WRITE_LEASE_MS - WRITE_TIMEOUT_MS - WRITE_READ_TIMEOUT_MS - WRITE_LEASE_MARGIN_MS;

/** A run nobody is waiting on: behind a press's answer, or a retry. It stops
    CLAIMING at this; a send already claimed finishes inside its lease. */
export const RUN_BUDGET_MS = 90_000;

/** How long a function may run on this deployment when its route sets no
    maxDuration: Vercel's default with Fluid compute, which the cron's own
    maxDuration of 300 relies on too. A run in after() lives inside it
    ("after will run for the platform's default or configured max duration
    of your route" — Next's after() docs), and a function cut off
    mid-upload leaves its row to lapse. */
export const FUNCTION_MAX_MS = 300_000;

/** A background run's budget: RUN_BUDGET_MS, or less when the function it
    runs in has less left — its last claim must still end, a whole lease and
    a margin later, before the function does. The cron's deadline, for every
    run nobody waits on. Zero or less: there is no time for one, and what is
    waiting goes on the next kick. `startedAt` is when the function's request
    began (as near as the caller knows it). */
export function backgroundBudgetMs(startedAt: number, now: number, maxMs: number = FUNCTION_MAX_MS): number {
  return Math.min(RUN_BUDGET_MS, startedAt + maxMs - WRITE_LEASE_MS - WRITE_LEASE_MARGIN_MS - now);
}

/** Pressed writes one ServiceM8 account may take in an hour, across every
    workspace. More trips Pause: a loop, or a person, sending more than this
    is worth stopping and saying so. A trial run sends nothing and isn't
    counted. */
export const WRITE_HOURLY_CAP = 60;

/** Whether `adding` more writes fit in the hour, `count` being those
    already pressed in it. */
export function capAllows(count: number, adding: number): boolean {
  return count + adding <= WRITE_HOURLY_CAP;
}

/** Goes a row gets that it didn't pay for: a dead record given a fresh uuid,
    or a send that let go of its row for want of time. Past this the row
    stops with a sentence, so a file ServiceM8 always leaves unfinished
    can't make a new dead record in somebody's ServiceM8 on every run. */
export const WRITE_FREE_RETRIES = 2;

/** How long after each failed attempt a row waits before the next. The first
    retry is quick (a blip), the last is half a day (an outage). */
export const WRITE_RETRY_AFTER_MS: readonly number[] = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  12 * 3_600_000,
];

/** Attempts before a row stops trying by itself and waits for a person. */
export const WRITE_MAX_ATTEMPTS = WRITE_RETRY_AFTER_MS.length + 1;

/** Waits for a reason that isn't the row's (a busy or unpaid account). */
const RATE_LIMIT_WAIT_MS = 60_000;
const HOUR_MS = 3_600_000;
const BILLING_WAIT_MS = 12 * 3_600_000;
/** After a token renewal that couldn't reach ServiceM8. */
const RENEW_WAIT_MS = 60_000;
/** A daily limit's reset is guessed, then tried a few minutes after. */
const RESET_GRACE_MS = 5 * 60_000;

/* ── the sentences ── */

export const WRITE_WORDS = {
  reauth: "ServiceM8 needs reconnecting before anything more can go.",
  /** ServiceM8 refused for want of a scope: this kind waits for a reconnect. */
  scopeHeld: "ServiceM8 hasn't given HeyTiff permission to add files. It goes once ServiceM8 is reconnected.",
  /** A 403 that doesn't name a scope: this file, not the grant. */
  forbidden: "ServiceM8 didn't allow HeyTiff to add this file.",
  billing: "ServiceM8 says this account isn't in good standing. Nothing more goes until its ServiceM8 bill is paid.",
  slowDown: "ServiceM8 asked HeyTiff to slow down. Trying again in a minute.",
  dailyLimit: "ServiceM8's daily limit for HeyTiff is used up. Trying again after it resets.",
  /** HeyTiff's own counter had no room for the call (sm8-meter): nothing
      went, and nothing about the file was wrong. */
  paced: "Waiting for room in ServiceM8's call limit. Trying again in a minute.",
  paused: "Sending to ServiceM8 is paused. An owner can change that in Integrations, ServiceM8.",
  settingsUnread: "HeyTiff couldn't read the ServiceM8 settings. Nothing was sent or cancelled.",
  deadRecordGaveUp: "ServiceM8 left the file unfinished, after several tries.",
  tooSlowGaveUp: "HeyTiff took too long to get the file ready, after several tries.",
  unreachable: "ServiceM8 couldn't be reached. Trying again shortly.",
  gaveUp: "ServiceM8 couldn't be reached, after several tries.",
  noJob: "ServiceM8 couldn't find the job.",
  tooBig: "ServiceM8 said the file is too big.",
  refused: "ServiceM8 refused the file.",
  notThere: "ServiceM8 said it already had this, then couldn't show it.",
  fileGone: "The file isn't in HeyTiff any more.",
  unreadable: "HeyTiff couldn't read the file. Trying again shortly.",
  unreadableGaveUp: "HeyTiff couldn't read the file, after several tries.",
  otherAccount: "This was for a different ServiceM8 account from the one connected now.",
  accountUnknown: "HeyTiff couldn't confirm which ServiceM8 account is connected. Trying again shortly.",
  switchedOff: "Sending to ServiceM8 was switched off before it went.",
  disconnected: "ServiceM8 was disconnected before it went.",
} as const;

/* ── what came back ── */

/** What ServiceM8 said, kept short: its errorCode and message from a JSON
    body, or a plain-text body as the message. For whoever diagnoses the row
    (sm8_writes.remote_code / remote_message) and for telling one 403 or 429
    from another. NEVER SHOWN on a screen. */
export type RemoteError = { code: string | null; message: string | null };

export const REMOTE_MESSAGE_MAX = 300;
const REMOTE_CODE_MAX = 20;

const NO_REMOTE: RemoteError = { code: null, message: null };

const squeeze = (v: string): string | null => {
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, REMOTE_MESSAGE_MAX) : null;
};

export function readRemoteError(text: string | null | undefined, contentType: string | null | undefined): RemoteError {
  const body = (text ?? "").trim();
  if (!body) return NO_REMOTE;
  /* an HTML error page is a proxy's or a load balancer's, never ServiceM8's
     own words, and not worth keeping */
  if (/html/i.test(contentType ?? "") || body.startsWith("<")) return NO_REMOTE;
  if (/json/i.test(contentType ?? "") || body.startsWith("{")) {
    try {
      const j: unknown = JSON.parse(body);
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const o = j as Record<string, unknown>;
        const raw = o.errorCode;
        const code =
          typeof raw === "string" || typeof raw === "number" ? String(raw).trim().slice(0, REMOTE_CODE_MAX) || null : null;
        const message = typeof o.message === "string" ? squeeze(o.message) : null;
        return { code, message };
      }
    } catch {
      /* not JSON after all: keep it as text */
    }
  }
  return { code: null, message: squeeze(body) };
}

/** A 403 that names a missing scope — the wording ServiceM8 was seen to use
    on a read ("insufficient_scope: … scope required"). Their write docs show
    only a generic 403, so a scope refusal in other words reads as a refusal
    of the one file. */
const SCOPE_REFUSAL = /insufficient_scope|scope required/i;

/** ServiceM8's daily limit, by its words: "Number of allowed API requests per
    day exceeded". Anything else a 429 says is the per-minute limit. Exported
    so every reader of a 429 tells the two apart the same way. */
export const SM8_PER_DAY = /per day/i;

/** Which limit stopped a write: ServiceM8's per-minute or daily limit (a
    429), or `ours` — HeyTiff's own counter for the account (sm8-meter)
    refused the turn, and no request was made. */
export type Sm8RateLimit = "minute" | "day" | "ours";

/** One request's answer, as the decision it forces. The sentences come
    later, from `verdictFor`: the same 403 means one thing to a row and
    another to the run. */
export type Sm8WriteOutcome =
  | { kind: "created"; remoteUuid: string | null }
  /** 409 on our own uuid: an earlier attempt landed. Confirmed by a read
      before it counts, because a conflict that ISN'T ours must not be
      recorded as sent. */
  | { kind: "exists" }
  | { kind: "unauthorized" }
  /** `scope`: ServiceM8 named a missing permission, so every write of this
      kind would be refused the same way until a reconnect. */
  | { kind: "forbidden"; scope: boolean }
  | { kind: "payment_required" }
  /** `waitMs`: how long the counter said to wait, for `ours`. */
  | { kind: "rate_limited"; limit: Sm8RateLimit; waitMs?: number }
  /** The 409's record is ours, on this job, and INACTIVE: an earlier upload
      failed half way, which ServiceM8's guide says leaves the record
      "inactive and pending upload". That uuid is spent; the file goes again
      under a new one. */
  | { kind: "dead_record" }
  /** This request will never succeed as it is. */
  | { kind: "rejected"; status: number }
  /** Didn't answer, or answered with its own trouble. */
  | { kind: "unavailable"; status: number | null };

export function classifyWrite(
  status: number,
  recordUuid: string | null,
  remote: RemoteError | null = null
): Sm8WriteOutcome {
  if (status >= 200 && status < 300) return { kind: "created", remoteUuid: recordUuid };
  if (status === 409) return { kind: "exists" };
  if (status === 401) return { kind: "unauthorized" };
  if (status === 402) return { kind: "payment_required" };
  if (status === 403) return { kind: "forbidden", scope: SCOPE_REFUSAL.test(remote?.message ?? "") };
  if (status === 429) return { kind: "rate_limited", limit: SM8_PER_DAY.test(remote?.message ?? "") ? "day" : "minute" };
  // a request that timed out on their side can be asked again
  if (status === 408) return { kind: "unavailable", status };
  if (status >= 400 && status < 500) return { kind: "rejected", status };
  return { kind: "unavailable", status };
}

/** When ServiceM8's daily limit is next worth trying: the earlier of the
    next UTC midnight and the next midnight in the account's zone, plus a few
    minutes. Which one ServiceM8 resets on is UNCONFIRMED, so trying at both
    costs at most two requests a day. An unknown zone is UTC's alone. */
export function nextDailyReset(now: number, timezoneName: string | null | undefined): number {
  const DAY = 86_400_000;
  const utc = Math.floor(now / DAY) * DAY + DAY;
  const local = timezoneName ? nextLocalMidnight(now, timezoneName) : null;
  return Math.min(utc, local ?? utc) + RESET_GRACE_MS;
}

/** The zone's offset from UTC at `t`, in ms — null for a zone Intl doesn't know. */
function zoneOffset(t: number, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(t));
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    return wall - Math.floor(t / 1000) * 1000;
  } catch {
    return null;
  }
}

function nextLocalMidnight(now: number, tz: string): number | null {
  const DAY = 86_400_000;
  const offset = zoneOffset(now, tz);
  if (offset === null) return null;
  const wall = now + offset;
  const next = Math.floor(wall / DAY) * DAY + DAY - offset;
  /* across a daylight-saving change the offset at midnight isn't today's */
  const then = zoneOffset(next, tz);
  return then === null ? next : next + offset - then;
}

export type WriteVerdict = {
  status: "sent" | "queued" | "failed";
  error: string | null;
  /** When a queued row may go again, counted from now. */
  retryAfterMs: number | null;
  /** The attempt wasn't the row's doing, so it doesn't count towards
      giving up: a dead grant or a busy account says nothing about the file. */
  refund: boolean;
  /** End the run here. The next row would get the same answer, and asking
      again would spend somebody's rate limit to be told twice. */
  stop: boolean;
  /** ServiceM8 refused the token. The sender renews it once and tries again
      (sm8-renew.ts); only a second refusal flags the connection for
      reconnecting, the way a 401 on a read does. */
  reauth: boolean;
  /** ServiceM8 refused this KIND for scope: it is marked refused on the
      connection, and no row of it goes until a reconnect. */
  blockKind: boolean;
  /** Hold every queued row this long — the account's trouble, not a row's. */
  holdAllMs: number | null;
  /** The row's uuid is spent (a dead record): it goes again under a new one,
      and the old one is remembered. */
  freshUuid: boolean;
  /** A go the row didn't pay for, counted against WRITE_FREE_RETRIES. */
  freeRetry: boolean;
};

const verdict = (v: Partial<WriteVerdict> & Pick<WriteVerdict, "status">): WriteVerdict => ({
  error: null,
  retryAfterMs: null,
  refund: false,
  stop: false,
  reauth: false,
  blockKind: false,
  holdAllMs: null,
  freshUuid: false,
  freeRetry: false,
  ...v,
});

/** What a verdict needs to know besides the answer: the time (for a daily
    limit's reset), the account's zone, and how many free goes the row has
    had. */
export type VerdictContext = { now: number; timezoneName: string | null; freeRetries: number };

/** The wait before the next try, after `attempts` tries. */
const retryAfter = (attempts: number): number =>
  WRITE_RETRY_AFTER_MS[Math.min(Math.max(0, attempts - 1), WRITE_RETRY_AFTER_MS.length - 1)];

/** What a row becomes when the file couldn't be read HERE — the bucket, not
    ServiceM8. Ours to retry, with the same patience, and the run goes on:
    the next row's file may read fine. */
export function verdictForUnreadable(attempts: number): WriteVerdict {
  if (attempts >= WRITE_MAX_ATTEMPTS) return verdict({ status: "failed", error: WRITE_WORDS.unreadableGaveUp });
  return verdict({ status: "queued", error: WRITE_WORDS.unreadable, retryAfterMs: retryAfter(attempts) });
}

/** A refused send whose token couldn't be renewed because ServiceM8 couldn't
    be reached. Not the file's doing and not a dead grant: it waits a minute,
    the attempt is handed back, and the run stops, because the next row would
    need the same renewal. */
export function verdictForRenewUnreachable(): WriteVerdict {
  return verdict({
    status: "queued",
    error: WRITE_WORDS.unreachable,
    retryAfterMs: RENEW_WAIT_MS,
    refund: true,
    stop: true,
  });
}

/** A token whose connection doesn't say which ServiceM8 account it is for —
    a nameless reconnect landed mid-run. The account is unknown, not known to
    be wrong, so the file isn't cancelled: it waits, its attempt handed back,
    until a sync has named the connection. The run stops, because every
    later row would go out on the same token. */
export function verdictForAccountUnknown(): WriteVerdict {
  return verdict({
    status: "queued",
    error: WRITE_WORDS.accountUnknown,
    retryAfterMs: RENEW_WAIT_MS,
    refund: true,
    stop: true,
  });
}

/** A send that found the connection gone mid-run. It waits in the queue; the
    next run, finding no connection, cancels it with these words. */
export function verdictForDisconnected(): WriteVerdict {
  return verdict({ status: "queued", error: WRITE_WORDS.disconnected, refund: true, stop: true });
}

/** A send refused with a token that has since been renewed, too late in its
    claim to try again (WRITE_SEND_BY_MS). Nothing went wrong with the file
    or the grant: it goes back to the queue as it was, due at once, and the
    run carries on with the renewed token. */
export function verdictForRenewLate(): WriteVerdict {
  return verdict({ status: "queued", retryAfterMs: 0, refund: true });
}

/** A send that reached WRITE_SEND_BY_MS before its upload could start — the
    file was slow to read, or the check before it was. It lets go of the row
    untouched and due at once, the attempt handed back; after
    WRITE_FREE_RETRIES of those it stops for a person. */
export function verdictForLetGo(freeRetries: number): WriteVerdict {
  if (freeRetries >= WRITE_FREE_RETRIES) return verdict({ status: "failed", error: WRITE_WORDS.tooSlowGaveUp });
  return verdict({ status: "queued", retryAfterMs: 0, refund: true, freeRetry: true });
}

/** What a row becomes after one attempt. `attempts` counts this one. */
export function verdictFor(
  outcome: Sm8WriteOutcome,
  attempts: number,
  ctx: VerdictContext = { now: Date.now(), timezoneName: null, freeRetries: 0 }
): WriteVerdict {
  switch (outcome.kind) {
    case "created":
    case "exists":
      return verdict({ status: "sent" });
    case "unauthorized":
      /* waits for a reconnect, then goes: nothing about the file was wrong */
      return verdict({ status: "queued", error: WRITE_WORDS.reauth, refund: true, stop: true, reauth: true });
    case "payment_required":
      /* the account, not the file: everything waiting waits with it */
      return verdict({
        status: "queued",
        error: WRITE_WORDS.billing,
        retryAfterMs: BILLING_WAIT_MS,
        holdAllMs: BILLING_WAIT_MS,
        refund: true,
        stop: true,
      });
    case "rate_limited": {
      if (outcome.limit === "ours") {
        /* HeyTiff's own counter: nothing reached ServiceM8. Its wait is the
           counter's, at least a minute; past an hour it is a daily limit
           (the counter's day cap, or ServiceM8's daily 429 it recorded), and
           says so. Everything queued waits with it — the counter is the
           account's, so the next row would be refused the same way. */
        const wait = Math.max(RATE_LIMIT_WAIT_MS, outcome.waitMs ?? 0);
        return verdict({
          status: "queued",
          error: wait > HOUR_MS ? WRITE_WORDS.dailyLimit : WRITE_WORDS.paced,
          retryAfterMs: wait,
          holdAllMs: wait,
          refund: true,
          stop: true,
        });
      }
      if (outcome.limit === "day") {
        const wait = Math.max(RATE_LIMIT_WAIT_MS, nextDailyReset(ctx.now, ctx.timezoneName) - ctx.now);
        return verdict({
          status: "queued",
          error: WRITE_WORDS.dailyLimit,
          retryAfterMs: wait,
          holdAllMs: wait,
          refund: true,
          stop: true,
        });
      }
      return verdict({
        status: "queued",
        error: WRITE_WORDS.slowDown,
        retryAfterMs: RATE_LIMIT_WAIT_MS,
        holdAllMs: RATE_LIMIT_WAIT_MS,
        refund: true,
        stop: true,
      });
    }
    case "forbidden":
      /* A 403 that names a missing scope is the grant's: the file waits, its
         attempt handed back, and so does every file of its kind until a
         reconnect gives the permission. Any other 403 is about THIS file (a
         job the grant can't touch, say) and stops only its row; the run
         ends at the second in a row (sm8-writes). */
      if (outcome.scope) {
        return verdict({ status: "queued", error: WRITE_WORDS.scopeHeld, refund: true, stop: true, blockKind: true });
      }
      return verdict({ status: "failed", error: WRITE_WORDS.forbidden });
    case "dead_record":
      /* the uuid is spent; the file goes again at once under a new one */
      if (ctx.freeRetries >= WRITE_FREE_RETRIES) {
        return verdict({ status: "failed", error: WRITE_WORDS.deadRecordGaveUp });
      }
      return verdict({ status: "queued", retryAfterMs: 0, refund: true, freshUuid: true, freeRetry: true });
    case "rejected":
      return verdict({
        status: "failed",
        error:
          outcome.status === 404
            ? WRITE_WORDS.noJob
            : outcome.status === 413
              ? WRITE_WORDS.tooBig
              : outcome.status === 409
                ? WRITE_WORDS.notThere
                : WRITE_WORDS.refused,
      });
    case "unavailable":
      if (attempts >= WRITE_MAX_ATTEMPTS) return verdict({ status: "failed", error: WRITE_WORDS.gaveUp, stop: true });
      return verdict({
        status: "queued",
        error: WRITE_WORDS.unreachable,
        retryAfterMs: retryAfter(attempts),
        stop: true,
      });
  }
}

/* ── a file asked for again ── */

/** The most uuids a row keeps waiting for their check. Each upload clears
    the list first (sendOne checks every one before it goes), so a row
    reaches two only when a sender dies mid-check; three is room to spare. */
export const VERIFY_KEEP = 3;

/** The uuids to check before a re-pressed row goes under its new one.

    EVERY UUID STILL WAITING FOR ITS CHECK KEEPS ITS PLACE: none is replaced
    by a newer one before it has been read back. The uuid the row is leaving
    joins them only when an upload under it went out and got no answer that
    can be trusted (`maybe_landed`, set by the sender: no answer at all, a
    408, ServiceM8's own 5xx, a 409 whose record couldn't be confirmed, or a
    sender that died mid-upload) — that upload may have landed, and a fresh
    uuid would make a second copy.

    It is WHAT HAPPENED, never guessed from a status: a trial run, a check
    that couldn't be read and a cancel before the upload uploaded nothing,
    so they add no uuid and take none away. The check is one read per uuid
    before the upload (sm8-writes' sendOne). */
export function verifyOnRepress(row: {
  remote_uuid: string;
  maybe_landed: boolean | null;
  verify_uuids: readonly string[] | null;
}): string[] {
  const keep = [...(row.verify_uuids ?? [])];
  if (row.maybe_landed && !keep.includes(row.remote_uuid)) keep.push(row.remote_uuid);
  return keep.slice(-VERIFY_KEEP);
}

/* ── the name it goes under ── */

/** ServiceM8 caps nothing we know of, but a name is read in a list. */
const NAME_MAX = 120;

/** The name a file goes to ServiceM8 under: the name it has here, extension
    on, the way ServiceM8's own uploads are named (689 of the 760 uploaded
    PDFs on the live account carry theirs). ServiceM8 reads the file's type
    off that extension, which is why it must be there. */
export function sm8FileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "Document";
  if (clean.length <= NAME_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : "";
  return `${clean.slice(0, NAME_MAX - ext.length).trimEnd()}${ext}`;
}

/* ── what the job card says ── */

/** One file's write, as the card holds it. */
export type JobSend = {
  documentId: string;
  status: Sm8WriteStatus;
  error: string | null;
  attempts: number;
  remoteUuid: string;
};

export type SendLine = { word: string; tone: "ok" | "warn" | "bad" | null };

/** What one of OUR rows says about ServiceM8, over the files it holds — a
    certificate is one file, a licence may be a front and a back. Null when
    there is nothing to say: never sent, a trial run, or cancelled, all of
    which leave the file as sendable as it was.

    A failure outranks everything: it is the one line somebody has to act on.
    A retry pending is said in the warning colour, because a file that went
    nowhere for an hour is worth noticing; a first send in flight isn't. "In
    ServiceM8" only when EVERY file the row holds went, so a paper whose
    renewal came in since says nothing until the renewal is sent too.

    `hold` is what is holding the workspace's waiting writes: a file waiting
    behind a pause, or a reconnect, says that rather than "shortly". A file
    the sender put back with a reason — an unpaid ServiceM8 bill, a daily
    limit, a ServiceM8 that couldn't be reached — says that reason, in the
    warning colour: it may wait hours, and "Sending…" would say it is on its
    way. */
export function sendLine(
  sends: readonly JobSend[],
  documentIds: readonly string[],
  hold: SendHold = null
): SendLine | null {
  if (documentIds.length === 0) return null;
  const mine = documentIds
    .map((id) => sends.find((s) => s.documentId === id))
    .filter((s): s is JobSend => !!s);
  if (mine.length === 0) return null;

  const failed = mine.find((s) => s.status === "failed");
  if (failed) return { word: `Not sent to ServiceM8. ${failed.error ?? WRITE_WORDS.refused}`, tone: "bad" };

  const waiting = mine.filter((s) => s.status === "queued" || s.status === "sending");
  if (waiting.length > 0 && hold !== null && waiting.some((s) => s.status === "queued")) {
    return hold === "paused"
      ? { word: "Not in ServiceM8 yet. Sending is paused.", tone: null }
      : { word: "Not in ServiceM8 yet. ServiceM8 needs reconnecting.", tone: "warn" };
  }
  const held = waiting.find((s) => s.status === "queued" && s.error);
  if (held) return { word: `Not in ServiceM8 yet. ${held.error}`, tone: "warn" };
  if (waiting.length > 0) {
    const retrying = waiting.some((s) => s.status === "queued" && s.attempts > 0);
    return retrying
      ? { word: "Not in ServiceM8 yet. Trying again shortly.", tone: "warn" }
      : { word: "Sending to ServiceM8…", tone: null };
  }

  if (mine.length === documentIds.length && mine.every((s) => s.status === "sent")) {
    return { word: "In ServiceM8", tone: "ok" };
  }
  return null;
}

/** Whether a file may be sent again: never sent, or sent and it came to
    nothing. A file in ServiceM8, or on its way, is not sent twice. */
export function sendable(send: JobSend | undefined): boolean {
  return !send || send.status === "failed" || send.status === "cancelled" || send.status === "trial";
}

/* THE TWIN — a file we sent, mirrored back by the next sync as one of
   ServiceM8's own — is left off on the server, by its uuid, everywhere a
   ServiceM8 file is read (sm8-echo.ts). A file sent is one row whether or
   not our own row still shows it. */

/* ── what the owner's log says ── */

/** One write in the ServiceM8 screen's list, in the state colour. A write
    waiting behind a pause or a reconnect says which (`hold`). */
export function logWord(status: Sm8WriteStatus, attempts: number, hold: SendHold = null): SendLine {
  if (status === "queued" && hold === "paused") return { word: "Held while paused", tone: null };
  if (status === "queued" && hold === "reconnect") return { word: "Waiting for a reconnect", tone: "warn" };
  switch (status) {
    case "sent":
      return { word: "Sent", tone: "ok" };
    case "trial":
      return { word: "Trial run, not sent", tone: null };
    case "failed":
      return { word: "Not sent", tone: "bad" };
    case "cancelled":
      return { word: "Cancelled", tone: null };
    case "sending":
      return { word: "Sending", tone: null };
    case "queued":
      return attempts > 0 ? { word: "Trying again", tone: "warn" } : { word: "Waiting to send", tone: null };
  }
}

/* ── what a press of Send to ServiceM8 says ── */

/** Two names, or a count once a list stops being read. */
function named(names: readonly string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} documents`;
}

const isAre = (names: readonly string[]) => (names.length === 1 ? "is" : "are");

export type SendOutcome = {
  trial: boolean;
  sent: readonly string[];
  waiting: readonly string[];
  already: readonly string[];
};

/** The card's toast after a press, by what became of each tick. Null when
    there is nothing to report but failures, which the footer says instead.
    Success is noun and verb ("Public liability sent to ServiceM8"); a trial
    run says plainly that nothing went. */
export function sendToast(r: SendOutcome, nameOf: (key: string) => string): string | null {
  const sent = r.sent.map(nameOf);
  const waiting = r.waiting.map(nameOf);
  const already = r.already.map(nameOf);
  if (r.trial && sent.length > 0) return `Trial run: ${named(sent)} would have gone to ServiceM8. Nothing was sent`;
  const parts: string[] = [];
  if (!r.trial && sent.length > 0) parts.push(`${named(sent)} sent to ServiceM8`);
  if (waiting.length > 0) {
    parts.push(
      sent.length > 0 ? `${named(waiting)} will follow` : `${named(waiting)} will go to ServiceM8 once it answers`
    );
  }
  if (parts.length === 0 && already.length > 0) parts.push(`${named(already)} ${isAre(already)} already in ServiceM8`);
  return parts.length > 0 ? parts.join(". ") : null;
}

/** The footer's line for what didn't go: the first, with its reason, and a
    count of the rest. Their ticks stay, so pressing again tries them again. */
export function sendFailure(
  failed: readonly { key: string; error: string }[],
  nameOf: (key: string) => string
): string | null {
  if (failed.length === 0) return null;
  const rest = failed.length - 1;
  const more = rest === 0 ? "" : rest === 1 ? " 1 more didn't go either." : ` ${rest} more didn't go either.`;
  return `${nameOf(failed[0].key)} wasn't sent. ${failed[0].error}${more}`;
}
