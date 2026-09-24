/* Writing to ServiceM8 — the plumbing that carries sm8-write-plan out.

   sm8-sync.ts's sibling for the other direction. The decisions live in
   sm8-write-plan.ts (pure, tested cold), the requests in sm8-write.ts; this
   file queues, claims, sends and records, and it is the one place that
   does.

   THE RULES THE SHAPE ENFORCES:
   - NOTHING IS WRITTEN WITHOUT THREE YESES. The deployment's (SM8_WRITES,
     the operator's switch, off on a preview so a branch can never write to
     a business's ServiceM8), the owner's (write_mode, off until they choose
     otherwise), and the account's (the write was queued for the ServiceM8
     account connected NOW). All three are read again before every run and
     never remembered from when the write was queued.
   - ONE SENDER PER ROW, across instances. A press, the page-load kick and
     the nightly cron can all be running at once, each on its own serverless
     worker. Each claims a row with a conditional write before it sends it,
     and a claim that matches nothing means somebody else has the row. The
     uuid chosen at queue time is the second line: two sends of one row name
     one record, so ServiceM8 can't end up with the file twice.
   - A RUN IS BOUNDED: WRITE_BATCH rows, and a time budget when a person is
     waiting on it. Whatever doesn't fit waits for the next kick.
   - A FAILURE STOPS WHAT IT SHOULD. A dead grant, a busy or unpaid account
     and an unreachable ServiceM8 end the run, because the next row would be
     told the same thing; a refused file stops only its own row.
   - ONLY A PERSON QUEUES. A write enters the queue only with a press
     (sm8-press.ts) minted from the session of whoever asked for it, and no
     more than WRITE_HOURLY_CAP an hour go to one ServiceM8 account: past
     that, sending pauses and the owner is told. Senders only ever SEND what
     a press queued.
   - DOUBT HOLDS, IT NEVER CANCELS. Settings that can't be read, or a stored
     setting that isn't one, hold everything; only an owner's own Off, or a
     connection that is gone, cancels what is waiting.
   - A FINISH NEEDS ITS CLAIM. A sender records what came back only while it
     still holds the row (claim_id), so a slow sender whose row was taken
     over can't write over the answer the other one recorded.

   - EVERY PRESS DRAINS. A press action (Send, Retry failed files, Sync
     now, switching sending on) ends with drainSm8WritesAfterResponse
     (sm8-drain.ts), which sends whatever is due behind the answer, and so
     must every press action written after these: without it a file that
     met a busy ServiceM8 waits for the next page load. Opening Home, the
     Workboard or the ServiceM8 screen does the same (sm8-freshness.ts).
   - EVERY REQUEST COUNTS. The upload, the read-back after a 409 and the
     check before a re-press all go through sm8-http on lane `write`, and a
     turn the account's counter refuses hands the attempt back (`ours`).

   Sending needs no session: the caller establishes the right to ask (the
   card's action, an owner's action, CRON_SECRET, or a page loader that
   already gated the org) and hands in a bare orgId. Queueing needs a press. */

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { isSm8Press, type Sm8Press } from "./sm8-press";
import { sm8AccessResult, type Sm8Access } from "./sm8-store";
import { withSm8Renewal } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import { cancelWaitingSm8Writes, countWaitingSm8Writes, type CancelledWrite } from "./sm8-write-cancel";
import { postSm8Attachment, readSm8Attachment } from "./sm8-write";
import {
  capAllows,
  dedupeKey,
  documentSubject,
  grantedKinds,
  kindReady,
  readPausedReason,
  readWriteMode,
  readWriteStatus,
  refusedKinds,
  sm8FileName,
  sm8WriteKindsFrom,
  subjectDocumentId,
  verdictFor,
  verdictForAccountUnknown,
  verdictForDisconnected,
  verdictForLetGo,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForUnreadable,
  verifyOnRepress,
  WRITE_BATCH,
  WRITE_DOWNLOAD_TIMEOUT_MS,
  WRITE_HOURLY_CAP,
  WRITE_LEASE_MS,
  WRITE_SEND_BY_MS,
  WRITE_WORDS,
  type JobSend,
  type RemoteError,
  type Sm8WriteKind,
  type Sm8WriteMode,
  type Sm8WriteOutcome,
  type Sm8WriteState,
  type Sm8WriteStatus,
  type VerdictContext,
  type WriteVerdict,
} from "./sm8-write-plan";

const TABLE = "sm8_writes";
const CONNECTIONS = "integration_connections";
const PROVIDER = "servicem8";
const HOUR = 3_600_000;

type DbError = { code?: string; message?: string } | null;

/** A column this database doesn't have yet — its migration runs before the
    deploy, but a write that can do without it shouldn't fail for it. */
const missingColumn = (e: DbError) => e?.code === "PGRST204" || e?.code === "42703";

/* ── the switches ── */

/** The kinds this deployment may write: the operator's switch, SM8_WRITES
    ("1" is files; or a comma list). Nothing when unset, so a preview or a
    branch never writes to a business's ServiceM8. */
export function sm8WriteKindsEnabled(): Sm8WriteKind[] {
  return sm8WriteKindsFrom(process.env.SM8_WRITES);
}

/** Whether this deployment writes anything at all. */
export function sm8WritesEnabled(): boolean {
  return sm8WriteKindsEnabled().length > 0;
}

type ConnectionRead = {
  status: string;
  tenant_id: string | null;
  tenants: unknown;
  scopes: string | null;
  write_mode: string | null;
  paused_reason: string | null;
  paused_at: string | null;
  write_scope_refused: unknown;
  connected_at: string | null;
};

/** The account's zone, from the connection's one tenant. */
function timezoneOf(tenants: unknown): string | null {
  const first = Array.isArray(tenants) ? (tenants[0] as Record<string, unknown> | undefined) : undefined;
  const tz = first && typeof first === "object" ? first.timezoneName : null;
  return typeof tz === "string" && tz.trim() ? tz.trim() : null;
}

/** Where writing stands for one workspace — read fresh, never cached.

    A READ THAT FAILS IS NOT A SWITCHED-OFF WORKSPACE. It comes back
    `readable: false`, and the sender holds everything and cancels nothing:
    taken as "no connection" (as it once was), a blip would cancel every
    file waiting to go. A database without this migration's columns yet
    reads the same way, and holds. */
export async function readSm8WriteState(orgId: string): Promise<Sm8WriteState> {
  const kinds = sm8WriteKindsEnabled();
  const { data, error } = await supabaseAdmin
    .from(CONNECTIONS)
    .select(
      "status, tenant_id, tenants, scopes, write_mode, paused_reason, paused_at, write_scope_refused, connected_at"
    )
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) {
    console.error(`[sm8] couldn't read the ServiceM8 write settings for org ${orgId}; holding every write:`, error);
    return {
      readable: false,
      kinds,
      deployment: kinds.length > 0,
      mode: "off",
      modeStored: null,
      pausedReason: null,
      pausedAt: null,
      linked: false,
      connected: false,
      tenantId: null,
      granted: [],
      refused: [],
      timezoneName: null,
    };
  }
  const row = data as ConnectionRead | null;
  return {
    readable: true,
    kinds,
    deployment: kinds.length > 0,
    mode: readWriteMode(row?.write_mode),
    modeStored: row && typeof row.write_mode === "string" ? row.write_mode : null,
    pausedReason: readPausedReason(row?.paused_reason),
    pausedAt: row?.paused_at ?? null,
    linked: row !== null,
    connected: row?.status === "connected",
    tenantId: row?.tenant_id ?? null,
    granted: grantedKinds(row?.scopes ?? null),
    refused: refusedKinds(row?.write_scope_refused, row?.connected_at),
    timezoneName: timezoneOf(row?.tenants),
  };
}

export type ModeChange = { ok: true; cancelled: CancelledWrite[] } | { ok: false };

/** The owner's switch. Paused records that the owner paused it, and when;
    every other setting clears the reason and KEEPS the time, because the
    hourly cap counts from it. Off also cancels whatever was still waiting
    to go — an owner who switches writing off has said "nothing more", and a
    file that went anyway an hour later would make the switch a suggestion —
    and says what it cancelled. */
export async function setSm8WriteMode(orgId: string, mode: Sm8WriteMode, now: number = Date.now()): Promise<ModeChange> {
  const iso = new Date(now).toISOString();
  const write = (patch: Record<string, unknown>) =>
    supabaseAdmin
      .from(CONNECTIONS)
      .update({ ...patch, updated_at: iso })
      .eq("org_id", orgId)
      .eq("provider", PROVIDER)
      .select("id");
  let res =
    mode === "paused"
      ? await write({ write_mode: "paused", paused_reason: "owner", paused_at: iso })
      : await write({ write_mode: mode, paused_reason: null });
  /* before the migration, every setting but Paused still switches */
  if (mode !== "paused" && missingColumn(res.error)) res = await write({ write_mode: mode });
  if (res.error || (res.data ?? []).length === 0) return { ok: false };
  const cancelled = mode === "off" ? await cancelWaitingSm8Writes(orgId, WRITE_WORDS.switchedOff, now) : [];
  return { ok: true, cancelled };
}

/* Cancelling what is waiting lives in sm8-write-cancel.ts, where the
   connection store can reach it too (disconnect, and a change of account).
   Re-exported, so everything that cancelled from here still does. */
export { cancelWaitingSm8Writes };
export type { CancelledWrite };

/** HeyTiff's own pause: more than WRITE_HOURLY_CAP pressed in an hour. Only
    over a workspace that is On — an owner's own Off or Paused stays theirs. */
async function tripSm8Pause(orgId: string, now: number): Promise<boolean> {
  const iso = new Date(now).toISOString();
  const { data, error } = await supabaseAdmin
    .from(CONNECTIONS)
    .update({ write_mode: "paused", paused_reason: "cap", paused_at: iso, updated_at: iso })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .eq("write_mode", "live")
    .select("id");
  if (error) {
    console.error(`[sm8] couldn't pause sending for org ${orgId} at the hourly cap:`, error);
    return false;
  }
  const paused = (data ?? []).length > 0;
  if (paused) console.warn(`[sm8] paused sending for org ${orgId}: more than ${WRITE_HOURLY_CAP} writes pressed in an hour`);
  return paused;
}

/** ServiceM8 refused `kind` for scope. Recorded against the connection, so
    no row of that kind goes until a reconnect (a newer connected_at) clears
    it — see refusedKinds. A read, a merge and a write: with one kind today
    there is nothing for two refusals to race over. */
async function markSm8KindRefused(orgId: string, kind: Sm8WriteKind, now: number): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(CONNECTIONS)
    .select("write_scope_refused")
    .eq("org_id", orgId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error || !data) {
    console.error(`[sm8] couldn't read which kinds ServiceM8 refused for org ${orgId}:`, error);
    return;
  }
  const raw = (data as { write_scope_refused: unknown }).write_scope_refused;
  const was = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const { error: writeError } = await supabaseAdmin
    .from(CONNECTIONS)
    .update({ write_scope_refused: { ...was, [kind]: new Date(now).toISOString() } })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER);
  if (writeError) console.error(`[sm8] couldn't record that ServiceM8 refused ${kind} for org ${orgId}:`, writeError);
}

/** Every queued row waits until at least `iso` — the account's trouble (an
    unpaid bill, a limit), which no row would get past sooner. */
async function holdQueuedUntil(orgId: string, iso: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ next_attempt_at: iso })
    .eq("org_id", orgId)
    .eq("status", "queued")
    .lt("next_attempt_at", iso);
  if (error) console.error(`[sm8] couldn't hold the queue for org ${orgId}:`, error);
}

/* ── queueing ── */

/** One thing to write, of any kind. */
export type Sm8WriteToQueue = {
  kind: Sm8WriteKind;
  jobUuid: string | null;
  /** The caller's own name for the THING written — see the migration. */
  subject: string;
  payload: Record<string, unknown>;
  /** What the caller calls it, handed back in `already`. */
  ref: string;
};

export type Enqueued = {
  /** The rows this press put in the queue. */
  ids: string[];
  /** Refs already in ServiceM8, or on their way there. */
  already: string[];
  /** Nothing was queued: this press would have taken the account past the
      hourly cap, and sending is now paused. */
  capped: boolean;
};

type ExistingRow = {
  id: string;
  dedupe_key: string;
  status: string;
  attempts: number;
  remote_uuid: string;
  replaced_uuids: string[] | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  pressed_at: string | null;
};

const EXISTING_COLUMNS =
  "id, dedupe_key, status, attempts, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, pressed_at";

/** Where the hourly count starts: an hour ago, or the last pause if later —
    so the presses that tripped a pause don't count again once it's lifted. */
const capWindowStart = (now: number, pausedAt: string | null) =>
  Math.max(now - HOUR, pausedAt ? Date.parse(pausedAt) || 0 : 0);

/** Writes pressed for this ServiceM8 account in the window, across every
    workspace (the limit is the account's). A trial run isn't counted. Null
    when it couldn't be counted: a queue that can't count doesn't guess. */
async function pressedSince(tenantId: string, since: number): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .neq("status", "trial")
    .gte("pressed_at", new Date(since).toISOString());
  if (error) {
    console.error(`[sm8] couldn't count this hour's writes for account ${tenantId}:`, error);
    return null;
  }
  return count ?? 0;
}

/** A row asked for again after it failed, was cancelled or went on a trial
    run. IT GOES UNDER A NEW UUID: the old one may be a dead record in
    ServiceM8 (an upload that failed half way), which could never be
    completed. The old one is remembered (replaced_uuids), and when an
    upload under it may have landed unseen it is checked first, beside any
    older uuid still waiting for its check (verify_uuids — verifyOnRepress),
    so an upload that did land isn't made twice. Everything about the last
    try resets; the press is recorded. */
function againPatch(row: ExistingRow, press: Sm8Press, tenantId: string, iso: string): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    status: "queued",
    next_attempt_at: iso,
    lease_until: null,
    claim_id: null,
    remote_uuid: randomUUID(),
    replaced_uuids: [...new Set([...(row.replaced_uuids ?? []), row.remote_uuid])],
    verify_uuids: verifyOnRepress(row),
    /* the new uuid has never been uploaded */
    maybe_landed: false,
    attempts: 0,
    last_error: null,
    http_status: null,
    remote_code: null,
    remote_message: null,
    free_retries: 0,
    source: "press",
    pressed_at: iso,
    requested_by: press.staffId,
    requested_by_user: press.userId,
    updated_at: iso,
  };
}

/** Queue writes for the press that asked for them. Null when the queue
    couldn't be written, or when this isn't a press (logged).

    ONE ROW PER THING (dedupe_key). A thing already sent, or being sent, is
    left as it is and reported back. One that failed, was cancelled or went
    on a trial run is queued again under a new uuid (againPatch). A queued
    one waiting to retry is brought forward, because somebody has just asked
    for it again.

    THE HOURLY CAP, while On: if this press would take the account past
    WRITE_HOURLY_CAP writes in the hour, NOTHING is queued, sending pauses,
    and `capped` says so. */
export async function enqueueSm8Writes(
  press: Sm8Press,
  state: Sm8WriteState,
  writes: readonly Sm8WriteToQueue[],
  now: number = Date.now()
): Promise<Enqueued | null> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused to queue a write that nobody pressed for (no press, or a stale one)");
    return null;
  }
  const orgId = press.orgId;
  if (!state.readable || !state.tenantId) {
    console.error(`[sm8] refused to queue a write for org ${orgId} with no ServiceM8 account to queue it for`);
    return null;
  }
  const tenantId = state.tenantId;
  if (writes.length === 0) return { ids: [], already: [], capped: false };
  const iso = new Date(now).toISOString();

  const byKey = new Map<string, Sm8WriteToQueue>();
  for (const w of writes) {
    const key = dedupeKey(w.kind, w.jobUuid, w.subject);
    if (!byKey.has(key)) byKey.set(key, w);
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(EXISTING_COLUMNS)
    .eq("org_id", orgId)
    .in("dedupe_key", [...byKey.keys()]);
  if (error) {
    console.error(`[sm8] couldn't read the queue for org ${orgId}:`, error);
    return null;
  }
  const existing = new Map(((data ?? []) as ExistingRow[]).map((r) => [r.dedupe_key, r]));

  if (state.mode === "live") {
    const since = capWindowStart(now, state.pausedAt);
    /* what this press adds to the hour: new rows, and rows going again that
       the hour hasn't already counted */
    const adding = [...byKey.keys()].filter((key) => {
      const row = existing.get(key);
      if (!row) return true;
      const status = readWriteStatus(row.status);
      if (status !== "failed" && status !== "cancelled" && status !== "trial") return false;
      const counted = status !== "trial" && !!row.pressed_at && Date.parse(row.pressed_at) >= since;
      return !counted;
    }).length;
    if (adding > 0) {
      const count = await pressedSince(tenantId, since);
      if (count === null) return null;
      if (!capAllows(count, adding)) {
        await tripSm8Pause(orgId, now);
        return { ids: [], already: [], capped: true };
      }
    }
  }

  const ids: string[] = [];
  const already: string[] = [];
  const fresh: FreshRow[] = [];

  for (const [key, w] of byKey) {
    const row = existing.get(key);
    if (!row) {
      fresh.push({
        key,
        ref: w.ref,
        row: {
          org_id: orgId,
          tenant_id: tenantId,
          kind: w.kind,
          sm8_job_uuid: w.jobUuid,
          subject: w.subject,
          payload: w.payload,
          remote_uuid: randomUUID(),
          status: "queued",
          attempts: 0,
          next_attempt_at: iso,
          source: "press",
          pressed_at: iso,
          requested_by: press.staffId,
          requested_by_user: press.userId,
          created_at: iso,
          updated_at: iso,
        },
      });
      continue;
    }

    const status = readWriteStatus(row.status);
    if (status === "sent" || status === "sending") {
      already.push(w.ref);
      continue;
    }
    const patch =
      status === "queued"
        ? {
            tenant_id: tenantId,
            payload: w.payload,
            next_attempt_at: iso,
            requested_by: press.staffId,
            requested_by_user: press.userId,
            updated_at: iso,
          }
        : { ...againPatch(row, press, tenantId, iso), payload: w.payload };
    /* conditional on the status it was read in: a sender that claimed it in
       between owns it now, and this press is answered "on its way". A write
       that FAILED is not that: it queued nothing, and saying "already" would
       tell the office a file is in ServiceM8 that went nowhere. */
    const { data: again, error: againError } = await supabaseAdmin
      .from(TABLE)
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if (againError) {
      console.error(`[sm8] couldn't queue write ${row.id} again for org ${orgId}:`, againError);
      return null;
    }
    if ((again ?? []).length > 0) ids.push(row.id);
    else already.push(w.ref);
  }

  if (fresh.length > 0) {
    const made = await insertFresh(orgId, fresh);
    if (!made) return null;
    ids.push(...made.ids);
    already.push(...made.already);
  }

  return { ids, already, capped: false };
}

type FreshRow = { key: string; ref: string; row: Record<string, unknown> };

/** Postgres's unique_violation. */
const UNIQUE_VIOLATION = "23505";

/** Insert the rows this press is first to ask for; a row a concurrent press
    made first is that press's to send, and comes back in `already`.

    THE RACE THAT RAISES. `on conflict (org_id, dedupe_key) do nothing` skips
    a clash on ITS index only. While the old unique index on (org, kind,
    job, subject) still stands beside it (it goes after this deploy — see
    DEPLOY.md), two presses of one file on one job at the same instant can
    meet there instead: the second waits for the first and then raises
    23505 rather than doing nothing. That is the race it is, not a failure:
    the rows are read back, and what is there is `already`. Anything the
    failed statement didn't get to is tried once more. */
async function insertFresh(
  orgId: string,
  fresh: readonly FreshRow[],
  again = true
): Promise<{ ids: string[]; already: string[] } | null> {
  /* dedupe_key is generated by the database, never sent */
  const { data: made, error: insertError } = await supabaseAdmin
    .from(TABLE)
    .upsert(
      fresh.map((f) => f.row),
      { onConflict: "org_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("id, dedupe_key");
  if (insertError) {
    if (insertError.code !== UNIQUE_VIOLATION || !again) {
      console.error(`[sm8] couldn't queue writes for org ${orgId}:`, insertError);
      return null;
    }
    /* the statement failed whole: nothing of this press's went in */
    const { data: there, error: readError } = await supabaseAdmin
      .from(TABLE)
      .select("dedupe_key")
      .eq("org_id", orgId)
      .in(
        "dedupe_key",
        fresh.map((f) => f.key)
      );
    if (readError) {
      console.error(`[sm8] couldn't read back the writes another press queued for org ${orgId}:`, readError);
      return null;
    }
    const taken = new Set(((there ?? []) as { dedupe_key: string }[]).map((r) => r.dedupe_key));
    const already = fresh.filter((f) => taken.has(f.key)).map((f) => f.ref);
    const left = fresh.filter((f) => !taken.has(f.key));
    if (left.length === 0) return { ids: [], already };
    const rest = await insertFresh(orgId, left, false);
    return rest ? { ids: rest.ids, already: [...already, ...rest.already] } : null;
  }
  const madeIds = new Map(((made ?? []) as { id: string; dedupe_key: string }[]).map((r) => [r.dedupe_key, r.id]));
  const ids: string[] = [];
  const already: string[] = [];
  for (const f of fresh) {
    const id = madeIds.get(f.key);
    /* a row a concurrent press made first is that press's to send */
    if (id) ids.push(id);
    else already.push(f.ref);
  }
  return { ids, already };
}

/** One file to put on one job. */
export type AttachmentToWrite = {
  jobUuid: string;
  documentId: string;
  /** The name it goes under, extension on. */
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** The tick it came from, so the card can tell which of its rows a
      result belongs to. */
  key: string;
};

/** Queue files for their jobs — enqueueSm8Writes for the one kind there is
    today. `already` carries document ids. */
export async function enqueueAttachments(
  press: Sm8Press,
  state: Sm8WriteState,
  files: readonly AttachmentToWrite[],
  now: number = Date.now()
): Promise<Enqueued | null> {
  return enqueueSm8Writes(
    press,
    state,
    files.map((f) => ({
      kind: "attachment",
      jobUuid: f.jobUuid,
      subject: documentSubject(f.documentId),
      payload: {
        documentId: f.documentId,
        name: sm8FileName(f.name),
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        key: f.key,
      },
      ref: f.documentId,
    })),
    now
  );
}

/** Failed writes taken at one go, at most. */
const RETRY_BATCH = 200;

export type Retried = {
  /** Rows queued again. */
  queued: number;
  /** Failed rows still failed afterwards. */
  left: number;
  /** The hour had no room at all: nothing went again. */
  capped: boolean;
  /** Rows were left because the hour's room ran out (rather than the batch). */
  byHour: boolean;
};

/** The owner's Retry failed files: every failed write for the account
    connected now, oldest first, queued again the way a press would (a new
    uuid, the old one checked where it may have landed). It NEVER TRIPS
    PAUSE: it takes what the hour has room for and says how many are left. */
export async function retryFailedSm8Writes(
  press: Sm8Press,
  state: Sm8WriteState,
  now: number = Date.now()
): Promise<Retried | null> {
  if (!isSm8Press(press)) {
    console.error("[sm8] refused a retry that nobody pressed for (no press, or a stale one)");
    return null;
  }
  const orgId = press.orgId;
  if (!state.readable || !state.tenantId) return null;
  const tenantId = state.tenantId;
  const iso = new Date(now).toISOString();

  let room = RETRY_BATCH;
  let byHourRoom = Infinity;
  if (state.mode === "live") {
    const count = await pressedSince(tenantId, capWindowStart(now, state.pausedAt));
    if (count === null) return null;
    byHourRoom = Math.max(0, WRITE_HOURLY_CAP - count);
    room = Math.min(RETRY_BATCH, byHourRoom);
  }

  let queued = 0;
  if (room > 0) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select(EXISTING_COLUMNS)
      .eq("org_id", orgId)
      .eq("tenant_id", tenantId)
      .eq("status", "failed")
      .order("updated_at", { ascending: true })
      .limit(room);
    if (error) {
      console.error(`[sm8] couldn't read the failed writes for org ${orgId}:`, error);
      return null;
    }
    for (const row of (data ?? []) as ExistingRow[]) {
      const { data: again, error: againError } = await supabaseAdmin
        .from(TABLE)
        .update(againPatch(row, press, tenantId, iso))
        .eq("org_id", orgId)
        .eq("id", row.id)
        .eq("status", "failed")
        .select("id");
      /* it stays failed, and is counted in what is left */
      if (againError) console.error(`[sm8] couldn't queue write ${row.id} again for org ${orgId}:`, againError);
      if ((again ?? []).length > 0) queued += 1;
    }
  }

  const { count, error: countError } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("tenant_id", tenantId)
    .eq("status", "failed");
  const left = countError ? 0 : count ?? 0;
  return { queued, left, capped: room === 0, byHour: left > 0 && byHourRoom <= RETRY_BATCH };
}

/* ── sending ── */

export type Sm8WriteTrigger = "send" | "kick" | "cron";

export type Sm8WriteRun = {
  /** Rows this run claimed and finished with. */
  done: number;
  sent: number;
  trial: number;
  failed: number;
  /** Rows finished back in the queue due at once (a dead record under its
      new uuid, a send that let go of its row) — a follow-up run takes them. */
  again: number;
  /** Rows whose claim was taken over before they finished: the other sender
      recorded them, and this one recorded nothing. */
  lost: number;
  /** Why the run ended before the queue did, when it did. */
  stopped: string | null;
};

const NONE: Sm8WriteRun = { done: 0, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: null };

type WriteRow = {
  id: string;
  tenant_id: string;
  kind: string;
  sm8_job_uuid: string | null;
  subject: string;
  payload: unknown;
  remote_uuid: string;
  status: string;
  attempts: number;
  lease_until: string | null;
  replaced_uuids: string[] | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  free_retries: number | null;
};

const ROW_COLUMNS =
  "id, tenant_id, kind, sm8_job_uuid, subject, payload, remote_uuid, status, attempts, lease_until, replaced_uuids, maybe_landed, verify_uuids, free_retries";

/** Rows of the `kinds` ready to go, due now, oldest first: queued ones whose
    wait is over, and sends whose claim lapsed (a worker that died
    mid-request). */
async function dueRows(
  orgId: string,
  now: number,
  kinds: readonly Sm8WriteKind[],
  ids?: readonly string[]
): Promise<WriteRow[]> {
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .in("kind", [...kinds])
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", iso);
  if (ids) q = q.in("id", [...ids]);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(WRITE_BATCH * 3);
  if (error) {
    console.error(`[sm8] couldn't read what is due to go for org ${orgId}:`, error);
    return [];
  }
  return ((data ?? []) as WriteRow[]).filter(
    (r) => r.status === "queued" || (r.lease_until !== null && Date.parse(r.lease_until) < now)
  );
}

/** Take one row for this sender. The update matches only the row as it was
    read — same status, same attempt count, and for a lapsed send an expired
    claim — so of two senders reaching for one row, exactly one gets it. The
    claim's id comes back, and only a finish that still holds it lands.

    A LIVE CLAIM MARKS ITS UUID MAYBE-LANDED BEFORE ANYTHING GOES. The
    finish puts back what is known (see finish); a sender that dies
    mid-upload never finishes, and its row keeps the mark, so a press after
    that checks the uuid before a new one goes. A trial run uploads nothing
    and marks nothing. */
async function claim(orgId: string, row: WriteRow, now: number, live: boolean): Promise<string | null> {
  const iso = new Date(now).toISOString();
  const claimId = randomUUID();
  let q = supabaseAdmin
    .from(TABLE)
    .update({
      status: "sending",
      lease_until: new Date(now + WRITE_LEASE_MS).toISOString(),
      attempts: row.attempts + 1,
      claim_id: claimId,
      ...(live ? { maybe_landed: true } : {}),
      updated_at: iso,
    })
    .eq("org_id", orgId)
    .eq("id", row.id)
    .eq("attempts", row.attempts);
  q = row.status === "sending" ? q.eq("status", "sending").lt("lease_until", iso) : q.eq("status", "queued");
  const { data } = await q.select("id");
  return (data ?? []).length > 0 ? claimId : null;
}

type Finish = {
  status: Sm8WriteStatus;
  error: string | null;
  httpStatus: number | null;
  verdict?: WriteVerdict;
  /** ServiceM8 knows the record by this uuid rather than the one we sent:
      its own choice, or an earlier upload the check before this one found. */
  remoteUuid?: string;
  /** What ServiceM8 said, when it refused — kept, never shown. */
  remote?: RemoteError | null;
  /** The uuids still waiting for their check, when the send read some back
      (those it ruled out are gone). Absent: as they were. */
  verifyUuids?: string[];
  /** An upload under the row's uuid went out and got no answer that can be
      trusted — none, a 408, a 5xx, a 409 it couldn't confirm. It may have
      landed. */
  uploadLost?: boolean;
};

/** Record what a row became — ONLY WHILE THIS SENDER STILL HOLDS IT. A
    sender whose lease lapsed mid-request may find the row taken over (a
    second sender claimed it, or a disconnect cancelled it); what it has to
    say is then not the row's any more, and nothing is written. True when the
    finish landed. */
async function finish(orgId: string, row: WriteRow, claimId: string, f: Finish, now: number): Promise<boolean> {
  const iso = new Date(now).toISOString();
  const replaced = row.replaced_uuids ?? [];
  const patch: Record<string, unknown> = {
    status: f.status,
    last_error: f.error,
    http_status: f.httpStatus,
    lease_until: null,
    claim_id: null,
    remote_code: f.remote?.code ?? null,
    remote_message: f.remote?.message ?? null,
    updated_at: iso,
  };
  /* the claim counted this attempt; one that wasn't the row's doing is
     handed back */
  if (f.verdict?.refund) patch.attempts = row.attempts;
  if (f.status === "queued") patch.next_attempt_at = new Date(now + (f.verdict?.retryAfterMs ?? 0)).toISOString();
  if (f.verifyUuids) patch.verify_uuids = f.verifyUuids;
  if (f.status === "sent") {
    patch.sent_at = iso;
    patch.verify_uuids = [];
  }
  /* What is known about the row's uuid, over the claim's mark: it stays
     marked once any upload under it was lost, until it is sent or spent. */
  const spent = f.status === "sent" || f.verdict?.freshUuid === true;
  patch.maybe_landed = spent ? false : row.maybe_landed === true || f.uploadLost === true;
  if (f.remoteUuid) {
    patch.remote_uuid = f.remoteUuid;
    /* an earlier uuid found in ServiceM8 is the record now, not a spent one */
    if (replaced.includes(f.remoteUuid)) patch.replaced_uuids = replaced.filter((u) => u !== f.remoteUuid);
  }
  if (f.verdict?.freshUuid) {
    patch.remote_uuid = randomUUID();
    patch.replaced_uuids = [...new Set([...replaced, row.remote_uuid])];
  }
  if (f.verdict?.freeRetry) patch.free_retries = (row.free_retries ?? 0) + 1;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", row.id)
    .eq("status", "sending")
    .eq("claim_id", claimId)
    .select("id");
  const landed = !error && (data ?? []).length > 0;
  if (!landed) console.error(`[sm8] write ${row.id} lost its claim before it finished (${f.status})`);
  return landed;
}

type AttachmentPayload = { documentId: string; name: string; mimeType: string };

function readPayload(row: WriteRow): AttachmentPayload | null {
  const p = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
  const documentId = typeof p.documentId === "string" ? p.documentId : subjectDocumentId(row.subject);
  const name = typeof p.name === "string" && p.name.trim() ? p.name : null;
  if (!documentId || !name) return null;
  return { documentId, name, mimeType: typeof p.mimeType === "string" ? p.mimeType : "application/octet-stream" };
}

/** The bytes behind a queued file, read at send time: a file taken off the
    job since it was queued doesn't go. The read has its own timeout
    (WRITE_DOWNLOAD_TIMEOUT_MS) — one clock of the several that must fit in
    the row's claim — and a read that runs out is unreadable, which retries. */
async function readBytes(
  orgId: string,
  documentId: string
): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer>; mimeType: string } | { ok: false; gone: boolean }> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("storage_ref, mime_type, uploaded_at")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as { storage_ref: string; mime_type: string; uploaded_at: string | null } | null;
  if (!doc || !doc.uploaded_at || !refIsOrgs(doc.storage_ref, orgId)) return { ok: false, gone: true };
  try {
    const { data: blob, error } = await supabaseAdmin.storage
      .from(DOCUMENTS_BUCKET)
      .download(doc.storage_ref, undefined, { signal: AbortSignal.timeout(WRITE_DOWNLOAD_TIMEOUT_MS) });
    if (error || !blob) return { ok: false, gone: false };
    return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: doc.mime_type };
  } catch {
    return { ok: false, gone: false };
  }
}

type Ready = { payload: AttachmentPayload; jobUuid: string; bytes: Uint8Array<ArrayBuffer>; mimeType: string };

const fromVerdict = (v: WriteVerdict, httpStatus: number | null = null): Finish => ({
  status: v.status,
  error: v.error,
  httpStatus,
  verdict: v,
});

/** A token renewed mid-run belongs to whatever account is connected NOW,
    and a reconnect may have changed it: that token never carries a write
    queued for another account. A token whose connection names no account at
    all carries nothing either — the write goes back to wait, because
    "unknown" is not "another". Null when the token fits the row. */
function tokenMismatch(row: WriteRow, access: Sm8Access): Finish | null {
  if (access.tenantId === row.tenant_id) return null;
  if (access.tenantId === null) return fromVerdict(verdictForAccountUnknown());
  return { status: "cancelled", error: WRITE_WORDS.otherAccount, httpStatus: null };
}

/** The request itself, with one token. */
async function postOne(
  row: WriteRow,
  r: Ready,
  access: Sm8Access,
  attempts: number,
  ctx: () => VerdictContext
): Promise<Finish> {
  const wrong = tokenMismatch(row, access);
  if (wrong) return wrong;

  const res = await postSm8Attachment(sm8CallOf(access, "write"), {
    jobUuid: r.jobUuid,
    uuid: row.remote_uuid,
    fileName: r.payload.name,
    mimeType: r.mimeType,
    bytes: r.bytes,
  });

  let outcome: Sm8WriteOutcome = res.outcome;
  if (outcome.kind === "exists") {
    /* ServiceM8 already has a record under our uuid. Ours, from an attempt
       whose answer was lost, if it is on this job and live; ours and DEAD if
       it is on this job and inactive (an upload that failed half way — that
       uuid can't be finished, so the file goes again under a new one); and
       anything else is a conflict that isn't ours to call sent. */
    const check = await readSm8Attachment(sm8CallOf(access, "write"), row.remote_uuid);
    /* a read-back the account's limit had no room for is handed back, not
       spent: the record under our uuid is still there to confirm next time */
    if (!check.ok && check.throttled) outcome = { kind: "rate_limited", limit: "ours" };
    else if (!check.ok) outcome = { kind: "unavailable", status: null };
    else if (!check.found) outcome = { kind: "unavailable", status: 409 };
    else if (check.jobUuid !== row.sm8_job_uuid) outcome = { kind: "rejected", status: 409 };
    else if (!check.active) outcome = { kind: "dead_record" };
  }

  const v = verdictFor(outcome, attempts, ctx());
  const theirs =
    outcome.kind === "created" && outcome.remoteUuid && outcome.remoteUuid !== row.remote_uuid
      ? outcome.remoteUuid
      : undefined;
  /* the upload went and nothing trustworthy came back: no answer, a 408 or
     a 5xx, or a 409 whose record couldn't be read back */
  const uploadLost = outcome.kind === "unavailable" || (res.status === 409 && outcome.kind === "rate_limited");
  return { ...fromVerdict(v, res.status), remoteUuid: theirs, remote: res.remote ?? null, uploadLost };
}

/** One row, start to end. Returns what it became, and the access to carry
    on with — renewed, when ServiceM8 refused the one it was given.

    1. The account and the payload are checked.
    2. A row pressed again after an upload that may have landed first asks
       ServiceM8 about each uuid waiting for its check (verify_uuids): one
       found live on this job is the file, sent, with no upload at all. Each
       ruled out is dropped; a read that fails keeps the rest waiting.
    3. The file is read. A trial run stops here.
    4. PAST WRITE_SEND_BY_MS INTO THE CLAIM, NO UPLOAD STARTS: one that did
       could outlive the lease. The row is let go, untouched.
    5. The upload. A refused token is renewed once and tried again under the
       same claim, the same uuid and the same attempt count — asked again
       whether it is still in time first. */
async function sendOne(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  access: Sm8Access | null,
  t: { claimedAt: number; clock: () => number }
): Promise<{ finish: Finish; access: Sm8Access | null }> {
  /* the reconnect accident with writes in it: never another account */
  if (row.tenant_id !== state.tenantId) {
    return { finish: { status: "cancelled", error: WRITE_WORDS.otherAccount, httpStatus: null }, access };
  }
  const payload = row.kind === "attachment" ? readPayload(row) : null;
  if (!payload || !row.sm8_job_uuid) {
    return { finish: { status: "cancelled", error: WRITE_WORDS.fileGone, httpStatus: null }, access };
  }
  const ctx = (): VerdictContext => ({
    now: t.clock(),
    timezoneName: state.timezoneName,
    freeRetries: row.free_retries ?? 0,
  });
  const live = state.mode === "live" && access !== null ? access : null;

  /* Absent until a check has been made, so a finish that made none leaves
     the list as it was. */
  let verifyUuids: string[] | undefined;
  const toCheck = row.verify_uuids ?? [];
  if (live && toCheck.length > 0) {
    const wrong = tokenMismatch(row, live);
    if (wrong) return { finish: wrong, access };
    let left = [...toCheck];
    for (const uuid of toCheck) {
      const check = await readSm8Attachment(sm8CallOf(live, "write"), uuid);
      if (!check.ok) {
        /* the account's limit had no room: handed back, the check kept for
           next time; any other failed read spends the attempt as before */
        const unread = fromVerdict(
          verdictFor(
            check.throttled ? { kind: "rate_limited", limit: "ours" } : { kind: "unavailable", status: null },
            attempts,
            ctx()
          )
        );
        return { finish: { ...unread, verifyUuids: left }, access };
      }
      if (check.found && check.active && check.jobUuid === row.sm8_job_uuid) {
        return { finish: { status: "sent", error: null, httpStatus: null, remoteUuid: uuid, verifyUuids: [] }, access };
      }
      /* not there, spent (inactive), or on another job: not this file */
      left = left.filter((u) => u !== uuid);
    }
    verifyUuids = left;
  }

  const file = await readBytes(orgId, payload.documentId);
  if (!file.ok) {
    if (file.gone) return { finish: { status: "cancelled", error: WRITE_WORDS.fileGone, httpStatus: null, verifyUuids }, access };
    return { finish: { ...fromVerdict(verdictForUnreadable(attempts)), verifyUuids }, access };
  }
  const ready: Ready = {
    payload,
    jobUuid: row.sm8_job_uuid,
    bytes: file.bytes,
    mimeType: file.mimeType || payload.mimeType,
  };

  /* A TRIAL RUN GOES THIS FAR AND NO FURTHER: the account checked, the file
     found and read, the request ready. Only the send is left out. */
  if (!live) return { finish: { status: "trial", error: null, httpStatus: null }, access };

  const inTime = () => t.clock() - t.claimedAt < WRITE_SEND_BY_MS;
  if (!inTime()) return { finish: { ...fromVerdict(verdictForLetGo(row.free_retries ?? 0)), verifyUuids }, access };

  const out = await withSm8Renewal(
    orgId,
    live,
    (a) => postOne(row, ready, a, attempts, ctx),
    (f) => f.verdict?.reauth === true,
    { retry: inTime }
  );
  const as = (v: WriteVerdict): Finish => ({ ...fromVerdict(v, out.result.httpStatus), verifyUuids });
  switch (out.verdict) {
    case "unreachable":
      return { finish: as(verdictForRenewUnreachable()), access: out.access };
    case "gone":
      return { finish: as(verdictForDisconnected()), access: out.access };
    case "late":
      return { finish: as(verdictForRenewLate()), access: out.access };
    default:
      /* ok, or dead: a second refusal, already flagged for this grant by the
         renewal — the row waits for the reconnect, its attempt handed back */
      return { finish: { ...out.result, verifyUuids: out.result.verifyUuids ?? verifyUuids }, access: out.access };
  }
}

/** Send what is due for one workspace. `ids` narrows it to one press's
    rows; `budgetMs` stops claiming new rows once a waiting person has
    waited long enough — what is left goes on the next kick.

    THE GATES, IN ORDER, and what each does to what is waiting:
    1. settings that couldn't be read: hold, cancel nothing;
    2. a deployment that writes nothing: stop;
    3. no connection row at all: cancel, in the disconnect's words (a send in
       flight at the disconnect finishes back in the queue, and goes here);
    4. the owner's Off, as stored: cancel. A stored value that isn't a
       setting holds;
    5. no account named: stop;
    6. paused: hold, cancel nothing;
    7. On with a grant that doesn't work: stop for the reconnect;
    8. no kind whose permission is held: stop, holding them.

    AND AGAIN BEFORE EVERY CLAIM AFTER A SEND. Pause changes no row, so a
    run already going when the owner presses it would carry on claiming on
    the setting it started with; the switch and the account are read again
    (one row), and a run whose setting or account has moved stops there. */
export async function runSm8Writes(
  orgId: string,
  trigger: Sm8WriteTrigger,
  opts: { ids?: readonly string[]; budgetMs?: number; clock?: () => number } = {}
): Promise<Sm8WriteRun> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  if (opts.ids && opts.ids.length === 0) return NONE;

  const state = await readSm8WriteState(orgId);
  if (!state.readable) return { ...NONE, stopped: WRITE_WORDS.settingsUnread };
  if (state.kinds.length === 0) return { ...NONE, stopped: "Writing to ServiceM8 isn't available on this deployment." };
  if (!state.linked) {
    await cancelWaitingSm8Writes(orgId, WRITE_WORDS.disconnected, started);
    return { ...NONE, stopped: "ServiceM8 isn't connected." };
  }
  if (state.mode === "off") {
    /* stragglers from before the switch went off never go — but only the
       owner's own Off cancels; a value that isn't a setting holds */
    if (state.modeStored !== "off") return { ...NONE, stopped: WRITE_WORDS.settingsUnread };
    await cancelWaitingSm8Writes(orgId, WRITE_WORDS.switchedOff, started);
    return { ...NONE, stopped: "Writing to ServiceM8 is switched off." };
  }
  if (!state.tenantId) return { ...NONE, stopped: "ServiceM8 isn't connected." };
  if (state.mode === "paused") return { ...NONE, stopped: WRITE_WORDS.paused };
  const live = state.mode === "live";
  if (live && !state.connected) return { ...NONE, stopped: WRITE_WORDS.reauth };
  const ready = state.kinds.filter((k) => kindReady(state, k));
  if (ready.length === 0) return { ...NONE, stopped: WRITE_WORDS.scopeHeld };

  const due = await dueRows(orgId, started, ready, opts.ids);
  if (due.length === 0) return NONE;

  /* The rows are left exactly as they are when there's no token: a grant
     that is dead says so on the connection, and a ServiceM8 that couldn't be
     reached to renew one is a wait, not a failure of any file. */
  let access: Sm8Access | null = null;
  if (live) {
    const got = await sm8AccessResult(orgId, started);
    if (!got.ok) {
      return { ...NONE, stopped: got.reason === "unreachable" ? WRITE_WORDS.unreachable : WRITE_WORDS.reauth };
    }
    access = got.access;
  }

  const run: Sm8WriteRun = { ...NONE };
  /* a 403 that names no scope is one file's; two in a row is the account's */
  let refusedInARow = 0;
  let current: Sm8WriteState = state;
  let sentSinceRead = false;
  for (const row of due) {
    if (run.done >= WRITE_BATCH) break;
    if (sentSinceRead) {
      const moved = await switchMoved(orgId, state);
      if (typeof moved === "string") {
        run.stopped = moved;
        break;
      }
      current = moved;
      sentSinceRead = false;
    }
    /* the budget is checked last, right before the claim it bounds */
    if (opts.budgetMs !== undefined && clock() - started > opts.budgetMs) break;
    const claimedAt = clock();
    const claimId = await claim(orgId, row, claimedAt, live);
    if (!claimId) continue;
    sentSinceRead = true;

    let f: Finish;
    try {
      const sent = await sendOne(orgId, current, row, row.attempts + 1, access, { claimedAt, clock });
      f = sent.finish;
      access = sent.access;
    } catch (err) {
      /* nothing above should throw; if something does, the row is not left
         claimed until its lease lapses — and, not knowing whether an upload
         went, a live send keeps its uuid marked as maybe landed */
      console.error(`[sm8] write ${row.id} (${trigger}) threw: ${err instanceof Error ? err.message : String(err)}`);
      f = { ...fromVerdict(verdictForUnreadable(row.attempts + 1)), uploadLost: live };
    }
    const landed = await finish(orgId, row, claimId, f, clock());

    /* What the answer says about the ACCOUNT holds whoever recorded the row:
       a refused kind waits for a reconnect, and an unpaid bill or a limit
       holds everything queued. */
    /* (the row is of a ready kind: dueRows took no other) */
    if (f.verdict?.blockKind) await markSm8KindRefused(orgId, row.kind as Sm8WriteKind, clock());
    if (f.verdict?.holdAllMs) await holdQueuedUntil(orgId, new Date(clock() + f.verdict.holdAllMs).toISOString());

    run.done += 1;
    if (!landed) run.lost += 1;
    else {
      if (f.status === "sent") run.sent += 1;
      if (f.status === "trial") run.trial += 1;
      if (f.status === "failed") run.failed += 1;
      if (f.status === "queued" && f.verdict?.retryAfterMs === 0) run.again += 1;
    }
    if (f.verdict?.stop) {
      run.stopped = f.error;
      break;
    }
    refusedInARow = f.httpStatus === 403 && !f.verdict?.blockKind ? refusedInARow + 1 : 0;
    if (refusedInARow >= 2) {
      run.stopped = WRITE_WORDS.forbidden;
      break;
    }
  }
  return run;
}

/** The switch and the account, read again mid-run: the fresh state when
    they are as the run found them, or why the run stops. */
async function switchMoved(orgId: string, was: Sm8WriteState): Promise<Sm8WriteState | string> {
  const is = await readSm8WriteState(orgId);
  if (!is.readable) return WRITE_WORDS.settingsUnread;
  if (!is.linked || !is.tenantId) return "ServiceM8 isn't connected.";
  if (is.tenantId !== was.tenantId) return WRITE_WORDS.otherAccount;
  if (is.mode !== was.mode) {
    if (is.mode === "paused") return WRITE_WORDS.paused;
    if (is.mode === "off") return "Writing to ServiceM8 is switched off.";
    return is.mode === "trial" ? "Sending to ServiceM8 changed to a trial run." : "Sending to ServiceM8 was switched on.";
  }
  if (is.mode === "live" && !is.connected) return WRITE_WORDS.reauth;
  return is;
}

/* ── what is due ── */

/** Whether anything of a kind this deployment writes is due to go for one
    workspace — the page-load check (sm8-freshness), one indexed row. False
    on a deployment that writes nothing, and when the queue can't be read. */
export async function sm8WritesDue(orgId: string, now: number = Date.now()): Promise<boolean> {
  const kinds = sm8WriteKindsEnabled();
  if (kinds.length === 0) return false;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .in("kind", kinds)
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", new Date(now).toISOString())
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Workspaces with something due, longest-waiting first — the nightly
    cron's list, for the hours nobody opens the board. */
export async function orgsWithDueSm8Writes(limit: number, now: number = Date.now()): Promise<string[]> {
  const kinds = sm8WriteKindsEnabled();
  if (kinds.length === 0) return [];
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("org_id")
    .in("kind", kinds)
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", new Date(now).toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(500);
  return [...new Set(((data ?? []) as { org_id: string }[]).map((r) => r.org_id))].slice(0, limit);
}

/* ── what the card and the screen read ── */

/** What has been sent from one job, by file. */
export async function readJobSends(orgId: string, jobUuid: string): Promise<JobSend[]> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("subject, status, last_error, attempts, remote_uuid")
    .eq("org_id", orgId)
    .eq("kind", "attachment")
    .eq("sm8_job_uuid", jobUuid)
    .limit(500);
  const out: JobSend[] = [];
  for (const r of (data ?? []) as {
    subject: string;
    status: string;
    last_error: string | null;
    attempts: number | null;
    remote_uuid: string;
  }[]) {
    const documentId = subjectDocumentId(r.subject);
    if (!documentId) continue;
    out.push({
      documentId,
      status: readWriteStatus(r.status),
      error: r.last_error ?? null,
      attempts: r.attempts ?? 0,
      remoteUuid: r.remote_uuid,
    });
  }
  return out;
}

export type RecentSm8Write = {
  id: string;
  /** The file's name as it went. */
  name: string;
  /** "2380", when the job is still in the mirror. */
  jobNumber: string | null;
  status: Sm8WriteStatus;
  attempts: number;
  error: string | null;
  /** When it last changed. */
  at: string;
  /** Who pressed Send. */
  by: string | null;
};

/** How far back the screen lists the writes that are over with. */
const RECENT_DAYS = 30;
/** Each half of the list stops here. */
const RECENT_CAP = 200;

const RECENT_COLUMNS = "id, sm8_job_uuid, payload, status, attempts, last_error, updated_at, requested_by";

type RecentRow = {
  id: string;
  sm8_job_uuid: string | null;
  payload: unknown;
  status: string;
  attempts: number | null;
  last_error: string | null;
  updated_at: string;
  requested_by: string | null;
};

/** The writes for the ServiceM8 screen, latest first: EVERY write still
    waiting, in flight or failed, however old — those are the ones somebody
    may need to act on — and those that are over with (sent, trial runs,
    cancelled) from the last 30 days. */
export async function listRecentSm8Writes(orgId: string, now: number = Date.now()): Promise<RecentSm8Write[]> {
  const since = new Date(now - RECENT_DAYS * 86_400_000).toISOString();
  const [open, over] = await Promise.all([
    supabaseAdmin
      .from(TABLE)
      .select(RECENT_COLUMNS)
      .eq("org_id", orgId)
      .in("status", ["queued", "sending", "failed"])
      .order("updated_at", { ascending: false })
      .limit(RECENT_CAP),
    supabaseAdmin
      .from(TABLE)
      .select(RECENT_COLUMNS)
      .eq("org_id", orgId)
      .in("status", ["sent", "trial", "cancelled"])
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(RECENT_CAP),
  ]);
  const rows = [...((open.data ?? []) as RecentRow[]), ...((over.data ?? []) as RecentRow[])].sort((a, b) =>
    a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0
  );
  if (rows.length === 0) return [];

  const jobUuids = [...new Set(rows.map((r) => r.sm8_job_uuid).filter((u): u is string => !!u))];
  const [jobs, names] = await Promise.all([
    jobUuids.length > 0
      ? supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id").eq("org_id", orgId).in("uuid", jobUuids)
      : Promise.resolve({ data: [] }),
    staffDisplayNames(
      orgId,
      rows.map((r) => r.requested_by)
    ),
  ]);
  const numbers = new Map(
    ((jobs.data ?? []) as { uuid: string; generated_job_id: string | null }[]).map((j) => [
      j.uuid,
      j.generated_job_id?.trim() || null,
    ])
  );

  return rows.map((r) => {
    const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
    return {
      id: r.id,
      name: typeof p.name === "string" && p.name ? p.name : "A file",
      jobNumber: r.sm8_job_uuid ? numbers.get(r.sm8_job_uuid) ?? null : null,
      status: readWriteStatus(r.status),
      attempts: r.attempts ?? 0,
      error: r.last_error ?? null,
      at: r.updated_at,
      by: r.requested_by ? names.get(r.requested_by) ?? null : null,
    };
  });
}

/** The queue in two numbers, for the owner's screen: what is waiting to go
    (the same count the disconnect confirm and the cancel use), and what
    failed FOR THE ACCOUNT CONNECTED NOW (`tenantId`) and waits for a
    person — the ones Retry failed files takes. An account this workspace
    has left keeps its history, and its failures could never be retried
    from here: counted, they would draw a Retry that answers "nothing". No
    account named, nothing is counted as failed. */
export async function countSm8Queue(
  orgId: string,
  tenantId: string | null,
  now: number = Date.now()
): Promise<{ waiting: number; failed: number }> {
  const [waiting, failed] = await Promise.all([
    countWaitingSm8Writes(orgId, now),
    tenantId
      ? supabaseAdmin
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("tenant_id", tenantId)
          .eq("status", "failed")
      : Promise.resolve({ count: 0, error: null }),
  ]);
  return { waiting, failed: failed.error ? 0 : failed.count ?? 0 };
}

/** Why a workspace's waiting writes are stuck, for the owner's bell — null
    when they aren't (or nothing is waiting):
    - `cap`: HeyTiff paused sending at the hourly cap, and it stays paused
      until the owner switches it back on;
    - `billing`: ServiceM8 said the account isn't in good standing;
    - `reconnect`: On, and the grant doesn't work, or ServiceM8 refused the
      permission a kind needs.
    An owner's own pause, Off and a trial run are the owner's choices, and
    say nothing here. */
export type Sm8QueueStuck = { reason: "cap" | "billing" | "reconnect"; waiting: number };

export async function sm8QueueStuck(orgId: string, now: number = Date.now()): Promise<Sm8QueueStuck | null> {
  if (!sm8WritesEnabled()) return null;
  const state = await readSm8WriteState(orgId);
  if (!state.readable || !state.linked) return null;
  if (state.mode === "paused" && state.pausedReason === "cap") {
    return { reason: "cap", waiting: await countWaitingSm8Writes(orgId, now) };
  }
  if (state.mode !== "live") return null;
  const waiting = await countWaitingSm8Writes(orgId, now);
  if (waiting === 0) return null;
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "queued")
    .eq("last_error", WRITE_WORDS.billing);
  if (!error && (count ?? 0) > 0) return { reason: "billing", waiting };
  if (!state.connected || state.kinds.some((k) => !kindReady(state, k))) return { reason: "reconnect", waiting };
  return null;
}

/** How many files went to ServiceM8 in the last `days` — the screen's one
    figure. Null when the count couldn't be read. */
export async function countSm8WritesSentLately(
  orgId: string,
  days = 30,
  now: number = Date.now()
): Promise<number | null> {
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "sent")
    .gte("sent_at", new Date(now - days * 86_400_000).toISOString());
  return error ? null : count ?? 0;
}
