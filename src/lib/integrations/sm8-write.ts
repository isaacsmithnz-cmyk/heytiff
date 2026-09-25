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
import { fetchSm8Page } from "./sm8-read";
import { dateOrNull, intOrNull, textOrNull } from "./sm8-sync-plan";
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
                                     a delete sets active = 0, and a note
                                     already gone answers 404)
     GET    note.json?$filter=uuid eq '…'                 (read_job_notes)
   Live test 1 proves them on the real account. */

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

/** Take one note out of ServiceM8, as `asStaffUuid`. A 404 means it is gone
    already, which the sender counts as done. */
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
