/* HeyTiff's booking rows over the mirror — server only (two-way phase 3,
   PR B).

   HEYTIFF NEVER WRITES ITS COPY OF SERVICEM8. The sync is the only writer
   of sm8_job_activities and sm8_jobs (sm8_calls_echo_freshness.sql), and
   phase 3 adds none. So between a booking going and the next sync, a
   reader asks here instead:
   - `gone`: of the uuids a reader asks about (and the bookings it draws
     from sentNotMirrored), THE ONES WE TOOK OUT — each one a take-back or
     a Clear that went DELETEd, or read inactive (the row keeps them, in
     verify_uuids), never one it merely didn't find: a booking whose POST
     was lost may land after its take-back looked, and is never hidden.
     UNWINDOWED: a uuid stays gone for as long as its delete row exists,
     not only until the mirror shows it inactive. Read only for the uuids
     asked, fifty to a request, so it never grows with the queue.
   - `sentNotMirrored`: the bookings we sent that the mirror doesn't hold
     yet, from today on — they ARE in ServiceM8. A uuid the mirror holds
     speaks for itself (active is booked, inactive is removed there), a job
     the mirror doesn't hold draws nothing, and a booking ServiceM8 kept at
     another time or on someone else, or that someone changed there, is
     never drawn at the row's time. One taken back is drawn until its
     take-back settles: a take-back that failed leaves it standing.
   - `rows`: for the jobs asked, each booking row a line is drawn from —
     every create from 30 days back, its status row and its take-back, and
     the Clears.

   ONLY THE ACCOUNT CONNECTED NOW. A disconnect wipes the mirror but not
   the queue, and an account switch clears the mirror: every read here is
   scoped to the connection's tenant, or the old account's bookings would
   be drawn as live. Nothing is read at all unless the deployment allows
   bookings (sm8BookingsAllowed) and a ServiceM8 account is connected.

   A READER DRAWS ON WHAT IT COULD READ; A PRESS DECIDES ON ALL OF IT OR
   NOTHING. readBookingOverlay says nothing for a part it couldn't read
   (logged); readBookingOverlayStrict is null then, and the queue's press
   queues nothing on it.

   NO READER HIDES A TWIN OF OURS. The mirror's copy of a booking we sent
   IS the booking; what goes away once it arrives is our row's own
   drawing (sentNotMirrored). */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8BookingsAllowed } from "./sm8-kinds";
import { localNow, reasonOf } from "./sm8-booking-plan";
import type { Sm8WriteState } from "./sm8-write-plan";

const TABLE = "sm8_writes";

/** Uuids per `in` filter: fifty keep a request line near 2 KB (sm8-echo's
    ECHO_CHUNK has the reasoning). */
const CHUNK = 50;

/** Uuids per read of the delete rows on a booking: each rides in three
    lists, in up to three spellings, so ten keep that request near 4 KB. */
const DELETES_CHUNK = 10;

/** How many rows one job's lines are read from, newest first. */
const ROWS_CAP = 500;

/** A line reaches back this far (by the booking's start). */
const LINE_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A booking we sent that the mirror doesn't hold yet, drawn as the
    activity it is. */
export type SentNotMirrored = {
  /** Our create's row. */
  rowId: string;
  uuid: string;
  jobUuid: string;
  staffUuid: string;
  start: string;
  end: string;
};

/** A booking row as a line reads it (sm8-booking-plan's bookingLine,
    statusLine and clearLine), with what ties the rows of a verb together. */
export type BookingOverlayRow = {
  id: string;
  op: string;
  status: string;
  subject: string;
  sm8_job_uuid: string | null;
  remote_uuid: string;
  replaced_uuids: string[] | null;
  maybe_landed: boolean | null;
  verify_uuids: string[] | null;
  taken_back_at: string | null;
  last_error: string | null;
  attempts: number;
  depends_on: string | null;
  target_uuid: string | null;
  verb_id: string | null;
  booking_staff_uuid: string | null;
  booking_start: string | null;
  booking_end: string | null;
  booking_zone: string | null;
  landed_edit_date: string | null;
  seen_edit_date: string | null;
  requested_by: string | null;
  requested_by_user: string | null;
  lease_until: string | null;
  created_at: string;
};

const ROW_COLUMNS =
  "id, op, status, subject, sm8_job_uuid, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, taken_back_at, last_error, attempts, depends_on, target_uuid, verb_id, booking_staff_uuid, booking_start, booking_end, booking_zone, landed_edit_date, seen_edit_date, requested_by, requested_by_user, lease_until, created_at";

export type BookingOverlay = {
  /** Lower case: of the uuids asked, and the ones sentNotMirrored draws. */
  gone: ReadonlySet<string>;
  sentNotMirrored: SentNotMirrored[];
  rows: BookingOverlayRow[];
};

/** What a reader asks the overlay for. `uuids` are the bookings it will
    draw (their mirror uuids): `gone` answers for these. `jobUuids` narrows
    sentNotMirrored to those jobs and reads their `rows` (unless `rows` is
    false); `from` and `to` window sentNotMirrored by the booking's start
    ("YYYY-MM-DD" or a stamp; from inclusive, to exclusive). */
export type BookingOverlayAsk = {
  uuids?: readonly string[];
  jobUuids?: readonly string[];
  from?: string;
  to?: string;
  rows?: boolean;
};

const empty = (): BookingOverlay => ({ gone: new Set(), sentNotMirrored: [], rows: [] });

const chunks = <T>(xs: readonly T[], size = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

/** The spellings a stored uuid may carry. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

/** Well-formed uuids, lower case, each once: only these ever go in a filter. */
const lowerUuids = (uuids: readonly (string | null | undefined)[]) =>
  [...new Set(uuids.filter((u): u is string => typeof u === "string" && UUID.test(u)).map((u) => u.toLowerCase()))];

/** A day "YYYY-MM-DD", `days` before `now`, by UTC — a floor a day wider
    than any zone's, which each row then narrows by its own zone. */
const utcDay = (now: number, days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/** The overlay for one workspace, for the account connected now, for a
    reader: a part that couldn't be read says nothing (logged). */
export async function readBookingOverlay(
  orgId: string,
  state: Pick<Sm8WriteState, "linked" | "tenantId">,
  ask: BookingOverlayAsk = {},
  now: number = Date.now()
): Promise<BookingOverlay> {
  return (await overlay(orgId, state, ask, now, false)) ?? empty();
}

/** The overlay for a PRESS: null when any read it needs failed, so the
    queue never decides a slot on half of what we sent or took out. */
export async function readBookingOverlayStrict(
  orgId: string,
  state: Pick<Sm8WriteState, "linked" | "tenantId">,
  ask: BookingOverlayAsk = {},
  now: number = Date.now()
): Promise<BookingOverlay | null> {
  return overlay(orgId, state, ask, now, true);
}

async function overlay(
  orgId: string,
  state: Pick<Sm8WriteState, "linked" | "tenantId">,
  ask: BookingOverlayAsk,
  now: number,
  strict: boolean
): Promise<BookingOverlay | null> {
  if (!sm8BookingsAllowed() || !state.linked || !state.tenantId) return empty();
  const tenant = state.tenantId;
  let sent = await readSentCandidates(orgId, tenant, ask, now);
  if (sent === null) {
    if (strict) return null;
    sent = [];
  }
  let gone = await readGoneOf(orgId, tenant, [...(ask.uuids ?? []), ...sent.map((r) => r.remote_uuid)]);
  if (gone === null) {
    if (strict) return null;
    gone = new Set();
  }
  const drawn = await notMirrored(orgId, sent, gone);
  if (drawn === null && strict) return null;
  const wantRows = ask.rows !== false && !!ask.jobUuids && ask.jobUuids.length > 0;
  const rows = wantRows ? await readRows(orgId, tenant, ask.jobUuids!, now) : [];
  if (rows === null && strict) return null;
  return { gone, sentNotMirrored: drawn ?? [], rows: rows ?? [] };
}

/** Of these uuids, the ones we took out, lower case: each one a take-back
    or a Clear that WENT took out — DELETEd, or read inactive — as the row
    keeps them (verify_uuids, lower case, on a sent delete row). Never one
    it merely didn't find. Null when it couldn't be read. */
async function readGoneOf(orgId: string, tenant: string, uuids: readonly string[]): Promise<Set<string> | null> {
  const wanted = lowerUuids(uuids);
  const gone = new Set<string>();
  const asked = new Set(wanted);
  for (const part of chunks(wanted)) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select("verify_uuids")
      .eq("org_id", orgId)
      .eq("tenant_id", tenant)
      .eq("kind", "booking")
      .eq("op", "delete")
      .eq("status", "sent")
      .or(`verify_uuids.ov.{${part.join(",")}}`);
    if (error) {
      console.error(`[sm8] couldn't read the bookings org ${orgId} removed:`, error);
      return null;
    }
    for (const r of (data ?? []) as { verify_uuids: string[] | null }[]) {
      for (const u of r.verify_uuids ?? []) if (asked.has(u.toLowerCase())) gone.add(u.toLowerCase());
    }
  }
  return gone;
}

type SentRow = {
  id: string;
  remote_uuid: string;
  sm8_job_uuid: string | null;
  booking_staff_uuid: string | null;
  booking_start: string | null;
  booking_end: string | null;
  booking_zone: string | null;
  last_error: string | null;
  taken_back_at: string | null;
};

/** A sent create's own words say the booking stands somewhere else, or as
    someone else booked it: the row can't draw it. */
const standsElsewhere = (lastError: string | null) => {
  const r = reasonOf(lastError);
  return r === "timeNotKept" || r === "personNotKept" || r === "movedThere";
};

/** The sent creates that could be drawn, from today on by each booking's
    own zone, not standing elsewhere, and not taken back BY A TAKE-BACK THAT
    SETTLED (it went, or found nothing to take back): one whose take-back
    failed, or was never queued, still stands. Null when it couldn't be
    read. */
async function readSentCandidates(orgId: string, tenant: string, ask: BookingOverlayAsk, now: number): Promise<SentRow[] | null> {
  let q = supabaseAdmin
    .from(TABLE)
    .select("id, remote_uuid, sm8_job_uuid, booking_staff_uuid, booking_start, booking_end, booking_zone, last_error, taken_back_at")
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("status", "sent")
    .gte("booking_start", utcDay(now, 1));
  if (ask.jobUuids && ask.jobUuids.length > 0) q = q.in("sm8_job_uuid", ask.jobUuids.flatMap(spellings));
  if (ask.from) q = q.gte("booking_start", ask.from);
  if (ask.to) q = q.lt("booking_start", ask.to);
  const { data, error } = await q.order("booking_start", { ascending: true }).limit(ROWS_CAP);
  if (error) {
    console.error(`[sm8] couldn't read the bookings org ${orgId} sent:`, error);
    return null;
  }
  const sent = ((data ?? []) as SentRow[]).filter((r) => {
    if (!r.remote_uuid || !r.sm8_job_uuid || !r.booking_staff_uuid || !r.booking_start || !r.booking_end) return false;
    if (standsElsewhere(r.last_error)) return false;
    const today = localNow(r.booking_zone, now)?.slice(0, 10);
    return !today || r.booking_start.slice(0, 10) >= today;
  });
  const takenBack = sent.filter((r) => r.taken_back_at).map((r) => r.id);
  if (takenBack.length === 0) return sent;
  const settled = new Set<string>();
  for (const part of chunks(takenBack)) {
    const { data: backs, error: backError } = await supabaseAdmin
      .from(TABLE)
      .select("depends_on, status, last_error")
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .eq("op", "delete")
      .in("depends_on", part);
    if (backError) {
      console.error(`[sm8] couldn't read the take-backs of org ${orgId}'s bookings:`, backError);
      return null;
    }
    for (const b of (backs ?? []) as { depends_on: string; status: string; last_error: string | null }[]) {
      if (b.status === "sent" || (b.status === "cancelled" && reasonOf(b.last_error) === "nothingToTakeBack")) settled.add(b.depends_on);
    }
  }
  return sent.filter((r) => !settled.has(r.id));
}

/** Of the candidates, the ones to draw: not taken out, not in the mirror,
    and on a job the mirror holds — one read of the mirror's activities and
    one of its jobs, lower case. Null when either couldn't be read. */
async function notMirrored(orgId: string, sent: readonly SentRow[], gone: ReadonlySet<string>): Promise<SentNotMirrored[] | null> {
  const left = sent.filter((r) => !gone.has(r.remote_uuid.toLowerCase()));
  if (left.length === 0) return [];
  const mirrored = await presentIn(orgId, "sm8_job_activities", left.map((r) => r.remote_uuid));
  const jobs = await presentIn(orgId, "sm8_jobs", [...new Set(left.map((r) => r.sm8_job_uuid!))]);
  if (!mirrored || !jobs) return null;
  return left
    .filter((r) => !mirrored.has(r.remote_uuid.toLowerCase()) && jobs.has(r.sm8_job_uuid!.toLowerCase()))
    .map((r) => ({
      rowId: r.id,
      uuid: r.remote_uuid,
      jobUuid: r.sm8_job_uuid!,
      staffUuid: r.booking_staff_uuid!,
      start: r.booking_start!,
      end: r.booking_end!,
    }));
}

/** Which of these uuids a mirror table holds, lower case, whatever the
    case each is stored in. Null when it couldn't be read. */
async function presentIn(orgId: string, table: "sm8_job_activities" | "sm8_jobs", uuids: readonly string[]): Promise<Set<string> | null> {
  const found = new Set<string>();
  for (const part of chunks(uuids)) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("uuid")
      .eq("org_id", orgId)
      .in("uuid", part.flatMap(spellings));
    if (error) {
      console.error(`[sm8] couldn't read ${table} for org ${orgId}'s bookings:`, error);
      return null;
    }
    for (const r of (data ?? []) as { uuid: string }[]) found.add(r.uuid.toLowerCase());
  }
  return found;
}

/** Every booking row a line on these jobs is drawn from: each create from
    30 days back (by its start), the status row each depends on, each one's
    take-back, and the Clears from the same days. Null when it couldn't be
    read. */
async function readRows(orgId: string, tenant: string, jobUuids: readonly string[], now: number): Promise<BookingOverlayRow[] | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .in("sm8_job_uuid", jobUuids.flatMap(spellings))
    .order("created_at", { ascending: false })
    .limit(ROWS_CAP);
  if (error) {
    console.error(`[sm8] couldn't read the booking rows of org ${orgId}'s jobs:`, error);
    return null;
  }
  const all = (data ?? []) as unknown as BookingOverlayRow[];
  const since = utcDay(now, LINE_DAYS + 1);
  const recent = (r: BookingOverlayRow) => !!r.booking_start && r.booking_start >= since;
  const creates = all.filter((r) => r.op === "create" && recent(r));
  const createIds = new Set(creates.map((c) => c.id));
  const statusIds = new Set(creates.map((c) => c.depends_on).filter((d): d is string => !!d));
  return all.filter(
    (r) =>
      createIds.has(r.id) ||
      (r.op === "update" && statusIds.has(r.id)) ||
      (r.op === "delete" && ((r.depends_on && createIds.has(r.depends_on)) || (!r.depends_on && recent(r))))
  );
}

/** The mirror's copy of each of these bookings, by lower-case uuid: what
    the queue's slot rules and a take-back compare against. Null when it
    couldn't be read. */
export type MirrorBooking = {
  uuid: string;
  jobUuid: string | null;
  staffUuid: string | null;
  start: string | null;
  end: string | null;
  scheduled: number | null;
  active: number | null;
  editDate: string | null;
};

export async function readMirrorBookings(orgId: string, uuids: readonly string[]): Promise<Map<string, MirrorBooking> | null> {
  const out = new Map<string, MirrorBooking>();
  const wanted = [...new Set(uuids.filter(Boolean))];
  for (const part of chunks(wanted)) {
    const { data, error } = await supabaseAdmin
      .from("sm8_job_activities")
      .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled, active, edit_date")
      .eq("org_id", orgId)
      .in("uuid", part.flatMap(spellings));
    if (error) {
      console.error(`[sm8] couldn't read org ${orgId}'s bookings from the mirror:`, error);
      return null;
    }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const uuid = typeof r.uuid === "string" ? r.uuid : null;
      if (!uuid) continue;
      out.set(uuid.toLowerCase(), {
        uuid,
        jobUuid: (r.job_uuid as string | null) ?? null,
        staffUuid: (r.staff_uuid as string | null) ?? null,
        start: (r.start_date as string | null) ?? null,
        end: (r.end_date as string | null) ?? null,
        scheduled: r.activity_was_scheduled == null ? null : Number(r.activity_was_scheduled),
        active: r.active == null ? null : Number(r.active),
        editDate: (r.edit_date as string | null) ?? null,
      });
    }
  }
  return out;
}

/* ── the take-backs and Clears of a booking ── */

/** One of our delete rows on a booking: an Undo (via its create) or a
    Clear (via its activity). */
export type DeleteOn = {
  id: string;
  via: "undo" | "clear";
  status: string;
  lease_until: string | null;
  updated_at: string | null;
  attempts: number;
  /** The booking uuids it names, lower case: a Clear its activity; an Undo
      every uuid its create has had, and every one its DELETE reached. */
  names: string[];
  /** One that went: the uuids it took out, lower case (see `gone`). */
  tookOut: string[];
  /** One that hasn't gone: the uuids its DELETE reached, lower case —
      whatever its attempts say, since a go that let its row go after a
      DELETE hands its attempt back. */
  reached: string[];
};

type DeleteRead = {
  id: string;
  status: string;
  lease_until: string | null;
  updated_at: string | null;
  attempts: number | null;
  target_uuid: string | null;
  depends_on: string | null;
  verify_uuids: string[] | null;
};

const DELETE_COLUMNS = "id, status, lease_until, updated_at, attempts, target_uuid, depends_on, verify_uuids";

const shapeDelete = (r: DeleteRead, via: DeleteOn["via"], names: readonly string[]): DeleteOn => ({
  id: r.id,
  via,
  status: r.status,
  lease_until: r.lease_until,
  updated_at: r.updated_at,
  attempts: r.attempts ?? 0,
  names: lowerUuids([...names, r.target_uuid, ...(r.verify_uuids ?? [])]),
  tookOut: r.status === "sent" ? lowerUuids(r.verify_uuids ?? []) : [],
  reached: r.status === "sent" ? [] : lowerUuids(r.verify_uuids ?? []),
});

/** EVERY TAKE-BACK AND CLEAR OF THESE BOOKINGS, whatever its status and
    whatever case the uuids are in: the Clears that name one, and the take-
    backs of every create of ours that has had one (as its uuid, one it
    replaced, or one waiting for its check). ONE DELETE PER BOOKING rests on
    it — the press refuses beside another in flight, and the sender waits
    for one being sent or just tried. Null when it couldn't be read. */
export async function readDeletesOn(orgId: string, uuids: readonly string[]): Promise<DeleteOn[] | null> {
  const wanted = lowerUuids(uuids);
  const found = new Map<string, DeleteOn>();
  for (const part of chunks(wanted, DELETES_CHUNK)) {
    const list = part.flatMap(spellings);
    const { data: clears, error: clearError } = await supabaseAdmin
      .from(TABLE)
      .select(DELETE_COLUMNS)
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .eq("op", "delete")
      .is("depends_on", null)
      .in("target_uuid", list);
    if (clearError) {
      console.error(`[sm8] couldn't read the Clears of org ${orgId}'s bookings:`, clearError);
      return null;
    }
    for (const r of (clears ?? []) as DeleteRead[]) found.set(r.id, shapeDelete(r, "clear", []));

    const joined = list.join(",");
    const { data: made, error: madeError } = await supabaseAdmin
      .from(TABLE)
      .select("id, remote_uuid, replaced_uuids, verify_uuids")
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .eq("op", "create")
      .or(`remote_uuid.in.(${joined}),replaced_uuids.ov.{${joined}},verify_uuids.ov.{${joined}}`);
    if (madeError) {
      console.error(`[sm8] couldn't read the bookings behind org ${orgId}'s take-backs:`, madeError);
      return null;
    }
    const creates = new Map(
      ((made ?? []) as { id: string; remote_uuid: string | null; replaced_uuids: string[] | null; verify_uuids: string[] | null }[]).map(
        (c) => [c.id, [c.remote_uuid, ...(c.replaced_uuids ?? []), ...(c.verify_uuids ?? [])].filter((u): u is string => !!u)] as const
      )
    );
    if (creates.size === 0) continue;
    const { data: undos, error: undoError } = await supabaseAdmin
      .from(TABLE)
      .select(DELETE_COLUMNS)
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .eq("op", "delete")
      .in("depends_on", [...creates.keys()]);
    if (undoError) {
      console.error(`[sm8] couldn't read the take-backs of org ${orgId}'s bookings:`, undoError);
      return null;
    }
    for (const r of (undos ?? []) as DeleteRead[]) found.set(r.id, shapeDelete(r, "undo", creates.get(r.depends_on ?? "") ?? []));
  }
  return [...found.values()];
}
