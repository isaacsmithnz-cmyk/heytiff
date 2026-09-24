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
   is the proof, and every refusal logs what ServiceM8 said. */

import { SM8_API_BASE } from "./sm8";
import { fetchSm8Page } from "./sm8-read";
import { classifyWrite, type Sm8WriteOutcome } from "./sm8-write-plan";

/* A file of a few MB to a host in Australia, from a function in Singapore:
   generous, and still short of the row's lease (WRITE_LEASE_MS), so a slow
   request can't outlive its claim. */
const WRITE_TIMEOUT_MS = 60_000;

export type Sm8AttachmentUpload = {
  jobUuid: string;
  /** The uuid the record is created under — see the header. */
  uuid: string;
  /** Extension on: "Public liability.pdf". */
  fileName: string;
  mimeType: string;
  bytes: Uint8Array<ArrayBuffer>;
};

async function logRefusal(what: string, res: Response): Promise<void> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    detail = "<unreadable body>";
  }
  console.error(`[sm8] ${what} ${res.status} ${res.statusText}: ${detail}`);
}

/** What one request came back with: the decision, and the status it came
    as, which the row keeps for whoever has to diagnose it. */
export type Sm8WriteResult = { status: number | null; outcome: Sm8WriteOutcome };

/** Put one file on one job. Never throws: an outcome is always returned, and
    the plan decides what it means for the row and for the run. */
export async function postSm8Attachment(
  accessToken: string,
  upload: Sm8AttachmentUpload
): Promise<Sm8WriteResult> {
  const form = new FormData();
  form.append("related_object", "job");
  form.append("related_object_uuid", upload.jobUuid);
  form.append("attachment_name", upload.fileName);
  form.append("uuid", upload.uuid);
  /* the file LAST: a streaming parser reads the fields it needs to place the
     bytes before it reaches them */
  form.append("file", new Blob([upload.bytes], { type: upload.mimeType }), upload.fileName);

  let res: Response;
  try {
    res = await fetch(new URL("attachment.json", SM8_API_BASE).toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(
      `[sm8] POST attachment.json request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: null, outcome: { kind: "unavailable", status: null } };
  }

  if (!res.ok) await logRefusal("POST attachment.json", res);
  return { status: res.status, outcome: classifyWrite(res.status, res.headers.get("x-record-uuid")) };
}

export type Sm8AttachmentCheck =
  | { ok: true; found: false }
  | { ok: true; found: true; jobUuid: string | null; active: boolean }
  | { ok: false };

const UUID = /^[0-9a-f-]{36}$/i;

/** Read one attachment's record back: how a 409 on our own uuid is
    confirmed as OUR earlier attempt rather than some other conflict.

    THROUGH THE LIST ENDPOINT, filtered to the one uuid, on purpose. The
    single-record path is the part of ServiceM8's attachment surface its
    docs disagree about (sm8-attachment-probe.ts walks three shapes for the
    bytes), while attachment.json with a $filter is what the sync engine has
    read twenty-five thousand rows through. The filter is built from a uuid
    WE minted, and checked against the shape before it goes. */
export async function readSm8Attachment(accessToken: string, uuid: string): Promise<Sm8AttachmentCheck> {
  if (!UUID.test(uuid)) return { ok: true, found: false };
  const page = await fetchSm8Page(accessToken, "attachment.json", {
    cursor: "-1",
    filter: `uuid eq '${uuid}'`,
  });
  if (!page.ok) return { ok: false };
  const row = page.rows.find((r) => r.uuid === uuid);
  if (!row) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    jobUuid: typeof row.related_object_uuid === "string" ? row.related_object_uuid : null,
    active: Number(row.active) === 1,
  };
}
