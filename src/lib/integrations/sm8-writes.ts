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
import { cancelWaitingSm8Writes, countWaitingSm8WritesByKind, type CancelledWrite } from "./sm8-write-cancel";
import { postSm8Attachment, readSm8Attachment } from "./sm8-write";
import { sm8NotesAllowed, sm8WriteKindsEnabled } from "./sm8-kinds";
import { createCanStillGo, fillWords, NOTE_WORDS } from "./sm8-note-plan";
import { BOOKING_WORDS } from "./sm8-booking-words";
import { BOOKING_DELETE_SETTLE_MS } from "./sm8-booking-plan";
import { sendNoteRow } from "./sm8-note-send";
import { sendBookingRow } from "./sm8-booking-send";
import { sendLeaveRow } from "./sm8-leave-send";
import { LEAVE_WORDS } from "./sm8-leave-words";
import {
  capAllows,
  dedupeKey,
  documentSubject,
  grantedKinds,
  kindReady,
  kindsSwitchedOff,
  readOwnerKinds,
  readPausedReason,
  readWriteMode,
  readWriteStatus,
  refusedKinds,
  sm8FileName,
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

/* The kinds this deployment may write (SM8_WRITES) live in sm8-kinds.ts, so
   a reader can ask without importing the sender; re-exported here, so
   everything that asked this module still does. */
export { sm8WriteKindsEnabled, sm8NotesAllowed };

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
  write_kinds?: unknown;
};

const STATE_COLUMNS =
  "status, tenant_id, tenants, scopes, write_mode, paused_reason, paused_at, write_scope_refused, connected_at";

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
    reads the same way, and holds.

    THE OWNER'S PER-KIND SWITCH (write_kinds) is read beside it. A database
    without that column is read again without it: files read as on, as the
    column meant before it existed, and `ownerKindsRead` is false, so
    nothing is ever cancelled for a switch nobody could have set. Files are
    never held for a missing column. */
export async function readSm8WriteState(orgId: string): Promise<Sm8WriteState> {
  const kinds = sm8WriteKindsEnabled();
  const read = (columns: string) =>
    supabaseAdmin.from(CONNECTIONS).select(columns).eq("org_id", orgId).eq("provider", PROVIDER).maybeSingle();
  let ownerKindsRead = true;
  let { data, error } = await read(`${STATE_COLUMNS}, write_kinds`);
  if (missingColumn(error as DbError)) {
    ownerKindsRead = false;
    ({ data, error } = await read(STATE_COLUMNS));
  }
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
      ownerKinds: [],
      ownerKindsRead: false,
    };
  }
  const row = data as unknown as ConnectionRead | null;
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
    ownerKinds: ownerKindsRead ? readOwnerKinds(row?.write_kinds) : ["attachment"],
    ownerKindsRead: ownerKindsRead && row !== null,
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
/* and a note's words leaving the queue, for the nightly cron */
export { clearDisconnectedSm8NoteText, clearSm8NoteText } from "./sm8-write-cancel";

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
    it — see refusedKinds. ONE ATOMIC UPDATE (the sm8_mark_kind_refused
    function merges the kind into the jsonb in place), because with two
    kinds two refusals can race: a read, a merge and a write would let the
    second overwrite the first. The read-merge-write stays only for a
    database without the function yet (PGRST202). */
async function markSm8KindRefused(orgId: string, kind: Sm8WriteKind, now: number): Promise<void> {
  const at = new Date(now).toISOString();
  const rpc = await supabaseAdmin.rpc("sm8_mark_kind_refused", { p_org: orgId, p_kind: kind, p_at: at });
  if (!rpc.error) return;
  if ((rpc.error as DbError)?.code !== "PGRST202") {
    console.error(`[sm8] couldn't record that ServiceM8 refused ${kind} for org ${orgId}:`, rpc.error);
    return;
  }
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
    .update({ write_scope_refused: { ...was, [kind]: at } })
    .eq("org_id", orgId)
    .eq("provider", PROVIDER);
  if (writeError) console.error(`[sm8] couldn't record that ServiceM8 refused ${kind} for org ${orgId}:`, writeError);
}

export type KindChange = { ok: true; cancelled: CancelledWrite[] } | { ok: false };

/** The words a kind's waiting rows are cancelled with when the owner
    switches that kind off: each kind's own. */
function kindSwitchedOffWords(kind: Sm8WriteKind): string {
  if (kind === "note") return NOTE_WORDS.row.notesSwitchedOff;
  if (kind === "booking") return BOOKING_WORDS.row.switchedOff;
  if (kind === "leave") return LEAVE_WORDS.row.switchedOff;
  return NOTE_WORDS.row.filesSwitchedOff;
}

/** The owner's switch for ONE KIND (Files, Notes, Bookings), under the one
    Off / Trial run / Paused / On. A single atomic update
    (sm8_set_write_kind), so two switches pressed at once can't lose one.
    Off also cancels that kind's waiting rows — for notes, creates, flag
    changes and take-backs alike; for bookings, creates, status changes,
    take-backs and clears — in that kind's words, and says what it
    cancelled. `reason` puts other words on them: a read-back guard
    switching Bookings off says why (PR B's stopBookings). */
export async function setSm8WriteKind(
  orgId: string,
  kind: Sm8WriteKind,
  on: boolean,
  now: number = Date.now(),
  opts: { reason?: string } = {}
): Promise<KindChange> {
  const iso = new Date(now).toISOString();
  const { data, error } = await supabaseAdmin.rpc("sm8_set_write_kind", {
    p_org: orgId,
    p_kind: kind,
    p_on: on,
    p_at: iso,
  });
  /* no connection row answers null; an empty list is a switch that took
     (every kind off) */
  if (error || data === null || data === undefined) {
    if (error) console.error(`[sm8] couldn't switch ${kind} ${on ? "on" : "off"} for org ${orgId}:`, error);
    return { ok: false };
  }
  const cancelled = on
    ? []
    : await cancelWaitingSm8Writes(orgId, opts.reason ?? kindSwitchedOffWords(kind), now, { kind });
  return { ok: true, cancelled };
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
  /* A NOTE'S DETAILS, in columns of their own (docs/migrations/
     sm8_notes_queue.sql): written only for kind "note", so a file row still
     inserts on a database without that migration. The payload holds only
     `{ name: <label> }`. */
  op?: "create" | "update" | "delete";
  /** HeyTiff's own row the note is (workboard_notes). */
  noteId?: string;
  /** A take-back's create row. */
  dependsOn?: string;
  /** The ServiceM8 note a flag change is made to. */
  targetUuid?: string;
  flagDone?: boolean;
  /** The edit time and editor the presser saw (a flag change). */
  seenEditDate?: string | null;
  seenEditBy?: string | null;
  /** The words a create goes with, from HeyTiff's row. */
  noteText?: string;
  /* A BOOKING'S DETAILS (docs/migrations/sm8_bookings_queue.sql), in
     columns of their own beside `op`, `dependsOn`, `targetUuid` and
     `seenEditDate`: written only for kind "booking", so a file row and a
     note row insert exactly as they did. The payload holds only
     `{ name: <label> }`, never a booking's details. */
  /** The press a row belongs to (the panel's press id); a status row keeps
      its first press's for good. */
  verbId?: string;
  /** The person booked (a create), or the booking a Clear removes. */
  staffUuid?: string;
  /** "YYYY-MM-DD HH:MM:00", the account's wall clock, never converted. */
  start?: string;
  end?: string;
  /** The zone the times were chosen in (a create). */
  zone?: string;
  /** A status change: Quote to Work Order, and nothing else. */
  statusFrom?: "Quote";
  statusTo?: "Work Order";
  /* LEAVE'S DETAILS (docs/migrations/sm8_leave_queue.sql) go in columns of
     their own, leave_staff_uuid, leave_start and leave_end, from staffUuid,
     start and end above: written only for kind "leave", so every other
     row inserts exactly as it did. A delete carries only dependsOn. */
};

export type Enqueued = {
  /** The rows this press put in the queue. */
  ids: string[];
  /** Refs already in ServiceM8, or on their way there. */
  already: string[];
  /** Nothing was queued: this press would have taken the account past the
      hourly cap, and sending is now paused. */
  capped: boolean;
  /** Note rows someone else pressed: a note goes as whoever pressed it, and
      only they can press it again. Left as they are. */
  others?: string[];
};

type ExistingRow = {
  id: string;
  dedupe_key: string;
  kind?: string;
  status: string;
  attempts: number;
  remote_uuid: string;
  replaced_uuids: string[] | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  pressed_at: string | null;
  requested_by?: string | null;
  taken_back_at?: string | null;
  op?: string | null;
  verb_id?: string | null;
  /** A booking row's (read only when the writes hold one): when it last
      finished, which a delete's re-press waits a minute past. */
  updated_at?: string | null;
};

const EXISTING_COLUMNS =
  "id, dedupe_key, kind, requested_by, status, attempts, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, pressed_at";

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

/** A NOTE ROW NEVER CHANGES WHO PRESSED IT. Its patches never NAME
    requested_by or requested_by_user, not even at the same value: the
    migration's trigger refuses any update of a note row that names either
    (which is what stops OLD code's Retry, after a rollback, re-queueing a
    note), and new code never meets it. */
function withoutPresser(patch: Record<string, unknown>): Record<string, unknown> {
  const { requested_by: _by, requested_by_user: _user, ...rest } = patch;
  void _by;
  void _user;
  return rest;
}

/* THE COLUMNS A FRESH ROW CARRIES beside the common ones, by kind: a file
   writes none of them, so it still inserts on a database without the notes
   or the bookings migration; a note writes the op's and its own; a booking
   the op's and its own. */

/** The op and what it acts on: a note's or a booking's. */
function opColumns(w: Sm8WriteToQueue) {
  return {
    op: w.op ?? "create",
    depends_on: w.dependsOn ?? null,
    target_uuid: w.targetUuid ?? null,
    seen_edit_date: w.seenEditDate ?? null,
  };
}

/** A note's own: HeyTiff's row, the flag and the words. */
function noteOnlyColumns(w: Sm8WriteToQueue) {
  return {
    note_id: w.noteId ?? null,
    flag_done: w.flagDone ?? null,
    seen_edit_by: w.seenEditBy ?? null,
    note_text: w.noteText ?? null,
  };
}

/** A fresh note row's columns, in the order they have always gone. */
function noteColumns(w: Sm8WriteToQueue): Record<string, unknown> {
  const o = opColumns(w);
  const n = noteOnlyColumns(w);
  return {
    op: o.op,
    note_id: n.note_id,
    depends_on: o.depends_on,
    target_uuid: o.target_uuid,
    flag_done: n.flag_done,
    seen_edit_date: o.seen_edit_date,
    seen_edit_by: n.seen_edit_by,
    note_text: n.note_text,
  };
}

/** A booking's own: its press, the booking, its zone, and a status change's
    two statuses. */
function bookingColumns(w: Sm8WriteToQueue): Record<string, unknown> {
  return {
    verb_id: w.verbId ?? null,
    booking_staff_uuid: w.staffUuid ?? null,
    booking_start: w.start ?? null,
    booking_end: w.end ?? null,
    booking_zone: w.zone ?? null,
    job_status_from: w.statusFrom ?? null,
    job_status_to: w.statusTo ?? null,
  };
}

/** Leave's own: the person and the span, on a create. */
function leaveColumns(w: Sm8WriteToQueue): Record<string, unknown> {
  const create = (w.op ?? "create") === "create";
  return {
    leave_staff_uuid: create ? w.staffUuid ?? null : null,
    leave_start: create ? w.start ?? null : null,
    leave_end: create ? w.end ?? null : null,
  };
}

/** The patch a leave row pressed again gets. A create that is waiting only
    comes forward; one that failed, was cancelled or went on a trial run goes
    again under a new uuid (againPatch) — and one whose leave was cancelled
    (taken back) never goes again: the update misses on taken_back_at. A
    DELETE NEVER COMES FORWARD, and one going again keeps the uuids its
    DELETE reached, so it only reads them: a DELETE on leave already off the
    board may put it back. */
function leaveRepressPatch(row: ExistingRow, w: Sm8WriteToQueue, press: Sm8Press, tenantId: string, iso: string, queued: boolean): Record<string, unknown> {
  const presser = { requested_by: press.staffId, requested_by_user: press.userId };
  if ((w.op ?? "create") === "create") {
    return queued ? { tenant_id: tenantId, next_attempt_at: iso, updated_at: iso, ...presser } : againPatch(row, press, tenantId, iso);
  }
  if (queued) return { tenant_id: tenantId, updated_at: iso, ...presser };
  const finished = row.updated_at ? Date.parse(row.updated_at) : NaN;
  const settled = Number.isNaN(finished) ? iso : new Date(Math.max(Date.parse(iso), finished + BOOKING_DELETE_SETTLE_MS)).toISOString();
  return {
    tenant_id: tenantId,
    status: "queued",
    next_attempt_at: settled,
    lease_until: null,
    claim_id: null,
    attempts: 0,
    last_error: null,
    http_status: null,
    remote_code: null,
    remote_message: null,
    free_retries: 0,
    source: "press",
    pressed_at: iso,
    updated_at: iso,
    ...presser,
  };
}

/** The patch a booking row pressed again gets (the spec's 2.10), by op.
    - A STATUS ROW: joined while queued, it only comes forward and renews its
      press (pressed_at), so its two-minute wait covers this press's
      bookings and its day-old clock starts again; failed, cancelled or a
      trial, it goes again (againPatch). Neither ever names verb_id: a
      status row keeps its first press's for good.
    - A CREATE: this press's details go on it — its press, its end, its
      zone and the status row it now waits on — so a new length, or a status
      row that is new or gone, takes effect. The person and the start are
      in its subject and can't differ.
    - A TAKE-BACK (an Undo): as a file's. A CLEAR: with this press's copy of
      the booking as the mirror has it now.
    A TAKE-BACK OR A CLEAR GOING AGAIN FORGETS THE UUIDS ITS DELETE REACHED
    (verify_uuids, on a delete row): its sender never sends a second DELETE
    to one of them by itself, and a person's Try again is what may — after
    it reads the booking live first.
    A TAKE-BACK OR A CLEAR NEVER COMES FORWARD. A DELETE whose answer was
    lost may have landed, and a read may not show it for a moment (U23):
    one that comes forward could read the booking still there and send it a
    second DELETE, which puts it back. So a queued one keeps its time (the
    queue helpers don't press one again at all), and one that failed or was
    cancelled after a try goes again no sooner than a minute after that try
    finished (BOOKING_DELETE_SETTLE_MS). */
function bookingRepressPatch(
  row: ExistingRow,
  w: Sm8WriteToQueue,
  press: Sm8Press,
  tenantId: string,
  iso: string,
  queued: boolean
): Record<string, unknown> {
  const op = w.op ?? "create";
  const presser = { requested_by: press.staffId, requested_by_user: press.userId };
  if (op === "update") {
    return queued ? { tenant_id: tenantId, next_attempt_at: iso, updated_at: iso, pressed_at: iso } : againPatch(row, press, tenantId, iso);
  }
  if (op === "create") {
    const mine = {
      verb_id: w.verbId ?? null,
      booking_end: w.end ?? null,
      booking_zone: w.zone ?? null,
      depends_on: w.dependsOn ?? null,
    };
    return queued
      ? { tenant_id: tenantId, next_attempt_at: iso, updated_at: iso, ...mine, ...presser }
      : { ...againPatch(row, press, tenantId, iso), ...mine };
  }
  /* a delete: a Clear names the activity and carries the booking as this
     press's confirm showed it; an Undo names its create */
  const clear = !w.dependsOn
    ? { verb_id: w.verbId ?? null, booking_staff_uuid: w.staffUuid ?? null, booking_start: w.start ?? null, booking_end: w.end ?? null }
    : {};
  if (queued) return { tenant_id: tenantId, payload: w.payload, ...presser, updated_at: iso, ...clear };
  /* tried: an attempt counted, or a DELETE that reached a booking (its
     verify_uuids) — a go that let its row go after a DELETE hands its
     attempt back, and Bookings Off may cancel it before it goes again */
  const tried = (row.status === "failed" || row.status === "cancelled") && (row.attempts > 0 || (row.verify_uuids?.length ?? 0) > 0);
  const finished = tried && row.updated_at ? Date.parse(row.updated_at) : NaN;
  const settled = Number.isNaN(finished) ? iso : new Date(Math.max(Date.parse(iso), finished + BOOKING_DELETE_SETTLE_MS)).toISOString();
  return { ...againPatch(row, press, tenantId, iso), next_attempt_at: settled, payload: w.payload, verify_uuids: [], ...clear };
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
    and `capped` says so.

    A NOTE ROW (only sm8-note-queue queues one) keeps three more rules:
    - pressed again by anyone but whoever pressed it, it is left alone and
      its ref comes back in `others`;
    - its patches never name the presser (withoutPresser);
    - a create's patch writes its words and note again (the 30-day clear
      may have taken the words), leaves the payload alone, and misses on a
      create somebody took back (taken_back_at), which is answered in
      `already` — the helper then reads the note again and says so.

    A BOOKING ROW (only sm8-booking-queue queues one) writes its op's and
    its own columns, and is pressed again by its op (bookingRepressPatch): a
    re-press by someone else makes it theirs; a create or a status row taken
    back is never queued again (the patch misses, answered in `already`);
    and a status row never has its verb_id rewritten. */
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

  const holdsNote = writes.some((w) => w.kind === "note");
  const holdsBooking = writes.some((w) => w.kind === "booking");
  const holdsLeave = writes.some((w) => w.kind === "leave");
  /* a booking's columns are read only when the writes hold one, so a file
     or a note press reads exactly what it always did; leave's the same */
  const existingColumns =
    holdsNote || holdsBooking || holdsLeave
      ? `${EXISTING_COLUMNS}, op, taken_back_at${holdsBooking ? ", verb_id" : ""}${holdsBooking || holdsLeave ? ", updated_at" : ""}`
      : EXISTING_COLUMNS;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(existingColumns)
    .eq("org_id", orgId)
    .in("dedupe_key", [...byKey.keys()]);
  if (error) {
    console.error(`[sm8] couldn't read the queue for org ${orgId}:`, error);
    return null;
  }
  const existing = new Map(((data ?? []) as unknown as ExistingRow[]).map((r) => [r.dedupe_key, r]));

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
  const others: string[] = [];
  const fresh: FreshRow[] = [];

  for (const [key, w] of byKey) {
    const row = existing.get(key);
    const note = w.kind === "note";
    const booking = w.kind === "booking";
    const leave = w.kind === "leave";
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
          ...(note
            ? noteColumns(w)
            : booking
              ? { ...opColumns(w), ...bookingColumns(w) }
              : leave
                ? { ...opColumns(w), ...leaveColumns(w) }
                : {}),
        },
      });
      continue;
    }

    /* a note goes as whoever pressed it: nobody else presses it again */
    if (note && (row.requested_by ?? null) !== press.staffId) {
      others.push(w.ref);
      continue;
    }
    const status = readWriteStatus(row.status);
    if (status === "sent" || status === "sending") {
      already.push(w.ref);
      continue;
    }
    const create = note && (w.op ?? "create") === "create";
    /* a booking create or status row taken back is never queued again, as a
       note create isn't: the patch misses, and the helper answers from the
       row (sm8-booking-queue) */
    const bookingTakeBackable = booking && ((w.op ?? "create") === "create" || w.op === "update");
    /* leave cancelled is never put back by a press either */
    const leaveCreate = leave && (w.op ?? "create") === "create";
    /* a create's words and note, again: the 30-day clear may have taken the
       words, and the press puts them back from HeyTiff's own row */
    const createCols = create ? { note_text: w.noteText ?? null, note_id: w.noteId ?? null } : {};
    const patch = note
      ? status === "queued"
        ? { tenant_id: tenantId, next_attempt_at: iso, updated_at: iso, ...createCols }
        : { ...withoutPresser(againPatch(row, press, tenantId, iso)), ...createCols }
      : booking
        ? bookingRepressPatch(row, w, press, tenantId, iso, status === "queued")
        : leave
          ? leaveRepressPatch(row, w, press, tenantId, iso, status === "queued")
          : status === "queued"
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
       tell the office a file is in ServiceM8 that went nowhere. A create
       somebody took back is never queued again, even by a press racing the
       Undo: the patch misses, and the helper answers from the note. */
    let again$ = supabaseAdmin
      .from(TABLE)
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", row.id)
      .eq("status", row.status);
    if (create || bookingTakeBackable || leaveCreate) again$ = again$.is("taken_back_at", null);
    const { data: again, error: againError } = await again$.select("id");
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

  return others.length > 0 ? { ids, already, capped: false, others } : { ids, already, capped: false };
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
    PAUSE: it takes what the hour has room for and says how many are left.

    FILES ONLY — the select and the count of what is left alike. A note goes
    as whoever pressed it, and only they can send it again (from its own
    line); an owner's Retry never names it, and never counts it as left. */
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
      .eq("kind", "attachment")
      .eq("status", "failed")
      .order("updated_at", { ascending: true })
      .limit(room);
    if (error) {
      console.error(`[sm8] couldn't read the failed writes for org ${orgId}:`, error);
      return null;
    }
    for (const row of (data ?? []) as unknown as ExistingRow[]) {
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
    .eq("kind", "attachment")
    .eq("status", "failed");
  const left = countError ? 0 : count ?? 0;
  return { queued, left, capped: room === 0, byHour: left > 0 && byHourRoom <= RETRY_BATCH };
}

/* ── taking a row back before it goes ── */

/** The columns stopCreateRow reads a row back with, unless its caller names
    its own. */
const STOP_COLUMNS =
  "id, kind, op, sm8_job_uuid, tenant_id, status, lease_until, remote_uuid, maybe_landed, verify_uuids, taken_back_at, last_error, attempts, requested_by_user";

/** Close a row a person took back, and stop it if it could still go —
    a note's create, a booking's create, or a booking's status row (moved
    here from the note queue's stopCreate, and the one function both kinds
    call). Needs no ServiceM8 call, and checks nothing but what its caller
    already checked (who):
    1. taken_back_at = now where null, whatever the status — from here it is
       never claimed, no press can queue it again, and a sender holding it
       stops at its next POST attempt;
    2. read again (`columns`, the caller's own list);
    3. if it could still go (queued, failed, trial, a lapsed send), cancel
       it on the status read, leaving maybe_landed and verify_uuids for the
       delete. A miss reads it again.
    Returns the row as it now stands. */
export async function stopCreateRow<T extends { id: string; status: string; lease_until: string | null }>(
  orgId: string,
  row: T,
  now: number,
  columns: string = STOP_COLUMNS
): Promise<T> {
  const iso = new Date(now).toISOString();
  await supabaseAdmin.from(TABLE).update({ taken_back_at: iso }).eq("org_id", orgId).eq("id", row.id).is("taken_back_at", null);
  const reread = async (): Promise<T | null> => {
    const { data } = await supabaseAdmin.from(TABLE).select(columns).eq("org_id", orgId).eq("id", row.id).maybeSingle();
    return (data as unknown as T | null) ?? null;
  };
  let current = (await reread()) ?? row;
  for (let tries = 0; tries < 3 && createCanStillGo(current, now); tries++) {
    let q = supabaseAdmin
      .from(TABLE)
      .update({
        status: "cancelled",
        last_error: NOTE_WORDS.row.takenBackBeforeSent,
        lease_until: null,
        claim_id: null,
        updated_at: iso,
      })
      .eq("org_id", orgId)
      .eq("id", current.id)
      .eq("status", current.status);
    if (current.status === "sending") q = q.lt("lease_until", iso);
    const { data } = await q.select("id");
    current = (await reread()) ?? current;
    if ((data ?? []).length > 0) break;
  }
  return current;
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

/** A queue row as the sender reads it. The note columns are absent on a
    database without the notes migration (dueRows reads files only there). */
export type WriteRow = {
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
  op?: string | null;
  note_id?: string | null;
  depends_on?: string | null;
  target_uuid?: string | null;
  flag_done?: boolean | null;
  seen_edit_date?: string | null;
  seen_edit_by?: string | null;
  note_text?: string | null;
  requested_by?: string | null;
  pressed_at?: string | null;
  next_attempt_at?: string | null;
  taken_back_at?: string | null;
  /* a booking's (read only where the run's kinds include booking) */
  verb_id?: string | null;
  booking_staff_uuid?: string | null;
  booking_start?: string | null;
  booking_end?: string | null;
  booking_zone?: string | null;
  job_status_from?: string | null;
  job_status_to?: string | null;
  landed_edit_date?: string | null;
  /* leave's (read only where the run's kinds include leave) */
  leave_staff_uuid?: string | null;
  leave_start?: string | null;
  leave_end?: string | null;
};

const PHASE0_COLUMNS =
  "id, tenant_id, kind, sm8_job_uuid, subject, payload, remote_uuid, status, attempts, lease_until, replaced_uuids, maybe_landed, verify_uuids, free_retries";

const ROW_COLUMNS = `${PHASE0_COLUMNS}, op, note_id, depends_on, target_uuid, flag_done, seen_edit_date, seen_edit_by, note_text, requested_by, pressed_at, next_attempt_at, taken_back_at`;

/** ROW_COLUMNS and a booking's own — read only when the run's kinds include
    booking, so a files-and-notes run reads exactly ROW_COLUMNS, and a
    database without the bookings migration can never push it into the
    files-only fallback. */
const BOOKING_ROW_COLUMNS = `${ROW_COLUMNS}, verb_id, booking_staff_uuid, booking_start, booking_end, booking_zone, job_status_from, job_status_to, landed_edit_date`;

/** leave's own, read only when the run's kinds include leave */
const LEAVE_COLUMNS = "leave_staff_uuid, leave_start, leave_end";

const isNoteCreate = (r: WriteRow) => r.kind === "note" && (r.op ?? "create") === "create";

/** A row a person can take back before it goes: a note's create, or a
    booking's create or status row. One that is taken back is never
    claimed, and the run cancels it where it stands. */
const takeBackable = (r: WriteRow) =>
  isNoteCreate(r) ||
  (r.kind === "booking" && ((r.op ?? "create") === "create" || r.op === "update")) ||
  (r.kind === "leave" && (r.op ?? "create") === "create");

/** A booking's status row (a Quote made a Work Order). */
const isBookingStatus = (r: WriteRow) => r.kind === "booking" && r.op === "update";

/** In a batch, BOOKING STATUS ROWS GO AHEAD OF EVERY OTHER BOOKING ROW: a
    create never waits behind its own status row and misses the press's
    drain. Stable, and only the bookings' places move — files and notes
    keep theirs. */
function statusRowsFirst(rows: readonly WriteRow[]): WriteRow[] {
  const at = rows.flatMap((r, i) => (r.kind === "booking" ? [i] : []));
  if (at.length < 2) return [...rows];
  const bookings = at.map((i) => rows[i]);
  const ordered = [...bookings.filter(isBookingStatus), ...bookings.filter((r) => !isBookingStatus(r))];
  const out = [...rows];
  at.forEach((i, k) => {
    out[i] = ordered[k];
  });
  return out;
}

/** Rows of the `kinds` ready to go, due now, oldest first: queued ones whose
    wait is over, and sends whose claim lapsed (a worker that died
    mid-request). A database without the notes migration's columns is read
    again with the phase-0 list, files only. `removedNotes` are the notes
    (by id) of the batch's note creates that somebody took back — one read
    of workboard_notes, made only when the batch holds a note create. */
async function dueRows(
  orgId: string,
  now: number,
  kinds: readonly Sm8WriteKind[],
  ids?: readonly string[]
): Promise<{ rows: WriteRow[]; removedNotes: Set<string> }> {
  const iso = new Date(now).toISOString();
  const read = (columns: string, only: readonly string[]) => {
    let q = supabaseAdmin
      .from(TABLE)
      .select(columns)
      .eq("org_id", orgId)
      .in("kind", [...only])
      .in("status", ["queued", "sending"])
      .lte("next_attempt_at", iso);
    if (ids) q = q.in("id", [...ids]);
    return q.order("created_at", { ascending: true }).limit(WRITE_BATCH * 3);
  };
  const withBookings = kinds.includes("booking");
  const withLeave = kinds.includes("leave");
  const base = withBookings ? BOOKING_ROW_COLUMNS : ROW_COLUMNS;
  let { data, error } = await read(withLeave ? `${base}, ${LEAVE_COLUMNS}` : base, kinds);
  /* a database without the leave migration: the other kinds, as today */
  if (withLeave && missingColumn(error as DbError)) {
    kinds = kinds.filter((k) => k !== "leave");
    ({ data, error } = await read(base, kinds));
  }
  /* a database without the bookings migration: the other kinds, as today */
  if (withBookings && missingColumn(error as DbError)) {
    ({ data, error } = await read(
      ROW_COLUMNS,
      kinds.filter((k) => k !== "booking")
    ));
  }
  if (missingColumn(error as DbError)) {
    ({ data, error } = await read(PHASE0_COLUMNS, kinds.filter((k) => k === "attachment")));
  }
  if (error) {
    console.error(`[sm8] couldn't read what is due to go for org ${orgId}:`, error);
    return { rows: [], removedNotes: new Set() };
  }
  const rows = ((data ?? []) as unknown as WriteRow[]).filter(
    (r) => r.status === "queued" || (r.lease_until !== null && Date.parse(r.lease_until) < now)
  );

  const noteIds = [...new Set(rows.filter(isNoteCreate).map((r) => r.note_id).filter((n): n is string => !!n))];
  const removedNotes = new Set<string>();
  if (noteIds.length > 0) {
    const { data: notes, error: notesError } = await supabaseAdmin
      .from("workboard_notes")
      .select("id, removed_at")
      .eq("org_id", orgId)
      .in("id", noteIds);
    if (notesError) {
      /* not knowing is not "removed": the check inside every POST attempt
         reads it again before anything goes */
      console.error(`[sm8] couldn't read whether org ${orgId}'s notes were taken back:`, notesError);
    }
    for (const n of (notes ?? []) as { id: string; removed_at: string | null }[]) {
      if (n.removed_at) removedNotes.add(n.id);
    }
  }
  return { rows, removedNotes };
}

/** A note create somebody took back, never claimed: cancelled in place
    ("Taken back before it went") by an update that matches the row exactly
    as dueRows read it — the same status and attempts, and for a lapsed send
    an expired lease, the condition a claim uses — so it can't take a row a
    sender has just claimed. `maybe_landed` and `verify_uuids` stay as they
    are: the take-back reads them to know what to take out. A note whose
    tombstone is set but whose create isn't closed yet (a Send that raced a
    take-back) is closed first. A miss changes nothing. */
async function cancelTakenBack(orgId: string, row: WriteRow, now: number): Promise<void> {
  const iso = new Date(now).toISOString();
  if (!row.taken_back_at) {
    await supabaseAdmin
      .from(TABLE)
      .update({ taken_back_at: iso })
      .eq("org_id", orgId)
      .eq("id", row.id)
      .is("taken_back_at", null);
  }
  let q = supabaseAdmin
    .from(TABLE)
    .update({
      status: "cancelled",
      last_error: NOTE_WORDS.row.takenBackBeforeSent,
      lease_until: null,
      claim_id: null,
      updated_at: iso,
    })
    .eq("org_id", orgId)
    .eq("id", row.id)
    .eq("attempts", row.attempts);
  q = row.status === "sending" ? q.eq("status", "sending").lt("lease_until", iso) : q.eq("status", "queued");
  const { error } = await q.select("id");
  if (error) console.error(`[sm8] couldn't cancel taken-back note ${row.id} for org ${orgId}:`, error);
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
  /* A NOTE TAKEN BACK IS NEVER CLAIMED, and nor is a booking's create or
     status row: an Undo that lands after dueRows read the row makes this
     miss. File rows are claimed exactly as before (a database without the
     column must still claim files). */
  if (row.kind === "note" || takeBackable(row)) q = q.is("taken_back_at", null);
  const { data } = await q.select("id");
  return (data ?? []).length > 0 ? claimId : null;
}

export type Finish = {
  status: Sm8WriteStatus;
  error: string | null;
  httpStatus: number | null;
  verdict?: WriteVerdict;
  /** ServiceM8 knows the record by this uuid rather than the one we sent:
      its own choice, or an earlier upload the check before this one found.
      For a note, written ONLY FOR A CREATE: an update's or a delete's
      x-record-uuid is someone else's note, and stored it would hide that
      note as one of ours (sm8-echo). */
  remoteUuid?: string;
  /** Uuids this send spent (a note posted under a fresh uuid): remembered
      as ours. */
  replacedUuids?: string[];
  /** The read-back ruled the row's own uuid out, so nothing under it can
      have landed. */
  ownRuledOut?: boolean;
  /** A note: whose ServiceM8 staff uuid it went as, read from the link at
      send time. */
  asStaffUuid?: string;
  /** A take-back or a flag change: the ServiceM8 note it acted on. */
  targetUuid?: string;
  /** A flag change: the edit time our change left on the note. */
  landedEditDate?: string | null;
  /** When a queued row may go again, for a finish with no verdict. */
  retryAfterMs?: number;
  /** What ServiceM8 said, when it refused — kept, never shown. */
  remote?: RemoteError | null;
  /** The uuids still waiting for their check, when the send read some back
      (those it ruled out are gone). Absent: as they were. */
  verifyUuids?: string[];
  /** An upload under the row's uuid went out and got no answer that can be
      trusted — none, a 408, a 5xx, a 409 it couldn't confirm. It may have
      landed. */
  uploadLost?: boolean;
  /** A booking's read-back guard tripped: ServiceM8 kept a booking at
      another time or on someone else, changed more than a job's status, or
      answered a booking OK that two reads can't find (call 15). The run
      switches Bookings off at once (stopBookings) and stops. */
  guard?: boolean;
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
  if (f.status === "queued") {
    patch.next_attempt_at = new Date(now + (f.retryAfterMs ?? f.verdict?.retryAfterMs ?? 0)).toISOString();
  }
  if (f.verifyUuids) patch.verify_uuids = f.verifyUuids;
  if (f.status === "sent") {
    patch.sent_at = iso;
    /* A BOOKING'S TAKE-BACK OR CLEAR THAT WENT KEEPS THE UUIDS IT TOOK OUT
       (each one it DELETEd or read inactive, never one it didn't find):
       they are the overlay's `gone`. Every other row that went waits for
       nothing. */
    patch.verify_uuids = row.kind === "booking" && row.op === "delete" ? (f.verifyUuids ?? []) : [];
  }
  /* What is known about the row's uuid, over the claim's mark: it stays
     marked once any upload under it was lost, until it is sent or spent. It
     is worked out from the row AS READ BEFORE THE CLAIM, so a note whose
     POST never went (taken back first, say) reads as never landed. */
  const spent = f.status === "sent" || f.verdict?.freshUuid === true;
  const before = f.ownRuledOut ? false : row.maybe_landed === true;
  patch.maybe_landed = spent ? false : before || f.uploadLost === true;
  /* KEYED ON THE OP, NOT THE KIND: only a create names a record of its own.
     A status change's or a take-back's x-record-uuid is someone else's
     record (a job, a booking), and stored it would read as one of ours. A
     file is always a create. */
  const creates = (row.op ?? "create") === "create";
  let replacedNow = replaced;
  if (f.replacedUuids && f.replacedUuids.length > 0 && creates) {
    replacedNow = [...new Set([...replaced, ...f.replacedUuids])];
    patch.replaced_uuids = replacedNow;
  }
  if (f.remoteUuid && creates) {
    patch.remote_uuid = f.remoteUuid;
    /* an earlier uuid found in ServiceM8 is the record now, not a spent one */
    if (replacedNow.includes(f.remoteUuid)) patch.replaced_uuids = replacedNow.filter((u) => u !== f.remoteUuid);
  }
  if (f.verdict?.freshUuid) {
    patch.remote_uuid = randomUUID();
    patch.replaced_uuids = [...new Set([...replacedNow, row.remote_uuid])];
  }
  if (f.verdict?.freeRetry) patch.free_retries = (row.free_retries ?? 0) + 1;
  if (f.asStaffUuid) patch.as_staff_uuid = f.asStaffUuid;
  const noteOrBooking = row.kind === "note" || row.kind === "booking";
  if (f.targetUuid && noteOrBooking && row.op === "delete") patch.target_uuid = f.targetUuid;
  if (f.landedEditDate !== undefined && noteOrBooking) patch.landed_edit_date = f.landedEditDate;

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
       spent, and waits what the limit asks: the record under our uuid is
       still there to confirm next time */
    if (!check.ok && check.limited) outcome = check.limited;
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
  t: { claimedAt: number; clock: () => number; sleep?: (ms: number) => Promise<void>; track?: { wrote: boolean } }
): Promise<{ finish: Finish; access: Sm8Access | null }> {
  /* the reconnect accident with writes in it: never another account */
  if (row.tenant_id !== state.tenantId) {
    return { finish: { status: "cancelled", error: WRITE_WORDS.otherAccount, httpStatus: null }, access };
  }
  /* a note is its own engine (sm8-note-send): as a person, with read-backs
     and take-backs. So is a booking (sm8-booking-send): as the app, read
     live before every change and read back after it. Files go on exactly
     as before. */
  if (row.kind === "note") return sendNoteRow(orgId, state, row, attempts, access, t);
  if (row.kind === "booking") return sendBookingRow(orgId, state, row, attempts, access, t);
  if (row.kind === "leave") return sendLeaveRow(orgId, state, row, attempts, access, t);
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
        /* the account's limit had no room: handed back for as long as the
           limit asks, the check kept for next time; any other failed read
           spends the attempt as before */
        const unread = fromVerdict(verdictFor(check.limited ?? { kind: "unavailable", status: null }, attempts, ctx()));
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
    4b. a kind the owner switched off (Files, Notes, Bookings): cancel that
       kind's waiting rows, in its words — paused or not;
    5. no account named: stop;
    6. paused: hold, cancel nothing;
    7. On with a grant that doesn't work: stop for the reconnect;
    8. no kind ready (switched on, permission held): stop, holding them.

    AND AGAIN BEFORE EVERY CLAIM AFTER A SEND, AND BEFORE EVERY NOTE OR
    BOOKING. Pause changes no row, so a run already going when the owner
    presses it would carry on claiming on the setting it started with; the
    switch and the account are read again (one row), and a run whose setting
    or account has moved stops there. A row whose kind isn't ready in the
    fresh reading is skipped, not claimed: Notes Off stops the notes,
    Bookings Off the bookings, and files go on.

    BOOKINGS (two-way phase 3) keep three more rules here:
    - in a batch, a booking's status row goes ahead of every other booking
      row (statusRowsFirst);
    - a status row that finishes sent brings its bookings: its queued
      creates are due at once and join this run right behind it
      (bringBookings), within the batch;
    - a read-back guard that tripped switches Bookings off at once
      (stopBookings), and the run stops.

    `sleep` is how long a booking's second read-back waits (about 2 s, U23);
    a test hands in one that moves its clock instead. */
export async function runSm8Writes(
  orgId: string,
  trigger: Sm8WriteTrigger,
  opts: { ids?: readonly string[]; budgetMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}
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
  /* 4b. A KIND THE OWNER SWITCHED OFF: what of it is still waiting never
     goes — a row queued by a press that read the state just before the
     Off, say. Before the pause, so a straggler is cancelled while paused
     too. None unless the deployment allows a kind the owner has off, so a
     files-only deployment with files on makes no query here. */
  for (const kind of kindsSwitchedOff(state)) {
    await cancelWaitingSm8Writes(orgId, kindSwitchedOffWords(kind), started, { kind });
  }
  if (!state.tenantId) return { ...NONE, stopped: "ServiceM8 isn't connected." };
  if (state.mode === "paused") return { ...NONE, stopped: WRITE_WORDS.paused };
  const live = state.mode === "live";
  if (live && !state.connected) return { ...NONE, stopped: WRITE_WORDS.reauth };
  const ready = state.kinds.filter((k) => kindReady(state, k));
  if (ready.length === 0) {
    /* files alone allowed: exactly today's words */
    if (state.kinds.length === 1 && state.kinds[0] === "attachment") return { ...NONE, stopped: WRITE_WORDS.scopeHeld };
    const anyOn = state.kinds.some((k) => state.ownerKinds.includes(k));
    /* bookings allowed: their own words for every kind; otherwise files
       and notes as today */
    if (state.kinds.includes("booking")) {
      return { ...NONE, stopped: anyOn ? BOOKING_WORDS.kindWords.heldAny : BOOKING_WORDS.kindWords.offAll };
    }
    return { ...NONE, stopped: anyOn ? NOTE_WORDS.kindWords.heldAll : NOTE_WORDS.kindWords.allOff };
  }

  const { rows: due, removedNotes } = await dueRows(orgId, started, ready, opts.ids);
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
  /* the batch, a booking's status rows first; a sent status row's bookings
     join it behind that row, so it is walked by index */
  const batch = statusRowsFirst(due);
  const walked = new Set<string>();
  for (let at = 0; at < batch.length; at++) {
    const row = batch[at];
    if (run.done >= WRITE_BATCH) break;
    walked.add(row.id);
    const note = row.kind === "note";
    const booking = row.kind === "booking";
    const leave = row.kind === "leave";
    /* A NOTE TAKEN BACK IS CANCELLED, NEVER CLAIMED: its create closed by an
       Undo, or its note's tombstone set by a take-back that raced a Send
       (whose create is closed here first). No request goes. So is a
       booking's create or status row that its presser took back. */
    if (isNoteCreate(row) && (row.taken_back_at || (row.note_id && removedNotes.has(row.note_id)))) {
      await cancelTakenBack(orgId, row, clock());
      continue;
    }
    if ((booking || leave) && takeBackable(row) && row.taken_back_at) {
      await cancelTakenBack(orgId, row, clock());
      continue;
    }
    /* Before a NOTE or a BOOKING the switch is read again every time, not
       only after a send: Notes Off or Bookings Off, or a kind's permission
       refused, stops a run already going from claiming another of it, while
       files behind it still go. */
    if (sentSinceRead || note || booking || leave) {
      const moved = await switchMoved(orgId, state);
      if (typeof moved === "string") {
        run.stopped = moved;
        break;
      }
      current = moved;
      sentSinceRead = false;
    }
    /* a kind that isn't ready now (switched off, refused since) is skipped */
    if (!kindReady(current, row.kind as Sm8WriteKind)) continue;
    /* the budget is checked last, right before the claim it bounds */
    if (opts.budgetMs !== undefined && clock() - started > opts.budgetMs) break;
    const claimedAt = clock();
    const claimId = await claim(orgId, row, claimedAt, live);
    if (!claimId) continue;
    sentSinceRead = true;

    let f: Finish;
    /* a booking's sender marks the moment a POST or a DELETE starts */
    const track = { wrote: false };
    try {
      const sent = await sendOne(orgId, current, row, row.attempts + 1, access, { claimedAt, clock, sleep: opts.sleep, track });
      f = sent.finish;
      access = sent.access;
    } catch (err) {
      /* nothing above should throw; if something does, the row is not left
         claimed until its lease lapses — and, not knowing whether an upload
         went, a live send keeps its uuid marked as maybe landed. A booking
         knows: only one whose POST or DELETE started is marked, and one
         that threw before any is a plain retry. Each kind says it in its
         own words. */
      console.error(`[sm8] write ${row.id} (${trigger}) threw: ${err instanceof Error ? err.message : String(err)}`);
      f = {
        ...fromVerdict(verdictForUnreadable(row.attempts + 1, note ? "note" : booking ? "booking" : leave ? "leave" : "attachment")),
        uploadLost: booking || leave ? track.wrote : live,
      };
    }
    const landed = await finish(orgId, row, claimId, f, clock());

    /* A READ-BACK GUARD THAT TRIPPED switches Bookings off at once, landed
       or not — what ServiceM8 kept is a fact about the account, whoever
       recorded the row — and its verdict stops the run below. */
    if (booking && f.guard) await stopBookings(orgId, row.sm8_job_uuid, clock());

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
    /* A PERSON'S REFUSAL (a note that goes as someone whose ServiceM8 login
       can't do this) is theirs, not the account's: it never counts */
    if (!f.verdict?.personal) refusedInARow = f.httpStatus === 403 && !f.verdict?.blockKind ? refusedInARow + 1 : 0;
    if (refusedInARow >= 2) {
      run.stopped = WRITE_WORDS.forbidden;
      break;
    }
    /* A SENT STATUS ROW BRINGS ITS BOOKINGS: they are due at once, and go
       right behind it in this run, within the batch. */
    if (landed && isBookingStatus(row) && f.status === "sent") {
      const behind = await bringBookings(orgId, row.id, clock());
      const fresh = behind.filter((r) => !walked.has(r.id));
      const ids = new Set(fresh.map((r) => r.id));
      /* one already in the batch is moved up behind it, never added twice */
      const rest = batch.slice(at + 1).filter((r) => !ids.has(r.id));
      batch.splice(at + 1, batch.length - at - 1, ...fresh, ...rest);
    }
  }
  return run;
}

/** A status row just sent: its queued bookings are due now (the next run
    takes any this one has no room for) and come back to join this run,
    read with a booking's columns. Only bookings that could go: queued, or a
    send whose claim lapsed, and not taken back. A read that fails brings
    none, logged: they go on their own time, or with the next press. */
async function bringBookings(orgId: string, statusRowId: string, now: number): Promise<WriteRow[]> {
  const iso = new Date(now).toISOString();
  const { error: dueError } = await supabaseAdmin
    .from(TABLE)
    .update({ next_attempt_at: iso })
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("depends_on", statusRowId)
    .eq("status", "queued")
    .is("taken_back_at", null);
  if (dueError) console.error(`[sm8] couldn't bring forward the bookings behind status row ${statusRowId}:`, dueError);
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(BOOKING_ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("depends_on", statusRowId)
    .in("status", ["queued", "sending"])
    .order("created_at", { ascending: true })
    .limit(WRITE_BATCH);
  if (error) {
    console.error(`[sm8] couldn't read the bookings behind status row ${statusRowId}:`, error);
    return [];
  }
  return ((data ?? []) as unknown as WriteRow[]).filter(
    (r) => !r.taken_back_at && (r.status === "queued" || (r.lease_until !== null && Date.parse(r.lease_until) < now))
  );
}

/** A read-back guard tripped (the spec's call 9, and call 15): Bookings is
    switched off at once, and every booking row still waiting is cancelled
    in the guard's words, naming the job. It asks twice before it gives up,
    because a Bookings that stays on after a guard would send the next
    booking into the same trouble. */
async function stopBookings(orgId: string, jobUuid: string | null, now: number): Promise<void> {
  let number: string | null = null;
  if (jobUuid) {
    /* the mirror's job, whatever case it spells the uuid in */
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id")
      .eq("org_id", orgId)
      .in("uuid", [...new Set([jobUuid, jobUuid.toLowerCase(), jobUuid.toUpperCase()])]);
    const job = ((data ?? []) as { uuid: string; generated_job_id?: unknown }[]).find((j) => j.uuid.toLowerCase() === jobUuid.toLowerCase());
    const g = job?.generated_job_id;
    number = typeof g === "string" && g.trim() ? g.trim() : null;
  }
  const reason = fillWords(BOOKING_WORDS.row.guardStopped, { number: number ?? (jobUuid ?? "").slice(0, 8) });
  for (let tries = 0; tries < 2; tries++) {
    const off = await setSm8WriteKind(orgId, "booking", false, now, { reason });
    if (off.ok) {
      console.warn(`[sm8] bookings stopped by a guard for org ${orgId} (job ${number ?? jobUuid})`);
      return;
    }
  }
  console.error(`[sm8] a booking guard tripped for org ${orgId}, and Bookings couldn't be switched off`);
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
  /** A file, a note or a booking. */
  kind: Sm8WriteKind;
  /** The file's name as it went; a note's label ("Reply", "Done."), never
      its words; a booking's label ("Booking", "Quote made a Work Order"). */
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

/* never note_text: the owner's list names a note by its label */
const RECENT_COLUMNS = "id, kind, sm8_job_uuid, payload, status, attempts, last_error, updated_at, requested_by";

type RecentRow = {
  id: string;
  kind?: string;
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
    const kind: Sm8WriteKind = r.kind === "note" ? "note" : r.kind === "booking" ? "booking" : r.kind === "leave" ? "leave" : "attachment";
    const fallback =
      kind === "note"
        ? NOTE_WORDS.label.fallback
        : kind === "booking"
          ? BOOKING_WORDS.label.fallback
          : kind === "leave"
            ? LEAVE_WORDS.label.fallback
            : "A file";
    return {
      id: r.id,
      kind,
      name: typeof p.name === "string" && p.name ? p.name : fallback,
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
): Promise<{ waiting: number; failed: number; waitingKinds: { attachment: number; note: number; booking: number; leave: number } }> {
  const [waitingKinds, failed] = await Promise.all([
    /* per kind only where the deployment sends more than files; otherwise
       today's one count, every row of it a file */
    countWaitingSm8WritesByKind(orgId, now),
    /* what Retry failed files can take: files only */
    tenantId
      ? supabaseAdmin
          .from(TABLE)
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("tenant_id", tenantId)
          .eq("kind", "attachment")
          .eq("status", "failed")
      : Promise.resolve({ count: 0, error: null }),
  ]);
  return {
    waiting: waitingKinds.attachment + waitingKinds.note + waitingKinds.booking + waitingKinds.leave,
    failed: failed.error ? 0 : failed.count ?? 0,
    waitingKinds,
  };
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
export type Sm8QueueStuck = {
  reason: "cap" | "billing" | "reconnect";
  waiting: number;
  /** The same, kind by kind (all files where only files are sent). */
  kinds: { attachment: number; note: number; booking: number; leave: number };
};

export async function sm8QueueStuck(orgId: string, now: number = Date.now()): Promise<Sm8QueueStuck | null> {
  if (!sm8WritesEnabled()) return null;
  const state = await readSm8WriteState(orgId);
  if (!state.readable || !state.linked) return null;
  const counted = async () => {
    const kinds = await countWaitingSm8WritesByKind(orgId, now);
    return { waiting: kinds.attachment + kinds.note + kinds.booking + kinds.leave, kinds };
  };
  if (state.mode === "paused" && state.pausedReason === "cap") return { reason: "cap", ...(await counted()) };
  if (state.mode !== "live") return null;
  const { waiting, kinds } = await counted();
  if (waiting === 0) return null;
  const { count, error } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "queued")
    .eq("last_error", WRITE_WORDS.billing);
  if (!error && (count ?? 0) > 0) return { reason: "billing", waiting, kinds };
  /* only the kinds the owner has on: a kind switched off never asks for a
     reconnect */
  const on = state.kinds.filter((k) => state.ownerKinds.includes(k));
  if (!state.connected || on.some((k) => !kindReady(state, k))) return { reason: "reconnect", waiting, kinds };
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
