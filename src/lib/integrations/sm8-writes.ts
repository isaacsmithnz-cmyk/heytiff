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

   NO SESSION HERE — the caller establishes the right to ask (the card's
   action, an owner's action, CRON_SECRET, or a page loader that already
   gated the org) and hands in a bare orgId. */

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { SM8_WRITE_SCOPE_LIST } from "./providers";
import { sm8AccessResult, type Sm8Access } from "./sm8-store";
import { withSm8Renewal } from "./sm8-renew";
import { cancelWaitingSm8Writes } from "./sm8-write-cancel";
import { postSm8Attachment, readSm8Attachment } from "./sm8-write";
import {
  documentSubject,
  readWriteMode,
  readWriteStatus,
  sm8FileName,
  subjectDocumentId,
  verdictFor,
  verdictForDisconnected,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForUnreadable,
  WRITE_BATCH,
  WRITE_LEASE_MS,
  WRITE_RETRY_CUTOFF_MS,
  WRITE_WORDS,
  type JobSend,
  type Sm8WriteMode,
  type Sm8WriteOutcome,
  type Sm8WriteState,
  type Sm8WriteStatus,
  type WriteVerdict,
} from "./sm8-write-plan";

const TABLE = "sm8_writes";

/** The operator's switch: "1" and nothing else. A write path fails closed. */
export function sm8WritesEnabled(): boolean {
  return process.env.SM8_WRITES === "1";
}

/** Where writing stands for one workspace — read fresh, never cached. A
    workspace with no connection, or a database without the column yet,
    reads as switched off. */
export async function readSm8WriteState(orgId: string): Promise<Sm8WriteState> {
  const { data } = await supabaseAdmin
    .from("integration_connections")
    .select("status, tenant_id, scopes, write_mode")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .maybeSingle();
  const row = data as {
    status: string;
    tenant_id: string | null;
    scopes: string | null;
    write_mode: string | null;
  } | null;
  const have = new Set((row?.scopes ?? "").split(/\s+/).filter(Boolean));
  return {
    deployment: sm8WritesEnabled(),
    mode: readWriteMode(row?.write_mode),
    connected: row?.status === "connected",
    tenantId: row?.tenant_id ?? null,
    granted: SM8_WRITE_SCOPE_LIST.every((s) => have.has(s)),
  };
}

/** The owner's switch. Off also cancels whatever was still waiting to go:
    an owner who switches writing off has said "nothing more", and a file
    that went anyway an hour later would make the switch a suggestion. */
export async function setSm8WriteMode(orgId: string, mode: Sm8WriteMode, now: number = Date.now()): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("integration_connections")
    .update({ write_mode: mode, updated_at: new Date(now).toISOString() })
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .select("id");
  if (error || (data ?? []).length === 0) return false;
  if (mode === "off") await cancelWaitingSm8Writes(orgId, WRITE_WORDS.switchedOff, now);
  return true;
}

/* Cancelling what is waiting lives in sm8-write-cancel.ts, where the
   connection store can reach it too (disconnect, and a change of account).
   Re-exported, so everything that cancelled from here still does. */
export { cancelWaitingSm8Writes };
export type { CancelledWrite } from "./sm8-write-cancel";

/* ── queueing ── */

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

export type Enqueued = {
  /** The rows this press put in the queue. */
  ids: string[];
  /** Files already in ServiceM8 or on their way there, by document id. */
  already: string[];
};

type ExistingRow = { id: string; sm8_job_uuid: string | null; subject: string; status: string };

/** Queue files for their jobs. Null when the queue couldn't be written.

    A file already sent, or being sent, is left as it is and reported back.
    One that failed, was cancelled or went on a trial run is queued again
    under the SAME uuid: if the attempt that "failed" did reach ServiceM8
    after all, the retry is recognised (a 409 on our own uuid) instead of
    making a second copy. A queued one that was waiting to retry is brought
    forward, because somebody has just asked for it again. */
export async function enqueueAttachments(
  orgId: string,
  tenantId: string,
  requestedBy: string | null,
  files: readonly AttachmentToWrite[],
  now: number = Date.now()
): Promise<Enqueued | null> {
  if (files.length === 0) return { ids: [], already: [] };
  const iso = new Date(now).toISOString();

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, sm8_job_uuid, subject, status")
    .eq("org_id", orgId)
    .eq("kind", "attachment")
    .in("sm8_job_uuid", [...new Set(files.map((f) => f.jobUuid))])
    .in(
      "subject",
      files.map((f) => documentSubject(f.documentId))
    );
  if (error) return null;
  const existing = new Map(
    ((data ?? []) as ExistingRow[]).map((r) => [`${r.sm8_job_uuid}|${r.subject}`, r])
  );

  const ids: string[] = [];
  const already: string[] = [];
  const fresh: { documentId: string; row: Record<string, unknown> }[] = [];

  for (const f of files) {
    const subject = documentSubject(f.documentId);
    const payload = {
      documentId: f.documentId,
      name: sm8FileName(f.name),
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      key: f.key,
    };
    const row = existing.get(`${f.jobUuid}|${subject}`);
    if (!row) {
      fresh.push({
        documentId: f.documentId,
        row: {
          org_id: orgId,
          tenant_id: tenantId,
          kind: "attachment",
          sm8_job_uuid: f.jobUuid,
          subject,
          payload,
          remote_uuid: randomUUID(),
          status: "queued",
          attempts: 0,
          next_attempt_at: iso,
          requested_by: requestedBy,
          created_at: iso,
          updated_at: iso,
        },
      });
      continue;
    }

    const status = readWriteStatus(row.status);
    if (status === "sent" || status === "sending") {
      already.push(f.documentId);
      continue;
    }
    const fromScratch = status === "queued" ? {} : { attempts: 0, last_error: null, http_status: null };
    /* conditional on the status it was read in: a sender that claimed it in
       between owns it now, and this press is answered "on its way" */
    const { data: again } = await supabaseAdmin
      .from(TABLE)
      .update({
        tenant_id: tenantId,
        payload,
        status: "queued",
        next_attempt_at: iso,
        lease_until: null,
        requested_by: requestedBy,
        updated_at: iso,
        ...fromScratch,
      })
      .eq("org_id", orgId)
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id");
    if ((again ?? []).length > 0) ids.push(row.id);
    else already.push(f.documentId);
  }

  if (fresh.length > 0) {
    const { data: made, error: insertError } = await supabaseAdmin
      .from(TABLE)
      .upsert(
        fresh.map((f) => f.row),
        { onConflict: "org_id,kind,sm8_job_uuid,subject", ignoreDuplicates: true }
      )
      .select("id, subject");
    if (insertError) return null;
    const madeRows = (made ?? []) as { id: string; subject: string }[];
    const madeSubjects = new Set(madeRows.map((r) => r.subject));
    ids.push(...madeRows.map((r) => r.id));
    /* a row a concurrent press made first is that press's to send */
    for (const f of fresh) if (!madeSubjects.has(documentSubject(f.documentId))) already.push(f.documentId);
  }

  return { ids, already };
}

/* ── sending ── */

export type Sm8WriteTrigger = "send" | "kick" | "cron";

export type Sm8WriteRun = {
  /** Rows this run claimed and finished with. */
  done: number;
  sent: number;
  trial: number;
  failed: number;
  /** Why the run ended before the queue did, when it did. */
  stopped: string | null;
};

const NONE: Sm8WriteRun = { done: 0, sent: 0, trial: 0, failed: 0, stopped: null };

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
};

const ROW_COLUMNS =
  "id, tenant_id, kind, sm8_job_uuid, subject, payload, remote_uuid, status, attempts, lease_until";

/** Rows due now, oldest first: queued ones whose wait is over, and sends
    whose claim lapsed (a worker that died mid-request). */
async function dueRows(orgId: string, now: number, ids?: readonly string[]): Promise<WriteRow[]> {
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", iso);
  if (ids) q = q.in("id", [...ids]);
  const { data } = await q.order("created_at", { ascending: true }).limit(WRITE_BATCH * 3);
  return ((data ?? []) as WriteRow[]).filter(
    (r) => r.status === "queued" || (r.lease_until !== null && Date.parse(r.lease_until) < now)
  );
}

/** Take one row for this sender. The update matches only the row as it was
    read — same status, same attempt count, and for a lapsed send an expired
    claim — so of two senders reaching for one row, exactly one gets it. */
async function claim(orgId: string, row: WriteRow, now: number): Promise<boolean> {
  const iso = new Date(now).toISOString();
  let q = supabaseAdmin
    .from(TABLE)
    .update({
      status: "sending",
      lease_until: new Date(now + WRITE_LEASE_MS).toISOString(),
      attempts: row.attempts + 1,
      updated_at: iso,
    })
    .eq("org_id", orgId)
    .eq("id", row.id)
    .eq("attempts", row.attempts);
  q = row.status === "sending" ? q.eq("status", "sending").lt("lease_until", iso) : q.eq("status", "queued");
  const { data } = await q.select("id");
  return (data ?? []).length > 0;
}

type Finish = {
  status: Sm8WriteStatus;
  error: string | null;
  httpStatus: number | null;
  verdict?: WriteVerdict;
  /** ServiceM8 named the record something other than the uuid we sent. */
  remoteUuid?: string;
};

async function finish(orgId: string, row: WriteRow, f: Finish, now: number): Promise<void> {
  const iso = new Date(now).toISOString();
  const patch: Record<string, unknown> = {
    status: f.status,
    last_error: f.error,
    http_status: f.httpStatus,
    lease_until: null,
    updated_at: iso,
  };
  /* the claim counted this attempt; one that wasn't the row's doing is
     handed back */
  if (f.verdict?.refund) patch.attempts = row.attempts;
  if (f.status === "queued") patch.next_attempt_at = new Date(now + (f.verdict?.retryAfterMs ?? 0)).toISOString();
  if (f.status === "sent") patch.sent_at = iso;
  if (f.remoteUuid) patch.remote_uuid = f.remoteUuid;
  await supabaseAdmin.from(TABLE).update(patch).eq("org_id", orgId).eq("id", row.id);
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
    job since it was queued doesn't go. */
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
  const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_ref);
  if (error || !blob) return { ok: false, gone: false };
  return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: doc.mime_type };
}

type Ready = { payload: AttachmentPayload; jobUuid: string; bytes: Uint8Array<ArrayBuffer>; mimeType: string };

/** Everything a row needs before it can go — the account checked, the file
    found and read — or what it became without going. */
async function prepareOne(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number
): Promise<{ ready: Ready } | { finish: Finish }> {
  /* the reconnect accident with writes in it: never another account */
  if (row.tenant_id !== state.tenantId) {
    return { finish: { status: "cancelled", error: WRITE_WORDS.otherAccount, httpStatus: null } };
  }
  const payload = row.kind === "attachment" ? readPayload(row) : null;
  if (!payload || !row.sm8_job_uuid) {
    return { finish: { status: "cancelled", error: WRITE_WORDS.fileGone, httpStatus: null } };
  }

  const file = await readBytes(orgId, payload.documentId);
  if (!file.ok) {
    if (file.gone) return { finish: { status: "cancelled", error: WRITE_WORDS.fileGone, httpStatus: null } };
    const v = verdictForUnreadable(attempts);
    return { finish: { status: v.status, error: v.error, httpStatus: null, verdict: v } };
  }
  return {
    ready: { payload, jobUuid: row.sm8_job_uuid, bytes: file.bytes, mimeType: file.mimeType || payload.mimeType },
  };
}

/** The request itself, with one token. */
async function postOne(row: WriteRow, r: Ready, access: Sm8Access, attempts: number): Promise<Finish> {
  /* A token renewed mid-run belongs to whatever account is connected NOW,
     and a reconnect may have changed it: that token never carries a file
     queued for another account. */
  if (access.tenantId && access.tenantId !== row.tenant_id) {
    return { status: "cancelled", error: WRITE_WORDS.otherAccount, httpStatus: null };
  }

  const res = await postSm8Attachment(access.accessToken, {
    jobUuid: r.jobUuid,
    uuid: row.remote_uuid,
    fileName: r.payload.name,
    mimeType: r.mimeType,
    bytes: r.bytes,
  });

  let outcome: Sm8WriteOutcome = res.outcome;
  if (outcome.kind === "exists") {
    /* ServiceM8 already has a record under our uuid. Ours, from an attempt
       whose answer was lost, if it is on this job and live; anything else
       is a conflict that isn't ours to call sent. */
    const check = await readSm8Attachment(access.accessToken, row.remote_uuid);
    if (!check.ok) outcome = { kind: "unavailable", status: null };
    else if (!check.found) outcome = { kind: "unavailable", status: 409 };
    else if (check.jobUuid !== row.sm8_job_uuid || !check.active) outcome = { kind: "rejected", status: 409 };
  }

  const v = verdictFor(outcome, attempts);
  const theirs =
    outcome.kind === "created" && outcome.remoteUuid && outcome.remoteUuid !== row.remote_uuid
      ? outcome.remoteUuid
      : undefined;
  return { status: v.status, error: v.error, httpStatus: res.status, verdict: v, remoteUuid: theirs };
}

/** One row, start to end. Returns what it became, and the access to carry
    on with — renewed, when ServiceM8 refused the one it was given.

    A REFUSED TOKEN IS RENEWED ONCE AND TRIED AGAIN under the same claim, the
    same uuid and the same attempt count: a token that ran out mid-run is not
    a dead grant, and the file shouldn't wait for the next kick because of
    it. `inTime` is asked before the second try — past WRITE_RETRY_CUTOFF_MS
    into the claim, the row goes back to the queue instead of risking an
    upload that outlives its lease. */
async function sendOne(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  access: Sm8Access | null,
  inTime: () => boolean
): Promise<{ finish: Finish; access: Sm8Access | null }> {
  const prepared = await prepareOne(orgId, state, row, attempts);
  if ("finish" in prepared) return { finish: prepared.finish, access };

  /* A TRIAL RUN GOES THIS FAR AND NO FURTHER: the account checked, the file
     found and read, the request ready. Only the send is left out. */
  if (state.mode !== "live" || !access) return { finish: { status: "trial", error: null, httpStatus: null }, access };

  const out = await withSm8Renewal(
    orgId,
    access,
    (a) => postOne(row, prepared.ready, a, attempts),
    (f) => f.verdict?.reauth === true,
    { retry: inTime }
  );
  const as = (v: WriteVerdict): Finish => ({ status: v.status, error: v.error, httpStatus: out.result.httpStatus, verdict: v });
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
      return { finish: out.result, access: out.access };
  }
}

/** Send what is due for one workspace. `ids` narrows it to one press's
    rows; `budgetMs` stops claiming new rows once a waiting person has
    waited long enough — what is left goes on the next kick. */
export async function runSm8Writes(
  orgId: string,
  trigger: Sm8WriteTrigger,
  opts: { ids?: readonly string[]; budgetMs?: number; clock?: () => number } = {}
): Promise<Sm8WriteRun> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  if (opts.ids && opts.ids.length === 0) return NONE;

  const state = await readSm8WriteState(orgId);
  if (!state.deployment) return { ...NONE, stopped: "Writing to ServiceM8 isn't available on this deployment." };
  if (state.mode === "off") {
    /* stragglers from before the switch went off never go */
    await cancelWaitingSm8Writes(orgId, WRITE_WORDS.switchedOff, started);
    return { ...NONE, stopped: "Writing to ServiceM8 is switched off." };
  }
  if (!state.tenantId) return { ...NONE, stopped: "ServiceM8 isn't connected." };
  const live = state.mode === "live";
  if (live && !state.connected) return { ...NONE, stopped: WRITE_WORDS.reauth };
  if (live && !state.granted) return { ...NONE, stopped: WRITE_WORDS.forbidden };

  const due = await dueRows(orgId, started, opts.ids);
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
  for (const row of due) {
    if (run.done >= WRITE_BATCH) break;
    if (opts.budgetMs !== undefined && clock() - started > opts.budgetMs) break;
    const claimedAt = clock();
    if (!(await claim(orgId, row, claimedAt))) continue;

    let f: Finish;
    try {
      const sent = await sendOne(
        orgId,
        state,
        row,
        row.attempts + 1,
        access,
        () => clock() - claimedAt < WRITE_RETRY_CUTOFF_MS
      );
      f = sent.finish;
      access = sent.access;
    } catch (err) {
      /* nothing above should throw; if something does, the row is not left
         claimed until its lease lapses */
      console.error(`[sm8] write ${row.id} (${trigger}) threw: ${err instanceof Error ? err.message : String(err)}`);
      const v = verdictForUnreadable(row.attempts + 1);
      f = { status: v.status, error: v.error, httpStatus: null, verdict: v };
    }
    await finish(orgId, row, f, clock());

    run.done += 1;
    if (f.status === "sent") run.sent += 1;
    if (f.status === "trial") run.trial += 1;
    if (f.status === "failed") run.failed += 1;
    if (f.verdict?.stop) {
      run.stopped = f.error;
      break;
    }
  }
  return run;
}

/* ── kicks ── */

/** Schedule a sender after the response when something is due — the
    page-load path, beside kickSm8SyncIfStale. The check is one indexed
    row; the send runs in after(), so nobody's page waits on ServiceM8. */
export async function kickSm8WritesIfDue(orgId: string, now: number = Date.now()): Promise<void> {
  if (!sm8WritesEnabled()) return;
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", new Date(now).toISOString())
    .limit(1);
  if ((data ?? []).length === 0) return;
  after(() => runSm8Writes(orgId, "kick").catch(() => {}));
}

/** Workspaces with something due, longest-waiting first — the nightly
    cron's list, for the hours nobody opens the board. */
export async function orgsWithDueSm8Writes(limit: number, now: number = Date.now()): Promise<string[]> {
  if (!sm8WritesEnabled()) return [];
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("org_id")
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

/** The latest writes, for the ServiceM8 screen. */
export async function listRecentSm8Writes(orgId: string, limit = 8): Promise<RecentSm8Write[]> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("id, sm8_job_uuid, payload, status, attempts, last_error, updated_at, requested_by")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as {
    id: string;
    sm8_job_uuid: string | null;
    payload: unknown;
    status: string;
    attempts: number | null;
    last_error: string | null;
    updated_at: string;
    requested_by: string | null;
  }[];
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
