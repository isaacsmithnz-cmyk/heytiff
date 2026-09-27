/* HeyTiff's booking rows over the mirror — server only (two-way phase 3,
   PR B).

   HEYTIFF NEVER WRITES ITS COPY OF SERVICEM8. The sync is the only writer
   of sm8_job_activities and sm8_jobs (sm8_calls_echo_freshness.sql), and
   phase 3 adds none. So between a booking going and the next sync, a
   reader asks here instead:
   - `gone`: the bookings WE removed — the activity of every Clear that was
     sent, and every uuid of the create behind every Undo that was sent.
     UNWINDOWED: a uuid stays gone for as long as its delete row exists,
     not only until the mirror shows it inactive.
   - `sentNotMirrored`: the bookings we sent that the mirror doesn't hold
     yet, from today on — they ARE in ServiceM8. A uuid the mirror holds
     speaks for itself (active is booked, inactive is removed there), a job
     the mirror doesn't hold draws nothing, and a booking ServiceM8 kept at
     another time or on someone else, or that someone changed there, is
     never drawn at the row's time.
   - `rows`: for the jobs asked, each booking row a line is drawn from —
     every create from 30 days back, its status row and its take-back, and
     the Clears.

   ONLY THE ACCOUNT CONNECTED NOW. A disconnect wipes the mirror but not
   the queue, and an account switch clears the mirror: every read here is
   scoped to the connection's tenant, or the old account's bookings would
   be drawn as live. Nothing is read at all unless the deployment allows
   bookings (sm8BookingsAllowed) and a ServiceM8 account is connected.

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

/** How many rows one job's lines are read from, newest first. */
const ROWS_CAP = 500;

/** A line reaches back this far (by the booking's start). */
const LINE_DAYS = 30;

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
  /** Lower case. */
  gone: ReadonlySet<string>;
  sentNotMirrored: SentNotMirrored[];
  rows: BookingOverlayRow[];
};

const empty = (): BookingOverlay => ({ gone: new Set(), sentNotMirrored: [], rows: [] });

const chunks = <T>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

/** The spellings a mirror row's uuid may carry. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

/** A day "YYYY-MM-DD", `days` before `now`, by UTC — a floor a day wider
    than any zone's, which each row then narrows by its own zone. */
const utcDay = (now: number, days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/** The overlay for one workspace, for the account connected now: `jobUuids`
    narrows sentNotMirrored to those jobs and reads their `rows`; `from` and
    `to` window sentNotMirrored by the booking's start ("YYYY-MM-DD" or a
    stamp; from inclusive, to exclusive). `gone` is never windowed. */
export async function readBookingOverlay(
  orgId: string,
  state: Pick<Sm8WriteState, "linked" | "tenantId">,
  opts: { jobUuids?: readonly string[]; from?: string; to?: string } = {},
  now: number = Date.now()
): Promise<BookingOverlay> {
  if (!sm8BookingsAllowed() || !state.linked || !state.tenantId) return empty();
  const tenant = state.tenantId;
  const gone = await readGone(orgId, tenant);
  const sentNotMirrored = await readSentNotMirrored(orgId, tenant, gone, opts, now);
  const rows = opts.jobUuids && opts.jobUuids.length > 0 ? await readRows(orgId, tenant, opts.jobUuids, now) : [];
  return { gone, sentNotMirrored, rows };
}

/** The uuids we removed, lower case: the activity of every sent Clear, and
    through every sent Undo, its create's uuids (the one it went under and
    every one it replaced). A read that fails removes nothing, logged: a
    booking we removed then shows until the sync, never one we didn't. */
async function readGone(orgId: string, tenant: string): Promise<Set<string>> {
  const gone = new Set<string>();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("id, target_uuid, depends_on")
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .eq("op", "delete")
    .eq("status", "sent");
  if (error) {
    console.error(`[sm8] couldn't read the bookings org ${orgId} removed:`, error);
    return gone;
  }
  const deletes = (data ?? []) as { id: string; target_uuid: string | null; depends_on: string | null }[];
  const creates: string[] = [];
  for (const d of deletes) {
    if (d.target_uuid) gone.add(d.target_uuid.toLowerCase());
    if (d.depends_on) creates.push(d.depends_on);
  }
  for (const part of chunks([...new Set(creates)])) {
    const { data: made, error: madeError } = await supabaseAdmin
      .from(TABLE)
      .select("id, remote_uuid, replaced_uuids")
      .eq("org_id", orgId)
      .eq("kind", "booking")
      .in("id", part);
    if (madeError) {
      console.error(`[sm8] couldn't read the bookings behind org ${orgId}'s take-backs:`, madeError);
      continue;
    }
    for (const c of (made ?? []) as { remote_uuid: string | null; replaced_uuids: string[] | null }[]) {
      for (const u of [c.remote_uuid, ...(c.replaced_uuids ?? [])]) if (u) gone.add(u.toLowerCase());
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
};

/** A sent create's own words say the booking stands somewhere else, or as
    someone else booked it: the row can't draw it. */
const standsElsewhere = (lastError: string | null) => {
  const r = reasonOf(lastError);
  return r === "timeNotKept" || r === "personNotKept" || r === "movedThere";
};

async function readSentNotMirrored(
  orgId: string,
  tenant: string,
  gone: ReadonlySet<string>,
  opts: { jobUuids?: readonly string[]; from?: string; to?: string },
  now: number
): Promise<SentNotMirrored[]> {
  let q = supabaseAdmin
    .from(TABLE)
    .select("id, remote_uuid, sm8_job_uuid, booking_staff_uuid, booking_start, booking_end, booking_zone, last_error")
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .eq("op", "create")
    .eq("status", "sent")
    .is("taken_back_at", null)
    .gte("booking_start", utcDay(now, 1));
  if (opts.jobUuids && opts.jobUuids.length > 0) q = q.in("sm8_job_uuid", [...opts.jobUuids]);
  if (opts.from) q = q.gte("booking_start", opts.from);
  if (opts.to) q = q.lt("booking_start", opts.to);
  const { data, error } = await q.order("booking_start", { ascending: true }).limit(ROWS_CAP);
  if (error) {
    console.error(`[sm8] couldn't read the bookings org ${orgId} sent:`, error);
    return [];
  }
  /* from today on, by each booking's own zone */
  const sent = ((data ?? []) as SentRow[]).filter((r) => {
    if (!r.remote_uuid || !r.sm8_job_uuid || !r.booking_staff_uuid || !r.booking_start || !r.booking_end) return false;
    if (standsElsewhere(r.last_error) || gone.has(r.remote_uuid.toLowerCase())) return false;
    const today = localNow(r.booking_zone, now)?.slice(0, 10);
    return !today || r.booking_start.slice(0, 10) >= today;
  });
  if (sent.length === 0) return [];

  /* one read of the mirror's activities and one of its jobs, lower case */
  const mirrored = await presentIn(orgId, "sm8_job_activities", sent.map((r) => r.remote_uuid));
  const jobs = await presentIn(orgId, "sm8_jobs", [...new Set(sent.map((r) => r.sm8_job_uuid!))]);
  if (!mirrored || !jobs) return [];
  return sent
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
    take-back, and the Clears from the same days. */
async function readRows(orgId: string, tenant: string, jobUuids: readonly string[], now: number): Promise<BookingOverlayRow[]> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .in("sm8_job_uuid", [...jobUuids])
    .order("created_at", { ascending: false })
    .limit(ROWS_CAP);
  if (error) {
    console.error(`[sm8] couldn't read the booking rows of org ${orgId}'s jobs:`, error);
    return [];
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
