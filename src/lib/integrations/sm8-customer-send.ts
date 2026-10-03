/* Sending ONE customer change to ServiceM8 — server only (customer details
   to ServiceM8).

   sm8-writes' sendOne hands every `customer` row here, after its account
   check and under its claim. Only TYPES come from sm8-writes. What may be
   sent is sm8-customer-plan's.

   GOES AS THE APP, never as a person.

   A NEW CONTACT (jobcontact, create):
   1. A trial run stops here.
   2. Read back first where an earlier answer was lost: ours found is the
      contact, sent; found removed, somebody removed it there, cancelled.
   3. The POST under our uuid; a 2xx read back; ServiceM8's own uuid kept
      when it chose one; a 400 or 409 reads ours back before it's refused.

   A CHANGE (update):
   1. The record read live: gone or removed in ServiceM8, cancelled.
   2. A trial run stops here.
   3. The POST with only the fields that changed — and the one each update
      requires, sent back as it is live: a client's `name`, a job's
      `status`. Updates are the same each time, so a lost answer is simply
      sent again.
   4. Read back: a field ServiceM8 holds otherwise is logged, never guarded —
      it is the business's record.

   A REMOVAL (jobcontact, delete):
   1. The contact read live: gone or already removed, it is done, and NO
      DELETE GOES (a DELETE on a removed record may put it back). Still
      there after an earlier DELETE of this row reached it: never a second,
      and the row fails for a person to remove it there.
   2. A trial run stops here.
   3. The DELETE, then read back. */

import { withSm8Renewal, type Renewed } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import { deleteSm8JobContact, postSm8NewJobContact, postSm8RecordUpdate, readSm8Raw, type Sm8CustomerResult, type Sm8RawCheck, type Sm8ReadFailure } from "./sm8-write";
import { allowedFields, CUSTOMER_WORDS, holds, type CustomerObject } from "./sm8-customer-plan";
import {
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  verdictFor,
  verdictForAccountUnknown,
  verdictForDisconnected,
  verdictForLetGo,
  verdictForRenewLate,
  verdictForRenewUnreachable,
  WRITE_WORDS,
  type Sm8WriteOutcome,
  type Sm8WriteState,
  type Sm8WriteStatus,
  type VerdictContext,
  type WriteVerdict,
} from "./sm8-write-plan";
import type { Sm8Access } from "./sm8-store";
import type { Finish, WriteRow } from "./sm8-writes";

type Sent = { finish: Finish; access: Sm8Access | null };

export type CustomerClock = { claimedAt: number; clock: () => number; track?: { wrote: boolean } };

const done = (status: Sm8WriteStatus, error: string | null, extra: Partial<Finish> = {}): Finish => ({ status, error, httpStatus: null, ...extra });
const fromVerdict = (v: WriteVerdict, httpStatus: number | null = null): Finish => ({ status: v.status, error: v.error, httpStatus, verdict: v });

function tokenMismatch(row: Pick<WriteRow, "tenant_id">, access: Sm8Access): Finish | null {
  if (access.tenantId === row.tenant_id) return null;
  if (access.tenantId === null) return fromVerdict(verdictForAccountUnknown());
  return done("cancelled", WRITE_WORDS.otherAccount);
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
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

const isObject = (v: unknown): v is CustomerObject => v === "jobcontact" || v === "company" || v === "job";

export async function sendCustomerRow(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  given: Sm8Access | null,
  t: CustomerClock
): Promise<Sent> {
  let access = given;
  const op = row.op === "delete" ? "delete" : row.op === "update" ? "update" : "create";
  const elapsed = () => t.clock() - t.claimedAt;
  const readInTime = () => elapsed() < NOTE_READ_BY_MS;
  const sendInTime = () => elapsed() < NOTE_SEND_BY_MS;
  const ctx = (): VerdictContext => ({ now: t.clock(), timezoneName: state.timezoneName, freeRetries: row.free_retries ?? 0, kind: "customer", op });
  const letGo = (): Finish => fromVerdict(verdictForLetGo(row.free_retries ?? 0, "customer"));
  const live = state.mode === "live" && access !== null ? access : null;

  const finish = await send();
  return { finish, access };

  async function send(): Promise<Finish> {
    const object = row.cust_object;
    if (!isObject(object)) return done("cancelled", CUSTOMER_WORDS.row.refused);
    const fields = allowedFields(object, row.cust_fields);

    if (op === "create") {
      if (object !== "jobcontact" || !row.sm8_job_uuid) return done("cancelled", CUSTOMER_WORDS.row.refused);
      if (!live) return done("trial", null);
      access = live;
      if (row.maybe_landed) {
        const r = await readOne("jobcontact", row.remote_uuid, false);
        if ("finish" in r) return r.finish;
        if (r.got.found) return r.got.active === 1 ? done("sent", null) : done("cancelled", CUSTOMER_WORDS.row.gone, { ownRuledOut: true });
      }
      if (!sendInTime()) return letGo();
      const posted = await writeApp((a) => postSm8NewJobContact(sm8CallOf(a, "write"), row.remote_uuid, row.sm8_job_uuid!, fields));
      if ("finish" in posted) return posted.finish;
      const { res } = posted;
      const base: Partial<Finish> = { remote: res.remote, httpStatus: res.status };
      if (res.outcome.kind === "created" || res.status === 400 || res.status === 409) {
        const theirs = res.recordUuid && !same(res.recordUuid, row.remote_uuid) ? res.recordUuid : null;
        const ours = await readOne("jobcontact", row.remote_uuid, true);
        if ("finish" in ours) return res.outcome.kind === "created" ? done("sent", null, { ...base, ...(theirs ? { remoteUuid: theirs, replacedUuids: [row.remote_uuid] } : {}) }) : { ...ours.finish, ...base, uploadLost: true };
        if (ours.got.found && ours.got.active === 1) return done("sent", null, base);
        if (theirs && res.outcome.kind === "created") {
          const other = await readOne("jobcontact", theirs, true);
          if ("finish" in other || (other.got.found && other.got.active === 1)) return done("sent", null, { ...base, remoteUuid: theirs, replacedUuids: [row.remote_uuid] });
        }
        if (res.outcome.kind === "created") return done("failed", CUSTOMER_WORDS.row.unsure, { ...base, uploadLost: true });
        return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), ...base };
      }
      const v = verdictFor(res.outcome, attempts, ctx());
      return { ...fromVerdict(v, res.status), ...base, ...(res.outcome.kind === "unavailable" ? { uploadLost: true } : {}) };
    }

    const target = row.target_uuid ?? "";
    if (!target) return done("cancelled", CUSTOMER_WORDS.row.gone);
    if (!live) {
      /* a trial run reads nothing it would change: it stops here */
      return done("trial", null);
    }
    access = live;
    const r = await readOne(object, target, false);
    if ("finish" in r) return r.finish;

    if (op === "delete") {
      if (object !== "jobcontact") return done("cancelled", CUSTOMER_WORDS.row.refused);
      if (!r.got.found || r.got.active !== 1) return done("sent", null, { verifyUuids: [] });
      const reached = (row.verify_uuids ?? []).some((u) => same(u, target));
      if (reached) return done("failed", CUSTOMER_WORDS.row.stillThere);
      if (!sendInTime()) return letGo();
      const del = await writeApp((a) => deleteSm8JobContact(sm8CallOf(a, "write"), target));
      if ("finish" in del) return del.finish;
      const { res } = del;
      const held: Partial<Finish> = { remote: res.remote, httpStatus: res.status, verifyUuids: [target] };
      if (res.outcome.kind === "created" || res.status === 404) {
        const back = await readOne("jobcontact", target, true);
        if ("finish" in back) return done("sent", null, held);
        if (back.got.found && back.got.active === 1) return done("failed", CUSTOMER_WORDS.row.stillThere, held);
        return done("sent", null, held);
      }
      return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), ...held, ...(res.outcome.kind === "unavailable" ? { uploadLost: true } : {}) };
    }

    /* an update */
    if (!r.got.found || r.got.active !== 1) return done("cancelled", CUSTOMER_WORDS.row.gone);
    if (Object.keys(fields).length === 0) return done("sent", null);
    const liveRow = r.got.row;
    const body: Record<string, string> = { ...fields };
    if (object === "company" && !body.name) body.name = String(liveRow.name ?? "");
    if (object === "job") body.status = String(liveRow.status ?? "");
    if ((object === "company" && !body.name) || (object === "job" && !body.status)) return done("failed", CUSTOMER_WORDS.row.refused);
    if (!sendInTime()) return letGo();
    const posted = await writeApp((a) => postSm8RecordUpdate(sm8CallOf(a, "write"), object, target, body));
    if ("finish" in posted) return posted.finish;
    const { res } = posted;
    const base: Partial<Finish> = { remote: res.remote, httpStatus: res.status };
    if (res.outcome.kind === "created") {
      const back = await readOne(object, target, true);
      if (!("finish" in back) && back.got.found && !holds(back.got.row, fields)) {
        console.warn(`[sm8] customer row ${row.id}: ${object} read back holding other values than went`);
      }
      return done("sent", null, base);
    }
    return { ...fromVerdict(verdictFor(res.outcome, attempts, ctx()), res.status), ...base };
  }

  async function readOne(object: CustomerObject, uuid: string, after: boolean): Promise<{ got: Extract<Sm8RawCheck, { ok: true }> } | { finish: Finish }> {
    if (!readInTime()) return { finish: after ? fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx())) : letGo() };
    const wrong = tokenMismatch(row, access!);
    if (wrong) return { finish: wrong };
    const got = await withSm8Renewal<{ c?: Sm8RawCheck; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        return { c: await readSm8Raw(sm8CallOf(a, "write"), object, uuid) };
      },
      (x) => !!x.c && !x.c.ok && (x.c as Sm8ReadFailure).unauthorized === true,
      { retry: readInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, null);
    if (renewal) return { finish: after && got.verdict === "late" ? fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx())) : renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const c = got.result.c!;
    if (!c.ok) return { finish: fromVerdict(verdictFor((c as Sm8ReadFailure).limited ?? UNAVAILABLE, attempts, ctx())) };
    return { got: c };
  }

  async function writeApp(req: (a: Sm8Access) => Promise<Sm8CustomerResult>): Promise<{ res: Sm8CustomerResult } | { finish: Finish }> {
    const got = await withSm8Renewal<{ res?: Sm8CustomerResult; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        if (t.track) t.track.wrote = true;
        return { res: await req(a) };
      },
      (x) => x.res?.outcome.kind === "unauthorized",
      { retry: sendInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, got.result.res?.status ?? null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    return { res: got.result.res! };
  }
}
