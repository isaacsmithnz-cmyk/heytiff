/* The requests that write to ServiceM8 — server only.

   sm8-read.ts's sibling for the other direction, and the same posture: the
   decisions come back as data (sm8-write-plan's Sm8WriteOutcome), never as
   ServiceM8's own words. A refused request's body goes to the server log,
   truncated, because the body is the diagnosis (a 403's names the scope
   ServiceM8 actually wanted) and a vendor's error text belongs nowhere near
   a page or a token.

   ONE REQUEST PER FILE. ServiceM8 takes the attachment's record and its
   bytes together as a single multipart POST to attachment.json — their
   "Attaching files to a Job Diary" guide, which calls the older two-step
   route (a JSON record, then the bytes to attachment/{uuid}.file) legacy.
   One request means a file can't be left half-made: a record with no bytes
   behind it would show on the job as a broken file.

   WHAT IS SENT, and what deliberately isn't:
     related_object       "job"
     related_object_uuid  the job
     attachment_name      the name, extension on
     uuid                 ours, chosen when the write was queued — so a retry
                          names the same record rather than making another
     file                 the bytes, named with the extension, because
                          ServiceM8 reads the file's type off the name
   Not file_type and not active: the guide says the multipart route derives
   the one from the file's name and sets the other itself.

   Verified against the guide by search on 2026-09-24; the developer site
   itself isn't reachable from the build environment. The first live send
   is the proof, and every refusal logs what ServiceM8 said.

   ON LANE `write`, BOTH OF THEM. The upload and the read-back take their
   turns from the account's counter (sm8-meter) on the lane with no floor,
   so a sync walking beside them can never starve a send or its check, and
   with no patience, because both run under a row's claim. A turn the
   counter refuses makes no request: either comes back rate-limited by
   HeyTiff's own counter (`ours`), with the counter's wait and whether its
   limit is a daily one, and the sender hands the attempt back. */

import { sm8BusyOf, sm8Request, type Sm8Call } from "./sm8-http";
import { fetchSm8Page, type Sm8Page } from "./sm8-read";
import { dateOrNull, intOrNull, textOrNull } from "./sm8-sync-plan";
import { STATUS_KEPT_FIELDS } from "./sm8-booking-plan";
import { availabilityBody, LEAVE_STAMP, type Sm8LiveAvailability } from "./sm8-leave-plan";
import {
  classifyWrite,
  readRemoteError,
  WRITE_NOTE_TIMEOUT_MS,
  WRITE_READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  type RemoteError,
  type Sm8WriteOutcome,
} from "./sm8-write-plan";

/* The upload's timeout and the read-back's are the plan's (WRITE_TIMEOUT_MS,
   WRITE_READ_TIMEOUT_MS): they are two of the clocks that must all fit
   inside one row's claim, and the sum is pinned there. */

export type Sm8AttachmentUpload = {
  jobUuid: string;
  /** The uuid the record is created under — see the header. */
  uuid: string;
  /** Extension on: "Public liability.pdf". */
  fileName: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
};

/** A refused request's body, read once: to the server log, truncated, and
    back as ServiceM8's code and message for the decision and the row. */
async function readRefusal(what: string, res: Response): Promise<RemoteError> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    console.error(`[sm8] ${what} ${res.status} ${res.statusText}: <unreadable body>`);
    return { code: null, message: null };
  }
  console.error(`[sm8] ${what} ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  return readRemoteError(body, res.headers.get("content-type"));
}

/** What one request came back with: the decision, the status it came as,
    and what ServiceM8 said when it refused — all kept on the row for
    whoever has to diagnose it. */
export type Sm8WriteResult = { status: number | null; outcome: Sm8WriteOutcome; remote: RemoteError | null };

/** Put one file on one job. Never throws: an outcome is always returned, and
    the plan decides what it means for the row and for the run. */
export async function postSm8Attachment(call: Sm8Call, upload: Sm8AttachmentUpload): Promise<Sm8WriteResult> {
  const form = new FormData();
  form.append("related_object", "job");
  form.append("related_object_uuid", upload.jobUuid);
  form.append("attachment_name", upload.fileName);
  form.append("uuid", upload.uuid);
  /* the file LAST: a streaming parser reads the fields it needs to place the
     bytes before it reaches them */
  form.append("file", new Blob([upload.bytes], { type: upload.mimeType }), upload.fileName);

  let res: Response;
  let limit: "minute" | "day" | null = null;
  try {
    const answer = await sm8Request(call, "attachment.json", { method: "POST", body: form, timeoutMs: WRITE_TIMEOUT_MS });
    if (answer.kind === "throttled") {
      /* nothing went: the account's own counter had no turn for it */
      const busy = sm8BusyOf(answer) ?? { waitMs: answer.waitMs, day: false };
      return {
        status: null,
        outcome: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day },
        remote: null,
      };
    }
    res = answer.res;
    limit = answer.limit;
  } catch (err) {
    console.error(
      `[sm8] POST attachment.json request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: null, outcome: { kind: "unavailable", status: null }, remote: null };
  }

  const remote = res.ok ? null : await readRefusal("POST attachment.json", res);
  let outcome = classifyWrite(res.status, res.headers.get("x-record-uuid"), remote);
  /* the door read the 429's body too: either reading "per day" is the day */
  if (outcome.kind === "rate_limited" && limit === "day") outcome = { kind: "rate_limited", limit: "day" };
  return { status: res.status, outcome, remote };
}

export type Sm8AttachmentCheck =
  | { ok: true; found: false }
  | { ok: true; found: true; jobUuid: string | null; active: boolean }
  /** `limited`: the account's call limit had no room — the counter refused
      the turn (`ours`, with its wait), or ServiceM8 answered 429 (its
      minute or its day) — as the outcome the sender hands the attempt back
      with. Not the record's doing. */
  | { ok: false; limited?: Extract<Sm8WriteOutcome, { kind: "rate_limited" }> };

const UUID = /^[0-9a-f-]{36}$/i;

/** Read one attachment's record back: how a 409 on our own uuid is
    confirmed as OUR earlier attempt rather than some other conflict, and how
    a re-pressed file checks whether its last, unanswered upload landed after
    all (sm8-writes' sendOne) before it goes under a new uuid.

    THROUGH THE LIST ENDPOINT, filtered to the one uuid, on purpose. The
    single-record path is the part of ServiceM8's attachment surface its
    docs disagree about (sm8-attachment-probe.ts walks three shapes for the
    bytes), while attachment.json with a $filter is what the sync engine has
    read twenty-five thousand rows through. The filter is built from a uuid
    WE minted, and checked against the shape before it goes. */
export async function readSm8Attachment(call: Sm8Call, uuid: string): Promise<Sm8AttachmentCheck> {
  if (!UUID.test(uuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(call, "attachment.json", {
    cursor: "-1",
    filter: `uuid eq '${uuid}'`,
    timeoutMs: WRITE_READ_TIMEOUT_MS,
  });
  if (!page.ok) {
    if (page.failure === "throttled") {
      const busy = page.busy ?? { waitMs: 0, day: false };
      return { ok: false, limited: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day } };
    }
    if (page.failure === "rate_limited") {
      return { ok: false, limited: { kind: "rate_limited", limit: page.busy?.day ? "day" : "minute" } };
    }
    return { ok: false };
  }
  const row = page.rows.find((r) => r.uuid === uuid);
  if (!row) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    jobUuid: typeof row.related_object_uuid === "string" ? row.related_object_uuid : null,
    active: Number(row.active) === 1,
  };
}

/* ── notes (two-way phase 2) ──

   A NOTE GOES AS THE PERSON WHO PRESSED IT. Every request that changes a
   note carries x-impersonate-uuid with that person's ServiceM8 staff uuid
   (sm8-http checks its shape before anything goes), so ServiceM8's diary
   says who wrote it, and its @mention alerts come from them. The read-back
   is NEVER impersonated: it is the account asking what is there.

   THE PATHS, read off ServiceM8's developer reference on 2026-09-25:
     POST   note.json               "Create a new Note"   (publish_job_notes)
     POST   dbonote/{uuid}.json     "Update a Note"       (publish_job_notes)
     DELETE dbonote/{uuid}.json     "Delete a Note"       (publish_job_notes;
                                     a delete sets active = 0)
     GET    note.json?$filter=uuid eq '…'                 (read_job_notes)
   Live test 1 proves them on the real account.

   A DELETE ON A NOTE ALREADY OUT OF SERVICEM8 PUTS IT BACK. The reference
   says a note already gone answers 404; the live walk of 2026-09-27 found
   otherwise: a note its sender had removed inside ServiceM8 read active
   again the same second HeyTiff's DELETE reached it. So nothing here is
   trusted to say a note is gone — the sender reads it live before every
   DELETE and after one (sm8-note-send's sendDelete). */

/** One note request's answer: the decision, the status, what ServiceM8 said
    when it refused, and the uuid it names the record by. */
export type Sm8NoteResult = Sm8WriteResult & { recordUuid: string | null };

async function noteRequest(
  call: Sm8Call,
  what: string,
  path: string,
  init: { method: "POST" | "DELETE"; json?: unknown; impersonate: string }
): Promise<Sm8NoteResult> {
  let res: Response;
  let limit: "minute" | "day" | null = null;
  try {
    const answer = await sm8Request(call, path, { ...init, timeoutMs: WRITE_NOTE_TIMEOUT_MS });
    if (answer.kind === "throttled") {
      /* nothing went: the account's own counter had no turn for it */
      const busy = sm8BusyOf(answer) ?? { waitMs: answer.waitMs, day: false };
      return {
        status: null,
        outcome: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day },
        remote: null,
        recordUuid: null,
      };
    }
    res = answer.res;
    limit = answer.limit;
  } catch (err) {
    console.error(`[sm8] ${what} request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: null, outcome: { kind: "unavailable", status: null }, remote: null, recordUuid: null };
  }
  const remote = res.ok ? null : await readRefusal(what, res);
  const recordUuid = res.headers.get("x-record-uuid");
  let outcome = classifyWrite(res.status, recordUuid, remote);
  if (outcome.kind === "rate_limited" && limit === "day") outcome = { kind: "rate_limited", limit: "day" };
  return { status: res.status, outcome, remote, recordUuid };
}

/** Put one note on one job, as `asStaffUuid`, under OUR uuid (so a retry
    names the same record). Exactly these four fields, and never
    `action_required`: HeyTiff doesn't flag notes. Never throws for a
    ServiceM8 answer (a malformed staff uuid throws before anything goes). */
export async function postSm8Note(
  call: Sm8Call,
  note: { relatedUuid: string; uuid: string; text: string; asStaffUuid: string }
): Promise<Sm8NoteResult> {
  return noteRequest(call, "POST note.json", "note.json", {
    method: "POST",
    json: { related_object: "job", related_object_uuid: note.relatedUuid, note: note.text, uuid: note.uuid },
    impersonate: note.asStaffUuid,
  });
}

/** A uuid that can't be a note's answers as a note that isn't there. */
const NOT_A_NOTE: Sm8NoteResult = { status: 404, outcome: { kind: "rejected", status: 404 }, remote: null, recordUuid: null };

/** Mark a flagged note done as `asStaffUuid`, or clear the mark with `""`:
    the completer alone is sent, nothing else about the note. */
export async function updateSm8NoteCompleter(
  call: Sm8Call,
  uuid: string,
  completer: string,
  asStaffUuid: string
): Promise<Sm8NoteResult> {
  if (!UUID.test(uuid)) return NOT_A_NOTE;
  return noteRequest(call, "POST dbonote", `dbonote/${uuid}.json`, {
    method: "POST",
    json: { action_completed_by_staff_uuid: completer },
    impersonate: asStaffUuid,
  });
}

/** Take one note out of ServiceM8, as `asStaffUuid`. Sent only after a live
    read found the note there and active: on a note already out it puts the
    note back (see above). Its answer, a 2xx or a 404 alike, proves nothing
    about where the note stands; the sender reads it back. */
export async function deleteSm8Note(call: Sm8Call, uuid: string, asStaffUuid: string): Promise<Sm8NoteResult> {
  if (!UUID.test(uuid)) return NOT_A_NOTE;
  return noteRequest(call, "DELETE dbonote", `dbonote/${uuid}.json`, { method: "DELETE", impersonate: asStaffUuid });
}

export type Sm8NoteCheck =
  | { ok: true; found: false }
  | {
      ok: true;
      found: true;
      relatedUuid: string | null;
      active: boolean;
      flagged: boolean;
      completedBy: string | null;
      editDate: string | null;
      editBy: string | null;
    }
  /** `limited`: the call limit had no room, as the outcome to hand the
      attempt back with. `unauthorized`: ServiceM8 refused the token (a 401),
      which the note sender's confirmDead reads as a dead grant. */
  | { ok: false; limited?: Extract<Sm8WriteOutcome, { kind: "rate_limited" }>; unauthorized?: boolean };

/** Read one note back, the account asking (never impersonated): how a lost
    answer is settled before anything goes again, and how a flag change
    checks nobody changed the note since it was seen.

    SHAPED EXACTLY AS THE MIRROR SHAPES A NOTE (sm8-sync-plan's shapeNote):
    the edit time through dateOrNull (the zero date reads null), names and
    uuids through textOrNull ("" reads null), `active` as intOrNull = 1, and
    the flag as action_required = "1". Otherwise a live edit time would
    never equal the mirror's, and every Mark done would be cancelled as
    changed. Through the list endpoint filtered to the one uuid, like the
    attachment read-back. */
export async function readSm8Note(call: Sm8Call, uuid: string): Promise<Sm8NoteCheck> {
  if (!UUID.test(uuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(call, "note.json", {
    cursor: "-1",
    filter: `uuid eq '${uuid}'`,
    timeoutMs: WRITE_READ_TIMEOUT_MS,
  });
  if (!page.ok) {
    if (page.failure === "throttled") {
      const busy = page.busy ?? { waitMs: 0, day: false };
      return { ok: false, limited: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day } };
    }
    if (page.failure === "rate_limited") {
      return { ok: false, limited: { kind: "rate_limited", limit: page.busy?.day ? "day" : "minute" } };
    }
    if (page.failure === "unauthorized") return { ok: false, unauthorized: true };
    return { ok: false };
  }
  const want = uuid.toLowerCase();
  const row = page.rows.find((r) => typeof r.uuid === "string" && r.uuid.toLowerCase() === want);
  if (!row) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    relatedUuid: textOrNull(row.related_object_uuid),
    active: intOrNull(row.active) === 1,
    flagged: textOrNull(row.action_required) === "1",
    completedBy: textOrNull(row.action_completed_by_staff_uuid),
    editDate: dateOrNull(row.edit_date),
    editBy: textOrNull(row.edit_by_staff_uuid),
  };
}

/* ── bookings (two-way phase 3) ──

   A BOOKING GOES AS THE APP, never as a person: no request here carries
   x-impersonate-uuid, and every read is the account asking.

   THE PATHS, read off ServiceM8's developer reference on 2026-09-26
   (the spec's F1 to F7, and F19):
     POST   jobactivity.json               create a booking   (manage_schedule)
     DELETE jobactivity/{uuid}.json        remove one         (manage_schedule;
                                           it sets active = 0)
     GET    jobactivity.json?$filter=…     one by uuid, or a job's (read_schedule)
     POST   job/{uuid}.json                a job's status, and nothing else
                                           (manage_jobs)
     GET    job.json?$filter=uuid eq '…'   one job            (read_jobs)
   NEVER a DELETE on a job, never `active` in a body, and nothing on job
   allocations, allocation windows or availability, though manage_schedule
   and manage_jobs reach them (a test reads this source for each).

   A DELETE ON A BOOKING ALREADY REMOVED MAY PUT IT BACK. ServiceM8's DELETE
   of a note already out of it restored the note on the live walk of
   2026-09-27, and a booking is taken to do the same. So nothing here is
   trusted to say a booking is gone: the sender reads it live before every
   DELETE and after one (sm8-booking-send).

   SHAPED EXACTLY AS THE MIRROR SHAPES THEM (sm8-sync-plan's shapeActivity
   and shapeJob): uuids and text through textOrNull, times through
   dateOrNull, flags through intOrNull. A booking's start and end are the
   account's wall clock as text, "YYYY-MM-DD HH:MM:SS" (P1 read one booked
   by hand back as exactly the time chosen), compared as text and never
   parsed into a Date. */

/** One booking request's answer: the decision, the status, what ServiceM8
    said when it refused, and the uuid it names the record by
    (x-record-uuid). */
export type Sm8BookingResult = Sm8WriteResult & { recordUuid: string | null };

/** A booking's time as it goes: the account's wall clock, on the minute. */
const BOOKING_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/;

/** A request HeyTiff refused to build (a malformed uuid or time): nothing
    went, and the row fails as refused — never as gone. */
const NOT_SENT: Sm8BookingResult = { status: null, outcome: { kind: "rejected", status: 400 }, remote: null, recordUuid: null };

async function bookingRequest(
  call: Sm8Call,
  what: string,
  path: string,
  init: { method: "POST" | "DELETE"; json?: unknown }
): Promise<Sm8BookingResult> {
  let res: Response;
  let limit: "minute" | "day" | null = null;
  try {
    const answer = await sm8Request(call, path, { ...init, timeoutMs: WRITE_NOTE_TIMEOUT_MS });
    if (answer.kind === "throttled") {
      /* nothing went: the account's own counter had no turn for it */
      const busy = sm8BusyOf(answer) ?? { waitMs: answer.waitMs, day: false };
      return {
        status: null,
        outcome: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day },
        remote: null,
        recordUuid: null,
      };
    }
    res = answer.res;
    limit = answer.limit;
  } catch (err) {
    console.error(`[sm8] ${what} request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { status: null, outcome: { kind: "unavailable", status: null }, remote: null, recordUuid: null };
  }
  const remote = res.ok ? null : await readRefusal(what, res);
  const recordUuid = res.headers.get("x-record-uuid");
  let outcome = classifyWrite(res.status, recordUuid, remote);
  if (outcome.kind === "rate_limited" && limit === "day") outcome = { kind: "rate_limited", limit: "day" };
  return { status: res.status, outcome, remote, recordUuid };
}

/** Book one person on one job, under OUR uuid (so a retry names the same
    record), with EXACTLY these six fields: the uuid, the job, the person,
    the start and the end on the account's wall clock, and the flag that
    makes it a scheduled booking — a string, as ServiceM8's schema types it
    (U13). Never `active`, never a status, never anything else. */
export async function postSm8Booking(
  call: Sm8Call,
  b: { uuid: string; jobUuid: string; staffUuid: string; start: string; end: string }
): Promise<Sm8BookingResult> {
  if (!UUID.test(b.uuid) || !UUID.test(b.jobUuid) || !UUID.test(b.staffUuid)) return NOT_SENT;
  if (!BOOKING_STAMP.test(b.start) || !BOOKING_STAMP.test(b.end)) return NOT_SENT;
  return bookingRequest(call, "POST jobactivity.json", "jobactivity.json", {
    method: "POST",
    json: {
      uuid: b.uuid,
      job_uuid: b.jobUuid,
      staff_uuid: b.staffUuid,
      start_date: b.start,
      end_date: b.end,
      activity_was_scheduled: "1",
    },
  });
}

/** Make a Quote a Work Order: the status ALONE, which ServiceM8's update
    schema requires (F7). The type allows no other status, and the body no
    other field. */
export async function postSm8JobStatus(call: Sm8Call, jobUuid: string, status: "Work Order"): Promise<Sm8BookingResult> {
  if (!UUID.test(jobUuid) || status !== "Work Order") return NOT_SENT;
  return bookingRequest(call, "POST job", `job/${jobUuid}.json`, { method: "POST", json: { status } });
}

/** Take one booking out of ServiceM8. Sent only after a live read found it
    there and active on its job: on a booking already removed it may put it
    back (see above). Its answer, a 2xx or a 404 alike, proves nothing about
    where the booking stands; the sender reads it back. */
export async function deleteSm8Booking(call: Sm8Call, uuid: string): Promise<Sm8BookingResult> {
  if (!UUID.test(uuid)) return NOT_SENT;
  return bookingRequest(call, "DELETE jobactivity", `jobactivity/${uuid}.json`, { method: "DELETE" });
}

/** One of ServiceM8's job activities as HeyTiff reads it live: a booking
    (scheduled 1) or recorded time (a check-in, or time added by hand). */
export type Sm8LiveActivity = {
  uuid: string;
  jobUuid: string | null;
  staffUuid: string | null;
  start: string | null;
  end: string | null;
  /** activity_was_scheduled */
  scheduled: number | null;
  /** activity_was_recorded */
  recorded: number | null;
  active: number | null;
  editDate: string | null;
};

/** A read that couldn't be made: `limited` when the call limit had no room
    (the outcome to hand the attempt back with), `unauthorized` on a 401. */
export type Sm8ReadFailure = {
  ok: false;
  limited?: Extract<Sm8WriteOutcome, { kind: "rate_limited" }>;
  unauthorized?: boolean;
};

function readFailure(page: Extract<Sm8Page, { ok: false }>): Sm8ReadFailure {
  if (page.failure === "throttled") {
    const busy = page.busy ?? { waitMs: 0, day: false };
    return { ok: false, limited: { kind: "rate_limited", limit: "ours", waitMs: busy.waitMs, day: busy.day } };
  }
  if (page.failure === "rate_limited") {
    return { ok: false, limited: { kind: "rate_limited", limit: page.busy?.day ? "day" : "minute" } };
  }
  if (page.failure === "unauthorized") return { ok: false, unauthorized: true };
  return { ok: false };
}

/** A raw jobactivity row, shaped as the mirror shapes one, plus whether it
    was recorded. Null without a uuid. */
export function shapeLiveActivity(r: Record<string, unknown>): Sm8LiveActivity | null {
  const uuid = textOrNull(r.uuid);
  if (!uuid) return null;
  return {
    uuid,
    jobUuid: textOrNull(r.job_uuid),
    staffUuid: textOrNull(r.staff_uuid),
    start: dateOrNull(r.start_date),
    end: dateOrNull(r.end_date),
    scheduled: intOrNull(r.activity_was_scheduled),
    recorded: intOrNull(r.activity_was_recorded),
    active: intOrNull(r.active),
    editDate: dateOrNull(r.edit_date),
  };
}

export type Sm8BookingCheck =
  | { ok: true; found: false }
  | { ok: true; found: true; activity: Sm8LiveActivity }
  | Sm8ReadFailure;

/** Read one booking back by its uuid, the account asking, through the list
    endpoint filtered to the one uuid (the path the mirror reads through;
    the single-record path answers 404 once deleted, F4). Matched whatever
    the case. */
export async function readSm8Booking(call: Sm8Call, uuid: string): Promise<Sm8BookingCheck> {
  if (!UUID.test(uuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(call, "jobactivity.json", {
    cursor: "-1",
    filter: `uuid eq '${uuid}'`,
    timeoutMs: WRITE_READ_TIMEOUT_MS,
  });
  if (!page.ok) return readFailure(page);
  const want = uuid.toLowerCase();
  const row = page.rows.find((r) => typeof r.uuid === "string" && r.uuid.toLowerCase() === want);
  const activity = row ? shapeLiveActivity(row) : null;
  return activity ? { ok: true, found: true, activity } : { ok: true, found: false };
}

/** The pages one job's bookings may take before the read gives up: a job
    with more than this many thousand active activities is read as a read
    that failed, never as a partial answer. */
const JOB_BOOKING_PAGES = 3;

export type Sm8JobBookingsCheck = { ok: true; activities: Sm8LiveActivity[] } | Sm8ReadFailure;

/** Every active activity on one job — its bookings and its recorded time —
    the account asking. A job's check-ins are what a take-back looks for, so
    it is the whole list or nothing: a read cut short is a read that failed. */
export async function readSm8JobBookings(call: Sm8Call, jobUuid: string): Promise<Sm8JobBookingsCheck> {
  if (!UUID.test(jobUuid)) return { ok: true, activities: [] };
  const activities: Sm8LiveActivity[] = [];
  let cursor = "-1";
  for (let pages = 0; pages < JOB_BOOKING_PAGES; pages++) {
    const page = await fetchSm8Page(call, "jobactivity.json", {
      cursor,
      filter: `job_uuid eq '${jobUuid}' and active eq 1`,
      timeoutMs: WRITE_READ_TIMEOUT_MS,
    });
    if (!page.ok) return readFailure(page);
    for (const r of page.rows) {
      const a = shapeLiveActivity(r);
      if (a) activities.push(a);
    }
    if (!page.nextCursor) return { ok: true, activities };
    cursor = page.nextCursor;
  }
  console.error(`[sm8] job ${jobUuid}'s bookings passed ${JOB_BOOKING_PAGES} pages — read as a read that failed`);
  return { ok: false };
}

/** The six fields a change to Work Order must leave as they were. */
export type StatusKeptField = (typeof STATUS_KEPT_FIELDS)[number];

/** One job as HeyTiff reads it live, shaped as the mirror shapes it: its
    status, whether it is active, its edit time, the six fields the status
    change guards, and the four it only logs. */
export type Sm8LiveJob = {
  uuid: string;
  status: string | null;
  active: number | null;
  editDate: string | null;
  kept: Record<StatusKeptField, string | null>;
  /** May change with the status: logged, never guarded. */
  logged: {
    work_order_date: string | null;
    total_invoice_amount: string | null;
    work_done_description: string | null;
    queue_uuid: string | null;
  };
};

export type Sm8JobCheck = { ok: true; found: false } | { ok: true; found: true; job: Sm8LiveJob } | Sm8ReadFailure;

/** Read one job, the account asking (read_jobs, F19), filtered to its uuid.
    Matched whatever the case. */
export async function readSm8Job(call: Sm8Call, jobUuid: string): Promise<Sm8JobCheck> {
  if (!UUID.test(jobUuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(call, "job.json", {
    cursor: "-1",
    filter: `uuid eq '${jobUuid}'`,
    timeoutMs: WRITE_READ_TIMEOUT_MS,
  });
  if (!page.ok) return readFailure(page);
  const want = jobUuid.toLowerCase();
  const r = page.rows.find((x) => typeof x.uuid === "string" && x.uuid.toLowerCase() === want);
  const uuid = r ? textOrNull(r.uuid) : null;
  if (!r || !uuid) return { ok: true, found: false };
  const kept = Object.fromEntries(STATUS_KEPT_FIELDS.map((f) => [f, textOrNull(r[f])])) as Record<
    StatusKeptField,
    string | null
  >;
  return {
    ok: true,
    found: true,
    job: {
      uuid,
      status: textOrNull(r.status),
      active: intOrNull(r.active),
      editDate: dateOrNull(r.edit_date),
      kept,
      logged: {
        work_order_date: dateOrNull(r.work_order_date),
        total_invoice_amount: textOrNull(r.total_invoice_amount),
        work_done_description: textOrNull(r.work_done_description),
        queue_uuid: textOrNull(r.queue_uuid),
      },
    },
  };
}

/* ── leave: ServiceM8's own staff leave (availability.json) ──

   The paths and the scope were read off ServiceM8's developer reference on
   2026-09-28: "Create a new Availability" (POST availability.json,
   manage_schedule, a client uuid accepted, x-record-uuid on a 200), "Delete
   an Availability" (DELETE availability/{uuid}.json, which sets active to
   0) and "List all Availabilities" (GET availability.json, read_schedule,
   $filter). The fields are the ones the business's own leave came back
   with on the live account that day (sm8-leave-plan).

   A DELETE IS NEVER TRUSTED TO SAY LEAVE IS OFF THE BOARD, and never sent
   to a record already inactive: ServiceM8's DELETE of a note already
   removed put the note back (the notes walk, 2026-09-27), and leave is
   taken to do the same. So the sender reads it live before every DELETE
   and after one (sm8-leave-send). A read goes through the list endpoint
   filtered to one uuid, as a booking's does, because the single-record
   path answers 404 for a record that has been deleted. */

/** One leave request's answer — a booking's shape. */
export type Sm8LeaveResult = Sm8BookingResult;

/** Put one person's leave on the board, under OUR uuid, with exactly the
    seven fields availabilityBody makes. */
export async function postSm8Availability(
  call: Sm8Call,
  a: { uuid: string; staffUuid: string; name: string; start: string; end: string }
): Promise<Sm8LeaveResult> {
  if (!UUID.test(a.uuid) || !UUID.test(a.staffUuid)) return NOT_SENT;
  if (!LEAVE_STAMP.test(a.start) || !LEAVE_STAMP.test(a.end) || !(a.start < a.end)) return NOT_SENT;
  if (!a.name.trim()) return NOT_SENT;
  return bookingRequest(call, "POST availability.json", "availability.json", { method: "POST", json: availabilityBody(a) });
}

/** Take one leave off the board. Sent only after a live read found it
    there and active; its answer proves nothing, and the sender reads it
    back. */
export async function deleteSm8Availability(call: Sm8Call, uuid: string): Promise<Sm8LeaveResult> {
  if (!UUID.test(uuid)) return NOT_SENT;
  return bookingRequest(call, "DELETE availability", `availability/${uuid}.json`, { method: "DELETE" });
}

/** A raw availability row, shaped as the mirror shapes text and dates.
    Null without a uuid. */
export function shapeLiveAvailability(r: Record<string, unknown>): Sm8LiveAvailability | null {
  const uuid = textOrNull(r.uuid);
  if (!uuid) return null;
  return {
    uuid,
    regardingUuid: textOrNull(r.regarding_object_uuid),
    name: textOrNull(r.name),
    type: textOrNull(r.availability_type),
    start: dateOrNull(r.start_timestamp),
    end: dateOrNull(r.end_timestamp),
    active: intOrNull(r.active),
    editDate: dateOrNull(r.edit_date),
  };
}

export type Sm8AvailabilityCheck =
  | { ok: true; found: false }
  | { ok: true; found: true; availability: Sm8LiveAvailability }
  | Sm8ReadFailure;

/** Read one leave back by its uuid, the account asking, through the list
    endpoint filtered to the one uuid. Matched whatever the case. */
export async function readSm8Availability(call: Sm8Call, uuid: string): Promise<Sm8AvailabilityCheck> {
  if (!UUID.test(uuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(call, "availability.json", {
    cursor: "-1",
    filter: `uuid eq '${uuid}'`,
    timeoutMs: WRITE_READ_TIMEOUT_MS,
  });
  if (!page.ok) return readFailure(page);
  const want = uuid.toLowerCase();
  const row = page.rows.find((r) => typeof r.uuid === "string" && r.uuid.toLowerCase() === want);
  const availability = row ? shapeLiveAvailability(row) : null;
  return availability ? { ok: true, found: true, availability } : { ok: true, found: false };
}
