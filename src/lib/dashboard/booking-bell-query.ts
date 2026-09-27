/* A BOOKING'S TROUBLE, FOR THE BELL — server only (two-way phase 3, PR E).

   A booking to ServiceM8 is pressed on a job's card, and its state shows
   there, on the line where it was pressed. The bell is the other place:
   - THE PRESSER'S, one item per job whose line is bad — a booking that
     didn't go, one not taken out, one that may not have reached ServiceM8,
     one ServiceM8 kept at another time or on someone else, a leftover's
     Clear that didn't go — in the last seven days, at most five. The line is
     the card's own (sm8-booking-plan's bookingLine and clearLine), so the
     two never disagree, and the item opens the card where it is.
   - THE OWNER'S, when a read-back guard switched bookings off in the last
     seven days (a booking kept at another time or on someone else, a
     status change that changed more than the status, or a booking that
     can't be found after its answer — call 15).

   ONLY THE ACCOUNT CONNECTED NOW: a disconnect or an account switch leaves
   the old account's rows in the queue, and they say nothing here.

   NOTHING HERE READS ANYTHING until the deployment books (SM8_WRITES names
   `booking`): both readers return before their first read. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { readMirrorBookings, type BookingOverlayRow } from "@/lib/integrations/sm8-booking-overlay";
import { BOOKING_WORDS, bookingLine, clearLine, type BookingState } from "@/lib/integrations/sm8-booking-plan";
import { offersSend, sendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import type { BookingTroubleOp } from "./chips";

/** One bell item: the job, its number, and which words. */
export type BookingTrouble = { jobUuid: string; number: string; op: BookingTroubleOp };

/** At most this many items, one per job. */
const MOST = 5;
/** How many of the presser's rows are looked over, newest first. */
const ROWS_CAP = 200;

const COLUMNS =
  "id, op, status, subject, sm8_job_uuid, remote_uuid, replaced_uuids, maybe_landed, verify_uuids, taken_back_at, last_error, attempts, depends_on, target_uuid, verb_id, booking_staff_uuid, booking_start, booking_end, booking_zone, landed_edit_date, seen_edit_date, requested_by, requested_by_user, lease_until, created_at, pressed_at";

/** The spellings a uuid may carry in the mirror. */
const spellings = (u: string) => [...new Set([u, u.toLowerCase(), u.toUpperCase()])];

/** When a row was last pressed; its making, for a row that never says. */
const pressedAt = (r: { pressed_at?: string | null; created_at: string }): string => r.pressed_at ?? r.created_at;

/** The sending state, for the account connected now — or null with none.
    Loaded here, not at the top: the write engine brings the session. */
async function connectedState(orgId: string): Promise<Sm8WriteState | null> {
  const { readSm8WriteState } = await import("@/lib/integrations/sm8-writes");
  const state = await readSm8WriteState(orgId);
  return state.linked && state.tenantId ? state : null;
}

/** Which words a bad line is. */
function opOf(said: BookingState): BookingTroubleOp {
  switch (said.key) {
    case "line.keptOther":
    case "line.keptOtherPerson":
      return "keptOther";
    case "line.stillIn":
      return "stillIn";
    case "line.unsure":
      return "unsure";
    default:
      return "notSent";
  }
}

/** YOUR bookings whose line is bad, pressed (or taken back, or cleared) in
    the last seven days — by when each was last PRESSED: a Try again or a
    fresh press on a slot given back reuses its row, and keeps the row's
    created_at, so a booking first pressed a week ago that fails again
    today is today's — one item per job, newest first, at most five. A
    job the mirror doesn't hold says nothing. Empty where the deployment
    books nothing, and on any read that fails (logged). */
export async function myBookingTrouble(
  orgId: string,
  userId: string,
  sinceIso: string,
  now: number = Date.now(),
): Promise<BookingTrouble[]> {
  if (!sm8BookingsAllowed() || !userId) return [];
  const state = await connectedState(orgId);
  if (!state) return [];
  const tenant = state.tenantId!;

  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .eq("requested_by_user", userId)
    .gte("pressed_at", sinceIso)
    .order("pressed_at", { ascending: false })
    .limit(ROWS_CAP);
  if (error) {
    console.error(`[sm8] couldn't read org ${orgId}'s bookings for the bell:`, error);
    return [];
  }
  const mine = (data ?? []) as unknown as BookingOverlayRow[];
  if (mine.length === 0) return [];

  /* every create a line is drawn from: yours, and the ones behind a take-
     back of yours; then their status rows and their take-backs */
  const creates = new Map(mine.filter((r) => r.op === "create").map((r) => [r.id, r]));
  const clears = mine.filter((r) => r.op === "delete" && !r.depends_on);
  const behind = mine.filter((r) => r.op === "delete" && !!r.depends_on && !creates.has(r.depends_on)).map((r) => r.depends_on!);
  const more = await byIds(orgId, tenant, behind);
  if (!more) return [];
  for (const c of more) if (c.op === "create") creates.set(c.id, c);
  const statusIds = [...new Set([...creates.values()].map((c) => c.depends_on).filter((d): d is string => !!d))];
  const [statuses, backs, mirror, zone] = await Promise.all([
    byIds(orgId, tenant, statusIds),
    takeBacksOf(orgId, tenant, [...creates.keys()]),
    readMirrorBookings(orgId, [...creates.values()].map((c) => c.remote_uuid)),
    bookingZone(orgId),
  ]);
  if (!statuses || !backs) return [];
  const statusRows = new Map(statuses.map((s) => [s.id, s]));
  const takeBacks = new Map<string, BookingOverlayRow>();
  // the newest take-back of each create
  for (const b of [...backs].sort((x, y) => pressedAt(x).localeCompare(pressedAt(y)))) takeBacks.set(b.depends_on!, b);

  const hold = state.readable ? sendHold(state, "booking") : null;
  const offered = offersSend(state, "booking");
  const trial = state.mode === "trial";

  /* each press, newest first, as its line reads now */
  type Said = { at: string; job: string; op: BookingTroubleOp };
  const bad: Said[] = [];
  for (const c of creates.values()) {
    const m = mirror?.get(c.remote_uuid.toLowerCase()) ?? null;
    const said = bookingLine({
      create: c,
      statusRow: c.depends_on ? (statusRows.get(c.depends_on) ?? null) : null,
      takeBack: takeBacks.get(c.id) ?? null,
      hold,
      offered,
      trial,
      viewerIsPresser: true,
      mirror: m ? { active: m.active, jobUuid: m.jobUuid, staffUuid: m.staffUuid, start: m.start, end: m.end, editDate: m.editDate } : null,
      now,
      zone: zone.zone,
    });
    if (said.tone !== "bad" || !c.sm8_job_uuid) continue;
    const back = takeBacks.get(c.id);
    bad.push({ at: back && pressedAt(back) > pressedAt(c) ? pressedAt(back) : pressedAt(c), job: c.sm8_job_uuid, op: opOf(said) });
  }
  for (const r of clears) {
    const said = clearLine(r, hold);
    if (said?.tone === "bad" && r.sm8_job_uuid) bad.push({ at: pressedAt(r), job: r.sm8_job_uuid, op: "leftover" });
  }
  if (bad.length === 0) return [];

  const picked: Said[] = [];
  const seen = new Set<string>();
  for (const b of bad.sort((x, y) => y.at.localeCompare(x.at))) {
    const key = b.job.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(b);
  }
  const numbers = await jobNumbers(orgId, picked.map((p) => p.job));
  return picked
    .filter((p) => numbers.has(p.job.toLowerCase()))
    .slice(0, MOST)
    .map((p) => ({ jobUuid: p.job, number: numbers.get(p.job.toLowerCase())!, op: p.op }));
}

/** The read-back guards' own words, stored as they are (no placeholder in
    any). */
const GUARD_WORDS = [BOOKING_WORDS.row.timeNotKept, BOOKING_WORDS.row.personNotKept, BOOKING_WORDS.row.fieldsNotKept];

/** The job a read-back guard last switched bookings off on, in the last
    seven days — for the owner's bell. Null with none, where the deployment
    books nothing, or on a read that fails (logged).

    CALL 15 (decided yes): a create ServiceM8 answered OK that two read-
    backs can't find switches bookings off too. That row keeps the answer's
    2xx; an unsure row from a read-back after a LOST answer keeps none, and
    switched nothing off — so only the first is a guard here. */
export async function bookingGuardTripped(orgId: string, sinceIso: string): Promise<{ number: string } | null> {
  if (!sm8BookingsAllowed()) return null;
  const state = await connectedState(orgId);
  if (!state) return null;
  const base = () =>
    supabaseAdmin
      .from("sm8_writes")
      .select("sm8_job_uuid, updated_at")
      .eq("org_id", orgId)
      .eq("tenant_id", state.tenantId!)
      .eq("kind", "booking")
      .gte("updated_at", sinceIso);
  const [guards, unsure] = await Promise.all([
    base().in("last_error", GUARD_WORDS).order("updated_at", { ascending: false }).limit(1),
    base()
      .eq("last_error", BOOKING_WORDS.row.bookingUnsure)
      .gte("http_status", 200)
      .lt("http_status", 300)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);
  if (guards.error || unsure.error) {
    console.error(`[sm8] couldn't read org ${orgId}'s booking guards:`, guards.error ?? unsure.error);
    return null;
  }
  type Hit = { sm8_job_uuid: string | null; updated_at: string };
  const hits = [...((guards.data ?? []) as Hit[]), ...((unsure.data ?? []) as Hit[])].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );
  const job = hits[0]?.sm8_job_uuid ?? null;
  if (!job) return null;
  const numbers = await jobNumbers(orgId, [job]);
  return numbers.has(job.toLowerCase()) ? { number: numbers.get(job.toLowerCase())! } : null;
}

/** Booking rows by id, for this account. Null when they couldn't be read. */
async function byIds(orgId: string, tenant: string, ids: readonly string[]): Promise<BookingOverlayRow[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .in("id", [...ids]);
  if (error) {
    console.error(`[sm8] couldn't read org ${orgId}'s booking rows for the bell:`, error);
    return null;
  }
  return (data ?? []) as unknown as BookingOverlayRow[];
}

/** Every take-back of these creates. Null when they couldn't be read. */
async function takeBacksOf(orgId: string, tenant: string, createIds: readonly string[]): Promise<BookingOverlayRow[] | null> {
  if (createIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("sm8_writes")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("tenant_id", tenant)
    .eq("kind", "booking")
    .eq("op", "delete")
    .in("depends_on", [...createIds]);
  if (error) {
    console.error(`[sm8] couldn't read the take-backs of org ${orgId}'s bookings for the bell:`, error);
    return null;
  }
  return (data ?? []) as unknown as BookingOverlayRow[];
}

/** Each job's number, by its uuid in lower case. A read that fails names
    none: the bell then says nothing rather than something wrong. */
async function jobNumbers(orgId: string, jobUuids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (jobUuids.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id")
    .eq("org_id", orgId)
    .in("uuid", [...new Set(jobUuids.flatMap(spellings))]);
  if (error) {
    console.error(`[sm8] couldn't read org ${orgId}'s job numbers for the bell:`, error);
    return out;
  }
  for (const j of (data ?? []) as { uuid: string; generated_job_id: string | null }[]) {
    if (j.generated_job_id) out.set(j.uuid.toLowerCase(), j.generated_job_id);
  }
  return out;
}
