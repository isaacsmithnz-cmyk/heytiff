/* Sending ONE note row to ServiceM8 — server only (two-way phase 2, PR A).

   sm8-writes' sendOne hands every `note` row here, after its account check
   and under its claim, and records whatever Finish comes back. Only TYPES
   come from sm8-writes, so there is no import cycle.

   A NOTE GOES AS THE PERSON WHO PRESSED IT (x-impersonate-uuid). So before
   anything goes, in this order, with no request made:
   1. THE PERSON: their link, their confirmation and whether ServiceM8 has
      them active, read again now (links' sm8NoteSender). `unknown` waits a
      minute; `bad_link` fails for good; anything else but `ready` fails the
      row with its words. A take-back's person is checked here too.
   2. THE OBJECT: a create or a flag change needs its job (or claim) active
      in the mirror.
   3. THE WORDS: a create whose words were cleared never goes.
   4. A TAKE-BACK'S OWN WORK: only its create's presser, only in its
      create's account; the create is stopped if it could still go (a send
      under a live claim is waited out, never overtaken); and what may be in
      ServiceM8 is worked out. Nothing to take out ends it.
   5. A TRIAL RUN STOPS HERE.

   EVERY REQUEST CHECKS ITS ACCOUNT (tokenMismatch, as the file sender's
   postOne does) before any read-back and again INSIDE every function
   handed to withSm8Renewal, so the request after a renewal — whose token
   is whatever account is connected NOW — can never act in another one: a
   mismatch comes back as its Finish, and nothing is fetched.

   A CREATE'S LAST CHECK IS PART OF ITS CALL. Inside every POST attempt,
   the one after a token renewal included, the row's taken_back_at and its
   note's removed_at are read (one database read, no ServiceM8 call between
   it and the POST). An Undo that lands during a 401, a confirmDead read or
   a renewal stops the second POST.

   A LOST ANSWER IS READ BACK BEFORE ANYTHING GOES AGAIN, and a uuid of ours
   found inactive means a PERSON REMOVED THE NOTE: it ends there, never
   posted again. Where HeyTiff can't tell (READBACK_SEES_INACTIVE false),
   nothing is posted and the person decides. */

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { sm8NoteSender } from "./links";
import { withSm8Renewal, type ConfirmDead, type Renewed } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import {
  deleteSm8Note,
  postSm8Note,
  readSm8Note,
  updateSm8NoteCompleter,
  type Sm8NoteCheck,
  type Sm8NoteResult,
} from "./sm8-write";
import {
  createCanStillGo,
  deleteTargets,
  fillWords,
  isDoneSubject,
  leaseLive,
  NOTE_WORDS,
  READBACK_SEES_INACTIVE,
  sameEditDate,
  type CreateRow,
} from "./sm8-note-plan";
import {
  DONE_TTL_MS,
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  verdictFor,
  verdictForAccountUnknown,
  verdictForCheckFailed,
  verdictForDisconnected,
  verdictForLetGo,
  verdictForLinkUnknown,
  verdictForLoginUnchecked,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForStale,
  verdictForUnreadable,
  verdictForWaitingOn,
  WRITE_WORDS,
  type Sm8WriteOp,
  type Sm8WriteOutcome,
  type Sm8WriteState,
  type Sm8WriteStatus,
  type VerdictContext,
  type WriteVerdict,
} from "./sm8-write-plan";
import type { Sm8Access } from "./sm8-store";
import type { Finish, WriteRow } from "./sm8-writes";

const TABLE = "sm8_writes";

type Sent = { finish: Finish; access: Sm8Access | null };

/** A read-back that answered. */
type ReadNote = Extract<Sm8NoteCheck, { ok: true }>;

const done = (status: Sm8WriteStatus, error: string | null, extra: Partial<Finish> = {}): Finish => ({
  status,
  error,
  httpStatus: null,
  ...extra,
});

const fromVerdict = (v: WriteVerdict, httpStatus: number | null = null): Finish => ({
  status: v.status,
  error: v.error,
  httpStatus,
  verdict: v,
});

/** The file sender's tokenMismatch, for a note: a token that isn't for the
    row's account carries nothing — cancelled when it names another account,
    held when it names none. Null when it fits. */
function tokenMismatch(row: Pick<WriteRow, "tenant_id">, access: Sm8Access): Finish | null {
  if (access.tenantId === row.tenant_id) return null;
  if (access.tenantId === null) return fromVerdict(verdictForAccountUnknown());
  return done("cancelled", WRITE_WORDS.otherAccount);
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

const UNAVAILABLE: Sm8WriteOutcome = { kind: "unavailable", status: null };

/** What a renewal that didn't come back `ok` makes of the row. Null for
    `ok`: the caller reads the result. */
function renewalFinish<T>(out: Renewed<T>, httpStatus: number | null): Finish | null {
  switch (out.verdict) {
    case "unreachable":
      return fromVerdict(verdictForRenewUnreachable(), httpStatus);
    case "gone":
      return fromVerdict(verdictForDisconnected(), httpStatus);
    case "late":
      return fromVerdict(verdictForRenewLate(), httpStatus);
    case "unconfirmed":
      return fromVerdict(verdictForLoginUnchecked(), httpStatus);
    case "dead":
      /* refused twice, a token apart, and a plain read refused too: the
         grant, already flagged by the renewal. Waits for the reconnect. */
      return fromVerdict(verdictFor({ kind: "unauthorized" }, 0), httpStatus);
    default:
      return null;
  }
}

export async function sendNoteRow(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  access: Sm8Access | null,
  t: { claimedAt: number; clock: () => number }
): Promise<Sent> {
  const op: Sm8WriteOp = row.op === "update" || row.op === "delete" ? row.op : "create";
  const out = await sendNote(orgId, state, row, op, attempts, access, t);
  /* a person's words carry their name, baked in at send time */
  if (out.finish.error && /\{(name|sm8Name)\}/.test(out.finish.error)) {
    const who = row.requested_by ? await staffDisplayNames(orgId, [row.requested_by]).catch(() => new Map()) : new Map();
    out.finish = {
      ...out.finish,
      error: fillWords(out.finish.error, {
        name: (row.requested_by && who.get(row.requested_by)) || "The person who pressed it",
      }),
    };
  }
  return out;
}

async function sendNote(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  op: Sm8WriteOp,
  attempts: number,
  given: Sm8Access | null,
  t: { claimedAt: number; clock: () => number }
): Promise<Sent> {
  let access = given;
  const ctx = (): VerdictContext => ({
    now: t.clock(),
    timezoneName: state.timezoneName,
    freeRetries: row.free_retries ?? 0,
    kind: "note",
    op,
  });
  const elapsed = () => t.clock() - t.claimedAt;
  const readInTime = () => elapsed() < NOTE_READ_BY_MS;
  const sendInTime = () => elapsed() < NOTE_SEND_BY_MS;
  const letGo = (): Finish => fromVerdict(verdictForLetGo(row.free_retries ?? 0, "note"));
  const requeue = (): Finish => fromVerdict(verdictForUnreadable(attempts, "note"));

  /* ── 1. the person ── */
  const sender = await sm8NoteSender(orgId, row.requested_by ?? null, row.tenant_id);
  if (sender.state === "unknown") return { finish: fromVerdict(verdictForLinkUnknown(NOTE_WORDS.row.unknown)), access };
  if (sender.state === "bad_link") return { finish: done("failed", NOTE_WORDS.row.badLink), access };
  if (sender.state !== "ready") {
    const words =
      sender.state === "unlinked"
        ? sender.noCard
          ? NOTE_WORDS.row.noCard
          : NOTE_WORDS.row.unlinked
        : sender.state === "confirm"
          ? NOTE_WORDS.row.unconfirmed
          : sender.state === "denied"
            ? NOTE_WORDS.row.denied
            : fillWords(NOTE_WORDS.row.inactive, { sm8Name: sender.sm8Name });
    return { finish: done("failed", words), access };
  }
  const as = sender.staffUuid;

  /* ── 2. the object ── */
  if (op !== "delete") {
    if (!row.sm8_job_uuid) return { finish: done("cancelled", NOTE_WORDS.row.jobGone, { asStaffUuid: as }), access };
    const { data: job, error: jobError } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid")
      .eq("org_id", orgId)
      .eq("uuid", row.sm8_job_uuid)
      .eq("active", 1)
      .maybeSingle();
    if (jobError) return { finish: requeue(), access };
    if (!job) return { finish: done("cancelled", NOTE_WORDS.row.jobGone, { asStaffUuid: as }), access };
  }

  /* ── 3. the words ── */
  if (op === "create" && !row.note_text) {
    return { finish: done("cancelled", NOTE_WORDS.row.noteWordsCleared, { asStaffUuid: as }), access };
  }

  /* ── 4. a take-back's own work, before the trial stop ── */
  let targets: string[] = [];
  if (op === "delete") {
    const settled = await settleCreate(orgId, row, t.clock);
    if ("finish" in settled) return { finish: { ...settled.finish, asStaffUuid: as }, access };
    targets = settled.targets;
  }

  /* ── 5. a trial run goes this far and no further ── */
  const live = state.mode === "live" && access !== null ? access : null;
  if (!live) return { finish: done("trial", null, { asStaffUuid: as }), access };
  access = live;

  /* a plain, un-impersonated read under `a`: is the GRANT alive? */
  const confirmDead: ConfirmDead = async (a) => {
    if (!readInTime()) return "unsure";
    const probe = row.target_uuid ?? row.remote_uuid;
    const r = await readSm8Note(sm8CallOf(a, "write"), probe).catch(() => ({ ok: false }) as Sm8NoteCheck);
    if (r.ok) return "alive";
    return "unauthorized" in r && r.unauthorized ? "dead" : "unsure";
  };

  /** One read-back, the account asking, renewed once on a 401. */
  const readBack = async (uuid: string): Promise<{ check: ReadNote } | { finish: Finish }> => {
    if (!readInTime()) return { finish: letGo() };
    const wrong = tokenMismatch(row, access!);
    if (wrong) return { finish: wrong };
    const got = await withSm8Renewal<{ check?: Sm8NoteCheck; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        return { check: await readSm8Note(sm8CallOf(a, "write"), uuid) };
      },
      (r) => !!r.check && !r.check.ok && r.check.unauthorized === true,
      { retry: readInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const check = got.result.check!;
    if (!check.ok) return { finish: fromVerdict(verdictFor(check.limited ?? UNAVAILABLE, attempts, ctx())) };
    return { check };
  };

  /** One impersonated request, renewed once on a 401 whose grant a plain
      read can't vouch for. `before` runs inside every attempt, after the
      account check; a Finish from it goes back without a request. */
  const writeAs = async (
    request: (a: Sm8Access) => Promise<Sm8NoteResult>,
    before?: () => Promise<Finish | null>
  ): Promise<{ res: Sm8NoteResult } | { finish: Finish }> => {
    const got = await withSm8Renewal<{ res?: Sm8NoteResult; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        const stop = before ? await before() : null;
        if (stop) return { finish: stop };
        return { res: await request(a) };
      },
      (r) => r.res?.outcome.kind === "unauthorized",
      { retry: sendInTime, confirmDead }
    );
    access = got.access;
    const renewal = renewalFinish(got, got.result.res?.status ?? null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const res = got.result.res!;
    /* refused as this person, with a token a plain read vouches for: their
       login can't do this. Theirs alone — never the connection's. */
    if (res.outcome.kind === "unauthorized") {
      return { finish: done("failed", NOTE_WORDS.row.personForbidden, { httpStatus: 401, verdict: personalVerdict() }) };
    }
    return { res };
  };

  if (op === "delete") return { finish: await sendDelete(), access };
  if (op === "update") return { finish: await sendUpdate(), access };
  return { finish: await sendCreate(), access };

  /* ── a take-back ── */
  async function sendDelete(): Promise<Finish> {
    for (const target of targets) {
      if (!sendInTime()) return { ...letGo(), asStaffUuid: as };
      const sent = await writeAs((a) => deleteSm8Note(sm8CallOf(a, "write"), target, as));
      if ("finish" in sent) return { ...sent.finish, asStaffUuid: as };
      const { res } = sent;
      /* gone now, or gone already */
      if (res.outcome.kind === "created" || res.status === 404) continue;
      return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), remote: res.remote, asStaffUuid: as };
    }
    return done("sent", null, { asStaffUuid: as, targetUuid: targets[0] });
  }

  /* ── a flag marked done, or its mark taken off ── */
  async function sendUpdate(): Promise<Finish> {
    const target = row.target_uuid;
    if (!target) return done("cancelled", NOTE_WORDS.row.noteGone, { asStaffUuid: as });
    const wantDone = row.flag_done === true;
    const asWanted = (completedBy: string | null) => (wantDone ? !!completedBy : !completedBy);

    const first = await readBack(target);
    if ("finish" in first) return { ...first.finish, asStaffUuid: as };
    const live = first.check;
    if (!live.found || !live.active) return done("cancelled", NOTE_WORDS.row.noteGone, { asStaffUuid: as, targetUuid: target });

    /* somebody changed the note since it was seen: never over their edit */
    const ours = await latestLandedFlag(orgId, target, row.id);
    if (ours.failed) return { ...requeue(), asStaffUuid: as };
    const seen = sameEditDate(live.editDate, row.seen_edit_date ?? null);
    const left = ours.landed !== null && sameEditDate(live.editDate, ours.landed);
    if (!seen && !left) return done("cancelled", NOTE_WORDS.row.changed, { asStaffUuid: as, targetUuid: target });

    if (asWanted(live.completedBy)) {
      return done("sent", null, { asStaffUuid: as, targetUuid: target, landedEditDate: live.editDate });
    }
    if (!sendInTime()) return { ...letGo(), asStaffUuid: as };
    const sent = await writeAs((a) => updateSm8NoteCompleter(sm8CallOf(a, "write"), target, wantDone ? as : "", as));
    if ("finish" in sent) return { ...sent.finish, asStaffUuid: as };
    const { res } = sent;
    /* the note is gone: a cancel built here, never a verdict */
    if (res.status === 404) {
      return done("cancelled", NOTE_WORDS.row.noteGone, { httpStatus: 404, asStaffUuid: as, targetUuid: target });
    }
    if (res.outcome.kind !== "created") {
      return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), remote: res.remote, asStaffUuid: as };
    }
    /* the 2xx stands; the read-back says whether ServiceM8 kept it */
    const after = readInTime() ? await readBack(target) : null;
    if (!after || "finish" in after || !after.check.ok || !after.check.found) {
      return done("sent", null, { httpStatus: res.status, asStaffUuid: as, targetUuid: target, landedEditDate: null });
    }
    if (!asWanted(after.check.completedBy)) {
      return done("failed", NOTE_WORDS.row.notKept, { httpStatus: res.status, asStaffUuid: as, targetUuid: target });
    }
    return done("sent", null, {
      httpStatus: res.status,
      asStaffUuid: as,
      targetUuid: target,
      landedEditDate: after.check.editDate,
    });
  }

  /* ── a note put on a job ── */
  async function sendCreate(): Promise<Finish> {
    const jobUuid = row.sm8_job_uuid!;
    let verify = [...(row.verify_uuids ?? [])];
    let postUuid = row.remote_uuid;
    const replaced: string[] = [];
    let ownRuledOut = false;
    let unsure = false;

    /* READ BACK FIRST: our own uuid when an answer under it was lost, then
       each older uuid still waiting for its check */
    const toRead = [...(row.maybe_landed ? [row.remote_uuid] : []), ...verify.filter((u) => u !== row.remote_uuid)];
    for (const uuid of toRead) {
      const own = uuid === row.remote_uuid;
      const got = await readBack(uuid);
      if ("finish" in got) return { ...got.finish, verifyUuids: verify, asStaffUuid: as };
      const check = got.check;
      if (check.ok && check.found && same(check.relatedUuid, jobUuid)) {
        if (check.active) return done("sent", null, { remoteUuid: uuid, verifyUuids: [], asStaffUuid: as });
        /* inactive: a PERSON REMOVED IT. Never posted again. */
        return done("cancelled", NOTE_WORDS.row.noteGone, { verifyUuids: verify, asStaffUuid: as });
      }
      if (check.ok && check.found) {
        /* on another object: that uuid is spent, and not this note */
        verify = verify.filter((u) => u !== uuid);
        if (own) {
          replaced.push(row.remote_uuid);
          postUuid = randomUUID();
          ownRuledOut = true;
        }
        continue;
      }
      /* not there */
      if (!own) {
        /* an old uuid a person pressed past with Send again */
        verify = verify.filter((u) => u !== uuid);
        continue;
      }
      if (READBACK_SEES_INACTIVE) {
        /* never landed: the POST goes under the same uuid */
        ownRuledOut = true;
        continue;
      }
      /* "never landed" can't be told from "landed, and a person removed
         it": nothing goes by itself, and the person decides */
      unsure = true;
    }
    const kept = { verifyUuids: verify, asStaffUuid: as, ownRuledOut };
    if (unsure) return done("failed", NOTE_WORDS.row.noteUnsure, kept);

    /* THE DAY-OLD RULE, after the read-back: a Done found landed is sent */
    if (isDoneSubject(row.subject) && row.pressed_at) {
      const pressed = Date.parse(row.pressed_at);
      if (!Number.isNaN(pressed) && t.clock() - pressed > DONE_TTL_MS) return { ...fromVerdict(verdictForStale()), ...kept };
    }

    if (!sendInTime()) return { ...letGo(), ...kept };
    const fresh = postUuid !== row.remote_uuid ? { remoteUuid: postUuid, replacedUuids: replaced } : {};

    /* THE LAST CHECK IS PART OF THE CALL, in every attempt */
    let takenBack = false;
    const stillWanted = async (): Promise<Finish | null> => {
      const check = await createStillWanted(orgId, row, t.clock);
      if (check === "go") return null;
      if (check === "taken_back") {
        takenBack = true;
        return done("cancelled", NOTE_WORDS.row.takenBackBeforeSent, kept);
      }
      return { ...fromVerdict(verdictForCheckFailed()), ...kept };
    };
    const sent = await writeAs(
      (a) => postSm8Note(sm8CallOf(a, "write"), { relatedUuid: jobUuid, uuid: postUuid, text: row.note_text!, asStaffUuid: as }),
      stillWanted
    );
    if ("finish" in sent) {
      /* taken back before it went: nothing was posted by this attempt (a
         first attempt refused with 401 posted nothing either) */
      if (takenBack) return sent.finish;
      return { ...sent.finish, ...kept, ...fresh };
    }
    const { res } = sent;
    const base = { ...kept, ...fresh, remote: res.remote };

    if (res.outcome.kind === "created") {
      /* a 2xx under a uuid that isn't ours: ours is read back first */
      if (res.recordUuid && !same(res.recordUuid, postUuid) && readInTime()) {
        const ours = await readBack(postUuid);
        const found = !("finish" in ours) && ours.check.ok && ours.check.found && same(ours.check.relatedUuid, jobUuid);
        return done("sent", null, { ...base, httpStatus: res.status, remoteUuid: found ? postUuid : res.recordUuid });
      }
      return done("sent", null, {
        ...base,
        httpStatus: res.status,
        remoteUuid: res.recordUuid && !same(res.recordUuid, postUuid) ? res.recordUuid : postUuid,
      });
    }

    if (res.status === 400 || res.status === 409) {
      /* refused, or a clash: is ours there after all? */
      const ours = readInTime() ? await readBack(postUuid) : null;
      if (!ours || "finish" in ours) {
        /* couldn't tell: it may have landed, and the next go reads it back */
        const why = ours && "finish" in ours ? ours.finish : fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx()));
        return { ...why, ...base, uploadLost: true };
      }
      const c = ours.check;
      if (c.ok && c.found && same(c.relatedUuid, jobUuid)) {
        if (c.active) return done("sent", null, { ...base, httpStatus: res.status, remoteUuid: postUuid });
        return done("cancelled", NOTE_WORDS.row.noteGone, { ...base, httpStatus: res.status });
      }
      return done("failed", NOTE_WORDS.row.noteRefused, { ...base, httpStatus: res.status });
    }

    const verdict = verdictFor(res.outcome, attempts, ctx());
    /* the POST went and nothing trustworthy came back: no answer, a 408 or
       ServiceM8's own trouble. It may have landed. */
    const uploadLost = res.outcome.kind === "unavailable";
    return { ...fromVerdict(verdict, res.status), ...base, uploadLost };
  }

  function personalVerdict(): WriteVerdict {
    return { ...verdictFor({ kind: "forbidden", scope: false }, attempts, ctx()), error: NOTE_WORDS.row.personForbidden };
  }
}

/* ── the database reads a note send makes ── */

type CreateRead = CreateRow & { tenant_id: string; attempts: number };

const CREATE_COLUMNS = "id, tenant_id, requested_by, status, lease_until, remote_uuid, maybe_landed, verify_uuids, taken_back_at, attempts, last_error";

/** A take-back's step 4: its presser and account against its create's, the
    create stopped if it could still go, and what of it may be in
    ServiceM8. Every Finish here is built here, never a verdict (but the
    wait for a live claim). */
async function settleCreate(
  orgId: string,
  row: WriteRow,
  clock: () => number
): Promise<{ targets: string[] } | { finish: Finish }> {
  const read = async (): Promise<CreateRead | null | "failed"> => {
    if (!row.depends_on) return null;
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select(CREATE_COLUMNS)
      .eq("org_id", orgId)
      .eq("id", row.depends_on)
      .maybeSingle();
    if (error) return "failed";
    return (data as unknown as CreateRead | null) ?? null;
  };

  for (let tries = 0; tries < 3; tries++) {
    const create = await read();
    if (create === "failed") return { finish: fromVerdict(verdictForUnreadable(1, "note")) };
    if (!create) return { finish: done("cancelled", NOTE_WORDS.row.nothingToTakeBack) };
    /* THE PRESSER: only whoever sent a note takes it out, whatever path
       queued this row */
    if ((create.requested_by ?? null) !== (row.requested_by ?? null)) {
      return { finish: done("cancelled", NOTE_WORDS.row.notSender) };
    }
    /* THE ACCOUNT: a take-back queued after a switch carries the account
       connected now, while its note is in the old one — where a DELETE here
       would answer 404 and read as gone */
    if (create.tenant_id !== row.tenant_id) return { finish: done("cancelled", WRITE_WORDS.otherAccount) };

    const now = clock();
    if (leaseLive(create, now)) {
      /* its sender checks for this take-back inside every attempt: wait out
         the claim, never go first */
      return { finish: fromVerdict(verdictForWaitingOn(Date.parse(create.lease_until!), now)) };
    }
    if (createCanStillGo(create, now)) {
      /* stop it now — the delete never waits out a create's retry delay */
      const iso = new Date(now).toISOString();
      const patch: Record<string, unknown> = {
        status: "cancelled",
        last_error: NOTE_WORDS.row.takenBackBeforeSent,
        lease_until: null,
        claim_id: null,
        updated_at: iso,
      };
      if (!create.taken_back_at) patch.taken_back_at = iso;
      let q = supabaseAdmin
        .from(TABLE)
        .update(patch)
        .eq("org_id", orgId)
        .eq("id", create.id)
        .eq("status", create.status);
      if (create.status === "sending") q = q.lt("lease_until", iso);
      if (!create.taken_back_at) q = q.is("taken_back_at", null);
      const { data, error } = await q.select("id");
      if (error) return { finish: fromVerdict(verdictForUnreadable(1, "note")) };
      /* a miss: a sender claimed it, or the run cancelled it — read it again */
      if ((data ?? []).length === 0) continue;
      const targets = deleteTargets({ ...create, status: "cancelled" });
      return targets.length > 0 ? { targets } : { finish: done("cancelled", NOTE_WORDS.row.nothingToTakeBack) };
    }
    const targets = deleteTargets(create);
    return targets.length > 0 ? { targets } : { finish: done("cancelled", NOTE_WORDS.row.nothingToTakeBack) };
  }
  /* it kept moving under us: try again shortly */
  return { finish: fromVerdict(verdictForUnreadable(1, "note")) };
}

/** Inside every POST attempt: whether the create may still go. Its own
    taken_back_at, and its note's tombstone, in ONE read (the note embedded
    through note_id). A tombstone on a create that isn't closed yet (a take-
    back that never saw this create) closes it here. */
async function createStillWanted(
  orgId: string,
  row: WriteRow,
  clock: () => number
): Promise<"go" | "taken_back" | "check_failed"> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("taken_back_at, note:workboard_notes!sm8_writes_note_id_fkey(removed_at)")
    .eq("org_id", orgId)
    .eq("id", row.id)
    .maybeSingle();
  if (error || !data) return "check_failed";
  const r = data as unknown as { taken_back_at: string | null; note: { removed_at: string | null } | { removed_at: string | null }[] | null };
  if (r.taken_back_at) return "taken_back";
  const note = Array.isArray(r.note) ? r.note[0] ?? null : r.note;
  if (!note) return "check_failed";
  if (note.removed_at) {
    await supabaseAdmin
      .from(TABLE)
      .update({ taken_back_at: new Date(clock()).toISOString() })
      .eq("org_id", orgId)
      .eq("id", row.id)
      .is("taken_back_at", null);
    return "taken_back";
  }
  return "go";
}

/** The edit time our latest flag change that went left on this note —
    accepted as "as seen", so a second press after our own change isn't
    cancelled as somebody else's. */
async function latestLandedFlag(
  orgId: string,
  targetUuid: string,
  exceptId: string
): Promise<{ landed: string | null; failed: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, landed_edit_date, updated_at")
    .eq("org_id", orgId)
    .eq("kind", "note")
    .eq("op", "update")
    .eq("target_uuid", targetUuid)
    .eq("status", "sent")
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) return { landed: null, failed: true };
  const prior = ((data ?? []) as { id: string; landed_edit_date: string | null }[]).find((r) => r.id !== exceptId);
  return { landed: prior?.landed_edit_date ?? null, failed: false };
}
