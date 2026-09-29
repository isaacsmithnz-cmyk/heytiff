/* Sending ONE leave row to ServiceM8 — server only (leave to ServiceM8).

   sm8-writes' sendOne hands every `leave` row here, after its account check
   and under its claim, and records whatever Finish comes back. Only TYPES
   come from sm8-writes, so there is no import cycle. The shape of what goes
   is sm8-leave-plan's.

   LEAVE GOES AS THE APP, never as a person: nothing here impersonates
   anyone, and a 403 is the leave's, not a person's.

   A CREATE (approved leave, or a casual's day off), IN THIS ORDER:
   1. The leave still stands in HeyTiff: the request still approved, the
      day off still up. Not, and it is cancelled with no request.
   2. The person, active in the mirror.
   3. A TRIAL RUN STOPS HERE.
   4. READ BACK FIRST, where an earlier answer was lost (maybe_landed) or an
      older uuid waits for its check: ours found on the board is the leave,
      sent, and never posted again; found taken off, somebody took it off
      there, and it is cancelled.
   5. The POST, with step 1 asked again inside every attempt, and a row
      somebody took back (its leave cancelled) never going.
   6. A 2xx is read back. A read that fails leaves the 2xx standing; ours
      found under ServiceM8's own uuid (x-record-uuid) is recorded under
      that one; found under neither, the row fails as unsure, its uuids
      kept so taking it off later names them.
   7. A 400 or a 409 reads ours back before it is refused.

   A DELETE (the leave cancelled, or the day off taken down) takes off what
   its create may have put on the board:
   1. Its create, read. Still being sent under a live claim, it waits; one
      that could still go is cancelled here (its queue helper did so
      already); what of it may be on the board is deleteTargets'.
   2. Nothing may be there: cancelled, in words that say so.
   3. A TRIAL RUN STOPS HERE.
   4. FOR EACH TARGET: read live. Gone or inactive, it is off already and
      NO DELETE GOES — a DELETE on a record already removed may put it back
      (the notes walk, 2026-09-27). Active, and this row's DELETE never
      reached it: DELETE, then read it back. Active, and an earlier DELETE
      of this row reached it (remembered on the row, in verify_uuids): it is
      never sent a second, and the row fails in words that ask a person to
      take it off on the board.

   EVERY REQUEST CHECKS ITS ACCOUNT (tokenMismatch) before any read and
   again inside every function handed to withSm8Renewal. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { withSm8Renewal, type Renewed } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import {
  deleteSm8Availability,
  postSm8Availability,
  readSm8Availability,
  type Sm8LeaveResult,
  type Sm8ReadFailure,
} from "./sm8-write";
import { createCanStillGo, deleteTargets, leaseLive } from "./sm8-note-plan";
import { fillWords } from "./sm8-note-words";
import { isTheLeave, LEAVE_WORDS, parseLeaveSubject, type Sm8LiveAvailability } from "./sm8-leave-plan";
import {
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  verdictFor,
  verdictForAccountUnknown,
  verdictForCheckFailed,
  verdictForDisconnected,
  verdictForLetGo,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  verdictForWaitingOn,
  WRITE_WORDS,
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

/** The claim's clocks, and `track`, which the run reads if the send throws:
    `wrote` is set the moment a POST or a DELETE is started. */
export type LeaveClock = {
  claimedAt: number;
  clock: () => number;
  track?: { wrote: boolean };
};

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

function tokenMismatch(row: Pick<WriteRow, "tenant_id">, access: Sm8Access): Finish | null {
  if (access.tenantId === row.tenant_id) return null;
  if (access.tenantId === null) return fromVerdict(verdictForAccountUnknown());
  return done("cancelled", WRITE_WORDS.otherAccount);
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

const UNAVAILABLE: Sm8WriteOutcome = { kind: "unavailable", status: null };

function renewalFinish<T>(out: Renewed<T>, httpStatus: number | null): Finish | null {
  switch (out.verdict) {
    case "unreachable":
      return fromVerdict(verdictForRenewUnreachable(), httpStatus);
    case "gone":
      return fromVerdict(verdictForDisconnected(), httpStatus);
    case "late":
      return fromVerdict(verdictForRenewLate(), httpStatus);
    case "dead":
    case "unconfirmed":
      return fromVerdict(verdictFor({ kind: "unauthorized" }, 0), httpStatus);
    default:
      return null;
  }
}

export async function sendLeaveRow(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  given: Sm8Access | null,
  t: LeaveClock
): Promise<Sent> {
  const op = row.op === "delete" ? "delete" : "create";
  let access = given;
  const ctx = (): VerdictContext => ({
    now: t.clock(),
    timezoneName: state.timezoneName,
    freeRetries: row.free_retries ?? 0,
    kind: "leave",
    op,
  });
  const elapsed = () => t.clock() - t.claimedAt;
  const readInTime = () => elapsed() < NOTE_READ_BY_MS;
  const sendInTime = () => elapsed() < NOTE_SEND_BY_MS;
  const letGo = (): Finish => fromVerdict(verdictForLetGo(row.free_retries ?? 0, "leave"));
  const checkFailed = (): Finish => fromVerdict(verdictForCheckFailed("leave"));
  const failedRead = (): Finish => fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx()));
  const live = state.mode === "live" && access !== null ? access : null;

  /** One live read of one uuid, the account asking, renewed once on a 401.
      BEFORE a write, a read that no longer fits the claim lets the row go;
      AFTER one (`after`), it is a read that failed. */
  const readOne = async (
    uuid: string,
    after = false
  ): Promise<{ got: { found: false } | { found: true; availability: Sm8LiveAvailability } } | { finish: Finish }> => {
    if (!readInTime()) return { finish: after ? failedRead() : letGo() };
    const wrong = tokenMismatch(row, access!);
    if (wrong) return { finish: wrong };
    type C = Awaited<ReturnType<typeof readSm8Availability>>;
    const got = await withSm8Renewal<{ c?: C; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        return { c: await readSm8Availability(sm8CallOf(a, "write"), uuid) };
      },
      (r) => !!r.c && !r.c.ok && (r.c as Sm8ReadFailure).unauthorized === true,
      { retry: readInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, null);
    if (renewal) return { finish: after && got.verdict === "late" ? failedRead() : renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const c = got.result.c!;
    if (!c.ok) return { finish: fromVerdict(verdictFor((c as Sm8ReadFailure).limited ?? UNAVAILABLE, attempts, ctx())) };
    return { got: c };
  };

  /** One request as the app, renewed once on a 401. `before` runs inside
      every attempt, after the account check. */
  const writeApp = async (
    request: (a: Sm8Access) => Promise<Sm8LeaveResult>,
    before?: () => Promise<Finish | null>
  ): Promise<{ res: Sm8LeaveResult } | { finish: Finish }> => {
    const got = await withSm8Renewal<{ res?: Sm8LeaveResult; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        const stop = before ? await before() : null;
        if (stop) return { finish: stop };
        if (t.track) t.track.wrote = true;
        return { res: await request(a) };
      },
      (r) => r.res?.outcome.kind === "unauthorized",
      { retry: sendInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, got.result.res?.status ?? null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    return { res: got.result.res! };
  };

  const finish = op === "delete" ? await sendDelete() : await sendCreate();
  return { finish, access };

  /* ── leave onto the board ── */
  async function sendCreate(): Promise<Finish> {
    /* 1. still standing in HeyTiff */
    const stands = await leaveStands(orgId, row);
    if (stands === "failed") return checkFailed();
    if (stands !== "yes") return done("cancelled", stands);

    /* 2. the person */
    const who = await readMirrorStaff(orgId, row.leave_staff_uuid ?? "");
    if (who === "failed") return checkFailed();
    if (!who) return done("cancelled", LEAVE_WORDS.row.personGone);
    if (who.active !== 1) return done("cancelled", fillWords(LEAVE_WORDS.row.personInactive, { name: who.name ?? "that person" }));

    /* 3. a trial run goes this far */
    if (!live) return done("trial", null);
    access = live;

    /* 4. read back first */
    let verify = [...(row.verify_uuids ?? [])];
    const toRead = [...(row.maybe_landed ? [row.remote_uuid] : []), ...verify.filter((u) => !same(u, row.remote_uuid))];
    for (const uuid of toRead) {
      const own = same(uuid, row.remote_uuid);
      const r = await readOne(uuid);
      if ("finish" in r) return { ...r.finish, verifyUuids: verify };
      const c = r.got;
      if (c.found && same(c.availability.regardingUuid, row.leave_staff_uuid)) {
        if (c.availability.active === 1) {
          return done("sent", null, { remoteUuid: uuid, verifyUuids: [], landedEditDate: c.availability.editDate });
        }
        /* taken off the board by somebody */
        if (own) return done("cancelled", LEAVE_WORDS.row.removedThere, { verifyUuids: [], ownRuledOut: true });
      }
      verify = verify.filter((u) => !same(u, uuid));
    }
    /* ours was read and isn't there: nothing under it landed */
    const kept: Partial<Finish> = { verifyUuids: verify, ...(row.maybe_landed ? { ownRuledOut: true } : {}) };

    /* 5. the POST */
    if (!sendInTime()) return { ...letGo(), ...kept };
    const posted = await writeApp(
      (a) =>
        postSm8Availability(sm8CallOf(a, "write"), {
          uuid: row.remote_uuid,
          staffUuid: row.leave_staff_uuid ?? "",
          name: payloadName(row) ?? LEAVE_WORDS.board.leave,
          start: row.leave_start ?? "",
          end: row.leave_end ?? "",
        }),
      async () => {
        const back = await takenBack(orgId, row.id);
        if (back === "failed") return { ...checkFailed(), ...kept };
        if (back) return done("cancelled", LEAVE_WORDS.row.notApproved, kept);
        const again = await leaveStands(orgId, row);
        if (again === "failed") return { ...checkFailed(), ...kept };
        if (again !== "yes") return done("cancelled", again, kept);
        return null;
      }
    );
    if ("finish" in posted) return posted.finish;
    const { res } = posted;
    const base: Partial<Finish> = { ...kept, remote: res.remote, httpStatus: res.status };

    /* 6. a 2xx: read it back */
    if (res.outcome.kind === "created") {
      const theirs = res.recordUuid && !same(res.recordUuid, row.remote_uuid) ? res.recordUuid : null;
      const ours = await readOne(row.remote_uuid, true);
      if ("finish" in ours) {
        return done("sent", null, { ...base, ...(theirs ? { remoteUuid: theirs, replacedUuids: [row.remote_uuid] } : {}) });
      }
      if (ours.got.found && ours.got.availability.active === 1) {
        logDifference(row, ours.got.availability);
        return done("sent", null, { ...base, landedEditDate: ours.got.availability.editDate });
      }
      if (theirs) {
        const other = await readOne(theirs, true);
        if ("finish" in other || (other.got.found && other.got.availability.active === 1)) {
          console.warn(`[sm8] leave kept under ServiceM8's own uuid (row ${row.id})`);
          return done("sent", null, { ...base, remoteUuid: theirs, replacedUuids: [row.remote_uuid] });
        }
      }
      return done("failed", LEAVE_WORDS.row.unsure, {
        ...base,
        uploadLost: true,
        verifyUuids: theirs ? [...new Set([...verify, theirs])] : verify,
      });
    }

    /* 7. a 400 or a 409: is ours there after all? */
    if (res.status === 400 || res.status === 409) {
      const ours = await readOne(row.remote_uuid, true);
      if ("finish" in ours) return { ...ours.finish, ...base, uploadLost: true };
      if (ours.got.found && ours.got.availability.active === 1) return done("sent", null, { ...base, landedEditDate: ours.got.availability.editDate });
      return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), ...base };
    }
    const v = verdictFor(res.outcome, attempts, ctx());
    /* no answer, a 408 or a 5xx: it may have landed */
    if (res.outcome.kind === "unavailable") return { ...fromVerdict(v, res.status), ...base, uploadLost: true };
    return { ...fromVerdict(v, res.status), ...base };
  }

  /* ── leave off the board ── */
  async function sendDelete(): Promise<Finish> {
    if (!row.depends_on) return done("cancelled", LEAVE_WORDS.row.nothingThere);
    const create = await readCreate(orgId, row.depends_on);
    if (create === "failed") return checkFailed();
    if (!create) return done("cancelled", LEAVE_WORDS.row.nothingThere);
    const now = t.clock();
    if (leaseLive(create, now)) return fromVerdict(verdictForWaitingOn(Date.parse(create.lease_until ?? "") || now, now));
    let settled = create;
    if (createCanStillGo(create, now)) {
      const stopped = await stopCreate(orgId, create, now);
      if (stopped === "failed") return checkFailed();
      settled = stopped;
      if (leaseLive(settled, t.clock())) {
        return fromVerdict(verdictForWaitingOn(Date.parse(settled.lease_until ?? "") || t.clock(), t.clock()));
      }
    }
    const targets = deleteTargets(settled);
    if (targets.length === 0) return done("cancelled", LEAVE_WORDS.row.nothingThere);

    if (!live) return done("trial", null);
    access = live;

    const reached = new Set((row.verify_uuids ?? []).map((u) => u.toLowerCase()));
    let httpStatus: number | null = null;
    const held = (f: Finish): Finish => ({ ...f, httpStatus: f.httpStatus ?? httpStatus, verifyUuids: [...reached] });
    const seen = new Set<string>();
    for (const target of targets) {
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const r = await readOne(target);
      if ("finish" in r) return held(r.finish);
      if (!r.got.found || r.got.availability.active !== 1) continue;
      /* still on the board after a DELETE of ours reached it: never a
         second one by itself */
      if (reached.has(key)) return held(done("failed", LEAVE_WORDS.row.stillThere));
      if (!sendInTime()) return held(letGo());
      const del = await writeApp((a) => deleteSm8Availability(sm8CallOf(a, "write"), target));
      if ("finish" in del) return held(del.finish);
      const { res } = del;
      httpStatus = res.status;
      reached.add(key);
      if (res.outcome.kind === "created" || res.status === 404) {
        const back = await readOne(target, true);
        /* the DELETE answered: a read that fails counts it off */
        if ("finish" in back) continue;
        if (back.got.found && back.got.availability.active === 1) return held(done("failed", LEAVE_WORDS.row.stillThere, { httpStatus: res.status }));
        continue;
      }
      const v = verdictFor(res.outcome, attempts, ctx());
      return held({ ...fromVerdict(v, res.status), remote: res.remote });
    }
    return done("sent", null, { httpStatus, verifyUuids: [...reached] });
  }
}

/** The name the create goes under, off its payload. */
function payloadName(row: WriteRow): string | null {
  const p = row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
  return typeof p.name === "string" && p.name.trim() ? p.name.trim() : null;
}

/** A difference ServiceM8 kept that isn't the business's to have made yet
    (right after our POST): logged, never guarded — leave on the board is
    the business's to change. */
function logDifference(row: WriteRow, a: Sm8LiveAvailability): void {
  if (!isTheLeave(a, row)) {
    console.warn(`[sm8] leave row ${row.id} read back with another person or span than it went with`);
  }
}

/** Whether the leave a create row carries still stands in HeyTiff: "yes",
    the words it is cancelled with, or "failed" when that couldn't be read. */
async function leaveStands(orgId: string, row: WriteRow): Promise<"yes" | "failed" | string> {
  const s = parseLeaveSubject(row.subject);
  if (!s || s.via === "remove") return LEAVE_WORDS.row.notApproved;
  if (s.via === "leave") {
    const { data, error } = await supabaseAdmin.from("leave_requests").select("id, status").eq("org_id", orgId).eq("id", s.id).maybeSingle();
    if (error) return "failed";
    return (data as { status?: string } | null)?.status === "approved" ? "yes" : LEAVE_WORDS.row.notApproved;
  }
  const { data, error } = await supabaseAdmin.from("staff_unavailability").select("id").eq("org_id", orgId).eq("id", s.id).maybeSingle();
  if (error) return "failed";
  return data ? "yes" : LEAVE_WORDS.row.dayOffGone;
}

/** A create taken back (its leave cancelled) since it was claimed. */
async function takenBack(orgId: string, id: string): Promise<boolean | "failed"> {
  const { data, error } = await supabaseAdmin.from(TABLE).select("taken_back_at").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error || !data) return "failed";
  return !!(data as { taken_back_at: string | null }).taken_back_at;
}

async function readMirrorStaff(orgId: string, staffUuid: string): Promise<{ active: number | null; name: string | null } | null | "failed"> {
  if (!staffUuid) return null;
  const { data, error } = await supabaseAdmin
    .from("sm8_staff")
    .select("uuid, first, last, active")
    .eq("org_id", orgId)
    .in("uuid", spellings(staffUuid));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; first: unknown; last: unknown; active: unknown }[]).find((x) => same(x.uuid, staffUuid));
  if (!r) return null;
  const name = [r.first, r.last].filter((p): p is string => typeof p === "string" && !!p.trim()).join(" ").trim();
  return { active: typeof r.active === "number" ? r.active : Number(r.active), name: name || null };
}

type CreateRead = {
  id: string;
  status: string;
  remote_uuid: string;
  lease_until: string | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  taken_back_at: string | null;
};

const CREATE_COLUMNS = "id, status, remote_uuid, lease_until, maybe_landed, verify_uuids, taken_back_at";

async function readCreate(orgId: string, id: string): Promise<CreateRead | null | "failed"> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(CREATE_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("kind", "leave")
    .maybeSingle();
  if (error) return "failed";
  return (data as CreateRead | null) ?? null;
}

/** A create that could still go, stopped: taken back, and cancelled on the
    status it was read in (a lapsed send only once its lease has lapsed).
    Its maybe_landed and verify_uuids stay for the delete to read. */
async function stopCreate(orgId: string, create: CreateRead, now: number): Promise<CreateRead | "failed"> {
  const iso = new Date(now).toISOString();
  await supabaseAdmin.from(TABLE).update({ taken_back_at: iso }).eq("org_id", orgId).eq("id", create.id).is("taken_back_at", null);
  let q = supabaseAdmin
    .from(TABLE)
    .update({ status: "cancelled", last_error: LEAVE_WORDS.row.notApproved, lease_until: null, claim_id: null, updated_at: iso })
    .eq("org_id", orgId)
    .eq("id", create.id)
    .eq("status", create.status);
  if (create.status === "sending") q = q.lt("lease_until", iso);
  await q.select("id");
  const again = await readCreate(orgId, create.id);
  return again === null ? "failed" : again;
}
