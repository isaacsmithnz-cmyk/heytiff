/* Sending ONE new job to ServiceM8 — server only (new jobs to ServiceM8).

   sm8-writes' sendOne hands every `job` row here, after its account check
   and under its claim, and records whatever Finish comes back. Only TYPES
   come from sm8-writes, so there is no import cycle. What goes is
   sm8-job-plan's.

   A JOB GOES AS THE APP, never as a person.

   THE ROW'S STEPS, IN ORDER (stepsLeft): a new client or site, the job, its
   contact — each under the uuid chosen when the row was queued. Each step
   confirmed in ServiceM8 is written onto the row at once, under this claim
   (t.progress), before the next goes, so a send that stops anywhere — out
   of time, a lost answer, a crash — carries on from the step it was on.

   BEFORE ANYTHING GOES:
   1. The words (job_draft) read back, or the row is cancelled.
   2. Before the job is made: the existing client, or a site's builder, is
      still active in the mirror. Not, and the row is cancelled. A category
      ServiceM8 no longer has is left off the job rather than refusing it.
   3. A TRIAL RUN STOPS HERE: no request goes — jobs may be charged.

   EACH STEP:
   a. READ BACK FIRST where an earlier answer may have been lost
      (maybe_landed, or a step this claim couldn't confirm): found active is
      the step, done, and never posted again. A client found removed in
      ServiceM8 cancels the row (no job goes under a removed client); a job
      found removed fails the row and is never posted again (a POST on our
      uuid may bring it back); a contact found removed counts as done.
   b. Out of time: a step made in this claim hands the row back to go on at
      once (verdictForJobProgress); none made lets it go untouched.
   c. THE POST, under our uuid. Before the first step of a row with nothing
      done, a row its presser took back never goes. After anything has
      landed, a take-back is no longer possible.
   d. A 2xx is read back: ours found is the step; ServiceM8's own uuid
      (x-record-uuid) found instead is adopted, and written on the row before
      the next step names it; a read that fails leaves the 2xx standing;
      found under neither, the row fails as unsure, its uuids kept.
   e. A 400 or a 409 reads ours back before it is refused.
   f. No answer, a 408 or a 5xx: it may have landed, and the next claim reads
      it back before any POST.

   EVERY REQUEST CHECKS ITS ACCOUNT (tokenMismatch) before any read and
   again inside every function handed to withSm8Renewal. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { withSm8Renewal, type Renewed } from "./sm8-renew";
import { sm8CallOf } from "./sm8-http";
import {
  postSm8Company,
  postSm8JobContact,
  postSm8NewJob,
  readSm8Company,
  readSm8JobContact,
  readSm8NewJob,
  type Sm8JobResult,
  type Sm8ReadFailure,
  type Sm8RecordCheck,
} from "./sm8-write";
import { fillWords } from "./sm8-note-words";
import { draftOf, JOB_WORDS, stepsLeft, type JobStep } from "./sm8-job-plan";
import {
  NOTE_READ_BY_MS,
  NOTE_SEND_BY_MS,
  verdictFor,
  verdictForAccountUnknown,
  verdictForCheckFailed,
  verdictForDisconnected,
  verdictForJobProgress,
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

/** What the sender writes onto the row as each step is confirmed. */
export type JobProgress = {
  job_done: string[];
  job_company_uuid: string;
  job_contact_uuid: string | null;
  remote_uuid: string;
  job_number: string | null;
};

/** The claim's clocks; `track.wrote` is set the moment a POST starts; and
    `progress` writes a confirmed step onto the row, only while this claim
    still holds it (false when it doesn't). */
export type JobClock = {
  claimedAt: number;
  clock: () => number;
  track?: { wrote: boolean };
  progress: (p: JobProgress) => Promise<boolean>;
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

export async function sendJobRow(
  orgId: string,
  state: Sm8WriteState,
  row: WriteRow,
  attempts: number,
  given: Sm8Access | null,
  t: JobClock
): Promise<Sent> {
  let access = given;
  const elapsed = () => t.clock() - t.claimedAt;
  const readInTime = () => elapsed() < NOTE_READ_BY_MS;
  const sendInTime = () => elapsed() < NOTE_SEND_BY_MS;
  const ctx = (step: JobStep): VerdictContext => ({
    now: t.clock(),
    timezoneName: state.timezoneName,
    freeRetries: row.free_retries ?? 0,
    kind: "job",
    op: "create",
    step,
  });
  const letGo = (): Finish => fromVerdict(verdictForLetGo(row.free_retries ?? 0, "job"));
  const checkFailed = (): Finish => fromVerdict(verdictForCheckFailed("job"));
  const live = state.mode === "live" && access !== null ? access : null;

  /* the row's state, carried forward as steps are confirmed */
  const p: JobProgress = {
    job_done: [...(row.job_done ?? [])],
    job_company_uuid: row.job_company_uuid ?? "",
    job_contact_uuid: row.job_contact_uuid ?? null,
    remote_uuid: row.remote_uuid,
    job_number: row.job_number ?? null,
  };
  const kept = (): Partial<Finish> => ({ jobProgress: { ...p, job_done: [...p.job_done] } });

  const finish = await send();
  return { finish, access };

  async function send(): Promise<Finish> {
    /* 1. the words */
    const draft = draftOf(row);
    if (!draft || !p.job_company_uuid) return done("cancelled", JOB_WORDS.row.jobRefused);

    /* 2. before the job is made: where it goes, still there */
    const jobMade = p.job_done.includes("job");
    if (!jobMade) {
      const companyMade = p.job_done.includes("company");
      if (!row.job_company_new) {
        const c = await readMirrorCompany(orgId, p.job_company_uuid);
        if (c === "failed") return checkFailed();
        if (!c || c.active !== 1) return done("cancelled", JOB_WORDS.row.clientGone);
      } else if (row.job_company_new === "site" && !companyMade) {
        const parent = await readMirrorCompany(orgId, row.job_parent_uuid ?? "");
        if (parent === "failed") return checkFailed();
        if (!parent || parent.active !== 1) return done("cancelled", JOB_WORDS.row.parentGone);
      }
    }
    let category = row.job_category_uuid ?? null;
    if (category && !jobMade) {
      const cat = await readMirrorCategory(orgId, category);
      if (cat === "failed") return checkFailed();
      if (!cat) {
        console.warn(`[sm8] job row ${row.id}: its category is gone from ServiceM8, so it goes without one`);
        category = null;
      }
    }

    /* 3. a trial run goes this far */
    if (!live) return done("trial", null);
    access = live;

    let unsure = row.maybe_landed === true;
    let madeHere = false;
    for (const step of stepsLeft(row)) {
      const uuid = () => (step === "company" ? p.job_company_uuid : step === "job" ? p.remote_uuid : p.job_contact_uuid ?? "");

      /* a. read back first */
      if (unsure) {
        const r = await readOne(step, uuid(), false);
        if ("finish" in r) return { ...r.finish, ...kept(), uploadLost: true };
        if (r.got.found) {
          const rec = r.got.record;
          if (rec.active === 1 || step === "contact") {
            const ok = await confirm(step, rec.number);
            if (!ok) return { ...letGo(), ...kept() };
            madeHere = true;
            continue;
          }
          if (step === "company") return done("cancelled", JOB_WORDS.row.companyRemovedThere, { ...kept(), ownRuledOut: true });
          return done("failed", JOB_WORDS.row.jobRemovedThere, { ...kept(), ownRuledOut: true });
        }
        unsure = false;
      }

      /* b. in time */
      if (!sendInTime()) return madeHere ? { ...fromVerdict(verdictForJobProgress()), ...kept(), ownRuledOut: true } : { ...letGo(), ...kept() };

      /* c. the POST */
      const first = p.job_done.length === 0;
      const posted = await writeApp(
        (a) => request(a, step, category, draft),
        first
          ? async () => {
              const back = await takenBack(orgId, row.id);
              if (back === "failed") return { ...checkFailed(), ...kept() };
              if (back) return done("cancelled", JOB_WORDS.row.takenBack, kept());
              return null;
            }
          : undefined
      );
      if ("finish" in posted) return { ...posted.finish, ...kept(), ...(madeHere ? { ownRuledOut: true } : {}) };
      const { res } = posted;
      const base: Partial<Finish> = { remote: res.remote, httpStatus: res.status };

      /* d. a 2xx: read it back */
      if (res.outcome.kind === "created") {
        const theirs = res.recordUuid && !same(res.recordUuid, uuid()) ? res.recordUuid : null;
        const ours = await readOne(step, uuid(), true);
        if ("finish" in ours) {
          /* the 2xx stands */
          if (theirs) adopt(step, theirs);
          if (!(await confirm(step, null))) return { ...letGo(), ...kept(), ...base };
          madeHere = true;
          continue;
        }
        if (ours.got.found && (ours.got.record.active === 1 || step === "contact")) {
          if (!(await confirm(step, ours.got.record.number))) return { ...letGo(), ...kept(), ...base };
          madeHere = true;
          continue;
        }
        if (theirs) {
          const other = await readOne(step, theirs, true);
          if ("finish" in other || (other.got.found && other.got.record.active === 1)) {
            console.warn(`[sm8] job row ${row.id}: ${step} kept under ServiceM8's own uuid`);
            adopt(step, theirs);
            const number = !("finish" in other) && other.got.found ? other.got.record.number : null;
            if (!(await confirm(step, number))) return { ...letGo(), ...kept(), ...base };
            madeHere = true;
            continue;
          }
        }
        return done("failed", JOB_WORDS.row.unsure, { ...base, ...kept(), uploadLost: true });
      }

      /* e. a 400 or a 409: is ours there after all? */
      if (res.status === 400 || res.status === 409) {
        const ours = await readOne(step, uuid(), true);
        if ("finish" in ours) return { ...ours.finish, ...base, ...kept(), uploadLost: true };
        if (ours.got.found && (ours.got.record.active === 1 || step === "contact")) {
          if (!(await confirm(step, ours.got.record.number))) return { ...letGo(), ...kept(), ...base };
          madeHere = true;
          continue;
        }
        return refused(step, verdictFor(res.outcome, attempts, ctx(step)), res.status, base, madeHere, draft.companyName);
      }

      const v = verdictFor(res.outcome, attempts, ctx(step));
      /* f. no answer, a 408 or a 5xx: it may have landed */
      if (res.outcome.kind === "unavailable") return { ...fromVerdict(v, res.status), ...base, ...kept(), uploadLost: true };
      return refused(step, v, res.status, base, madeHere, draft.companyName);
    }

    return done("sent", null, { ...kept(), remoteUuid: same(p.remote_uuid, row.remote_uuid) ? undefined : p.remote_uuid });
  }

  /** A step refused. A client made and its job refused says so, so nobody
      wonders where the client in ServiceM8 came from. */
  function refused(step: JobStep, v: WriteVerdict, status: number | null, base: Partial<Finish>, madeHere: boolean, companyName: string | null): Finish {
    const partial = step === "job" && p.job_done.includes("company") && v.status === "failed";
    const verdict = partial ? { ...v, error: fillWords(JOB_WORDS.row.partialClient, { name: companyName ?? "The client" }) } : v;
    return { ...fromVerdict(verdict, status), ...base, ...kept(), ...(madeHere || partial ? { ownRuledOut: true } : {}) };
  }

  /** A step confirmed: onto the row at once, under this claim. */
  async function confirm(step: JobStep, number: string | null): Promise<boolean> {
    if (!p.job_done.includes(step)) p.job_done.push(step);
    if (step === "job" && number) p.job_number = number;
    return t.progress({ ...p, job_done: [...p.job_done] });
  }

  /** ServiceM8 kept the step under its own uuid: the later steps name that one. */
  function adopt(step: JobStep, theirs: string) {
    if (step === "company") p.job_company_uuid = theirs;
    else if (step === "job") p.remote_uuid = theirs;
    else p.job_contact_uuid = theirs;
  }

  async function request(a: Sm8Access, step: JobStep, category: string | null, draft: NonNullable<ReturnType<typeof draftOf>>): Promise<Sm8JobResult> {
    const call = sm8CallOf(a, "write");
    if (step === "company") {
      return postSm8Company(call, {
        uuid: p.job_company_uuid,
        name: draft.companyName ?? draft.address,
        address: draft.companyAddress ?? draft.address,
        parentUuid: row.job_company_new === "site" ? row.job_parent_uuid ?? null : null,
      });
    }
    if (step === "job") {
      return postSm8NewJob(call, { uuid: p.remote_uuid, companyUuid: p.job_company_uuid, address: draft.address, description: draft.description, categoryUuid: category });
    }
    return postSm8JobContact(call, { uuid: p.job_contact_uuid ?? "", jobUuid: p.remote_uuid, ...(draft.contact ?? { first: "", last: "", mobile: "", phone: "", email: "" }) });
  }

  /** One live read of one step's record, the account asking, renewed once
      on a 401. Before a write a read that no longer fits the claim lets the
      row go; after one (`after`) it is a read that failed. */
  async function readOne(step: JobStep, uuid: string, after: boolean): Promise<{ got: Extract<Sm8RecordCheck, { ok: true }> } | { finish: Finish }> {
    if (!readInTime()) return { finish: after ? fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx(step))) : letGo() };
    const wrong = tokenMismatch(row, access!);
    if (wrong) return { finish: wrong };
    const reader = step === "company" ? readSm8Company : step === "job" ? readSm8NewJob : readSm8JobContact;
    const got = await withSm8Renewal<{ c?: Sm8RecordCheck; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        return { c: await reader(sm8CallOf(a, "write"), uuid) };
      },
      (r) => !!r.c && !r.c.ok && (r.c as Sm8ReadFailure).unauthorized === true,
      { retry: readInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, null);
    if (renewal) return { finish: after && got.verdict === "late" ? fromVerdict(verdictFor(UNAVAILABLE, attempts, ctx(step))) : renewal };
    if (got.result.finish) return { finish: got.result.finish };
    const c = got.result.c!;
    if (!c.ok) return { finish: fromVerdict(verdictFor((c as Sm8ReadFailure).limited ?? UNAVAILABLE, attempts, ctx(step))) };
    return { got: c };
  }

  /** One request as the app, renewed once on a 401. `before` runs inside
      every attempt, after the account check. */
  async function writeApp(
    req: (a: Sm8Access) => Promise<Sm8JobResult>,
    before?: () => Promise<Finish | null>
  ): Promise<{ res: Sm8JobResult } | { finish: Finish }> {
    const got = await withSm8Renewal<{ res?: Sm8JobResult; finish?: Finish }>(
      orgId,
      access!,
      async (a) => {
        const w = tokenMismatch(row, a);
        if (w) return { finish: w };
        const stop = before ? await before() : null;
        if (stop) return { finish: stop };
        if (t.track) t.track.wrote = true;
        return { res: await req(a) };
      },
      (r) => r.res?.outcome.kind === "unauthorized",
      { retry: sendInTime }
    );
    access = got.access;
    const renewal = renewalFinish(got, got.result.res?.status ?? null);
    if (renewal) return { finish: renewal };
    if (got.result.finish) return { finish: got.result.finish };
    return { res: got.result.res! };
  }
}

/** A row its presser took back since it was claimed. */
async function takenBack(orgId: string, id: string): Promise<boolean | "failed"> {
  const { data, error } = await supabaseAdmin.from("sm8_writes").select("taken_back_at").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (error || !data) return "failed";
  return !!(data as { taken_back_at: string | null }).taken_back_at;
}

async function readMirrorCompany(orgId: string, uuid: string): Promise<{ active: number | null } | null | "failed"> {
  if (!uuid) return null;
  const { data, error } = await supabaseAdmin.from("sm8_companies").select("uuid, active").eq("org_id", orgId).in("uuid", spellings(uuid));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; active: unknown }[]).find((x) => same(x.uuid, uuid));
  if (!r) return null;
  return { active: typeof r.active === "number" ? r.active : Number(r.active) };
}

async function readMirrorCategory(orgId: string, uuid: string): Promise<boolean | "failed"> {
  const { data, error } = await supabaseAdmin.from("sm8_categories").select("uuid, active").eq("org_id", orgId).in("uuid", spellings(uuid));
  if (error) return "failed";
  const r = ((data ?? []) as { uuid: string; active: unknown }[]).find((x) => same(x.uuid, uuid));
  return !!r && Number(r.active) === 1;
}
