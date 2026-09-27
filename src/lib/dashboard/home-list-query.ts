/* HOME'S RIGHT-HAND LIST — the reads. The rules and the words are
   ./home-list; this file fetches only what the page does not already hold.

   Everything else on the list — your tasks and the team's, the bell's dated
   chips, the open issues, the diary a task came from — is already in the
   page's hands, so the list places those and reads none of them again
   (`placeHomeList`). What is new is two questions:

     1. Which ServiceM8 Work Orders were won in the last 90 days and never
        booked at all? Three narrow reads: the work orders, then any scheduled
        diary block against them (one is enough to take a job off), then the
        survivors' client and category names — so each is the same mirror row
        the job card opens on — and, with the money grant, what has been paid.
     2. Which maintenance visits are open with no day and no ServiceM8 job,
        due within the board's horizon? The visits, then their agreements
        (only an active agreement's visits are the board's work).

   Behind `workboard`, like every job and booking on Home. NO SESSION HERE:
   the loader hands in what the viewer may see.

   A READ THAT FAILS IS NOT AN ABSENT ROW. Each read that errors says nothing
   rather than something wrong: a failed bookings read must never call every
   won job unbooked, so it drops the jobs instead. The list is shorter, never
   louder.

   OUR BOOKINGS OVER THE MIRROR (two-way phase 3, PR E), only where the
   deployment books (SM8_WRITES names `booking`) — anywhere else not one read
   more is made, and the reads hand back exactly what they did. HeyTiff never
   writes its copy of ServiceM8, so until the next sync:
     - a booking we sent that the mirror doesn't hold yet books its job, which
       leaves the list at once; a booking we took out books nothing;
     - a job whose booking of ours isn't standing — on its way, held, failed,
       unsure, a trial — stays, and says so (its `bookingLines` entry);
     - a future booking on a finished job is a leftover (`loadLeftovers`),
       an alert of its own with Clear.
   Whether Book in and Clear book here is `caps.bookIn`: bookings offered,
   and a viewer who may press them — the job card's own rule. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import { sm8CategoryColour, type AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { oneLine } from "@/lib/workboard/all-jobs-query";
import { plusDays } from "@/lib/workboard/dates";
import { jobMoneyOf, parseSm8AmountToCents, SM8_JOB_MONEY_COLUMNS } from "@/lib/workboard/job-money";
import { sm8BookingsAllowed } from "@/lib/integrations/sm8-kinds";
import { bookingZone } from "@/lib/integrations/sm8-booking-zone";
import { readBookingOverlay, readMirrorBookings, type BookingOverlayRow } from "@/lib/integrations/sm8-booking-overlay";
import {
  BOOKINGS_OPEN_TO_MANAGERS,
  bookingLine,
  isLeftover,
  type BookingState,
} from "@/lib/integrations/sm8-booking-plan";
import { offersSend, sendHold, type SendHold, type Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import {
  VISIT_WINDOW_DAYS,
  WON_WINDOW_DAYS,
  firstNames,
  type HomeListReads,
  type LeftoverRow,
  type ListCaps,
  type VisitToBook,
  type WonJob,
} from "./home-list";
import type { StaffNames } from "./tasks-query";

/** When a booking row was last pressed: a re-press keeps the row and its
    created_at. Its making, for a row that never says. */
const pressedAt = (r: { pressed_at?: string | null; created_at: string }): string => r.pressed_at ?? r.created_at;

/** What the list needs from the page loader — a part of the new Home's
    shared context (`DeskContext`, ./desk-data), which `loadDesk` hands in as
    it is. */
export type HomeListContext = {
  orgId: string;
  caps: ReadonlySet<Capability>;
  /** The workspace's day — the one the day bar draws. */
  railDay: string;
  tz: string | null;
  names: StaffNames;
  /** The expiry window the bell warns by, read once for the page. */
  shared: { expiry: { warnDays: number } };
  /** Does the workspace hold a ServiceM8 copy — `sm8VendorOf`'s `connected`,
      which the page already reads. Required, and never guessed from `tz`: a
      failed vendor read comes back connected with no zone, and an account
      row can carry no zone, so a zone standing in would empty Jobs to book
      for a workspace that has them. */
  connected: boolean;
  /** The viewer is the workspace's owner — who may book while bookings are
      the owner's (BOOKINGS_OPEN_TO_MANAGERS). Doubt is no. */
  isOwner?: boolean;
};

/** What the list knows about booking in ServiceM8, read once for the page:
    the sending state, the account's zone, and whether Book in and Clear
    book from here. Only where the deployment books. */
export type ListBookings = {
  state: Sm8WriteState;
  /** The account's own zone; null when HeyTiff doesn't know it. */
  zone: string | null;
  hold: SendHold;
  offered: boolean;
  trial: boolean;
  /** caps.bookIn: offered, Workboard manage, and the owner while bookings
      are the owner's. */
  bookIn: boolean;
};

/** The list's booking side, or null where the deployment books nothing (no
    read of any kind is made), or it couldn't be read (logged: the list is
    then the one it always was). The write engine is loaded here, not at the
    top: it brings the session with it, which the list's other reads don't
    need. */
async function readListBookings(ctx: HomeListContext): Promise<ListBookings | null> {
  if (!sm8BookingsAllowed()) return null;
  try {
    const { readSm8WriteState } = await import("@/lib/integrations/sm8-writes");
    const [state, zone] = await Promise.all([readSm8WriteState(ctx.orgId), bookingZone(ctx.orgId)]);
    const offered = offersSend(state, "booking");
    return {
      state,
      zone: zone.zone,
      hold: state.readable ? sendHold(state, "booking") : null,
      offered,
      trial: state.mode === "trial",
      bookIn: offered && ctx.caps.has("workboard_manage") && (BOOKINGS_OPEN_TO_MANAGERS || ctx.isOwner === true),
    };
  } catch (err) {
    console.error(`[home-list] couldn't read the bookings state for org ${ctx.orgId}:`, err);
    return null;
  }
}

/** The list's own reads, placed later by `placeHomeList` beside the page's. */
export async function loadHomeList(ctx: HomeListContext): Promise<HomeListReads> {
  const board = ctx.caps.has("workboard");
  const caps: ListCaps = {
    assetsAll: ctx.caps.has("assets_all"),
    placeVisits: board && ctx.caps.has("workboard_manage"),
    money: board && ctx.caps.has("workboard_money"),
    sm8: ctx.connected,
  };
  /* bookings, only where the deployment books and the workspace has a
     ServiceM8 copy to book in */
  const bookings = board && caps.sm8 ? await readListBookings(ctx) : null;
  if (!bookings) {
    const { wins, visits } = board
      ? await loadJobsToBook(ctx.orgId, ctx.railDay, { money: caps.money, sm8: caps.sm8 })
      : { wins: [], visits: [] };
    return {
      day: ctx.railDay,
      tz: ctx.tz,
      warnDays: ctx.shared.expiry.warnDays,
      caps,
      names: firstNames(ctx.names),
      wins,
      visits,
    };
  }
  const now = Date.now();
  const [{ wins, visits, bookingLines }, leftovers] = await Promise.all([
    loadJobsToBook(ctx.orgId, ctx.railDay, { money: caps.money, sm8: caps.sm8, bookings, now }),
    loadLeftovers(ctx.orgId, ctx.railDay, bookings, now),
  ]);
  return {
    day: ctx.railDay,
    tz: ctx.tz,
    warnDays: ctx.shared.expiry.warnDays,
    caps: { ...caps, bookIn: bookings.bookIn },
    names: firstNames(ctx.names),
    wins,
    visits,
    bookingLines: bookingLines ?? {},
    leftovers,
  };
}

/** The two reads, side by side. Without ServiceM8 there are no work orders
    to ask about, so only the visits are read. */
export async function loadJobsToBook(
  orgId: string,
  day: string,
  opts: { money: boolean; sm8: boolean; bookings?: ListBookings | null; now?: number },
): Promise<{ wins: WonJob[]; visits: VisitToBook[]; bookingLines?: Record<string, BookingState> }> {
  const bookings = opts.bookings ?? null;
  if (!bookings) {
    const [wins, visits] = await Promise.all([
      opts.sm8 ? loadWins(orgId, day, opts.money) : Promise.resolve([] as WonJob[]),
      loadVisits(orgId, day),
    ]);
    return { wins, visits };
  }
  const now = opts.now ?? Date.now();
  const [wins, visits] = await Promise.all([
    opts.sm8 ? loadWins(orgId, day, opts.money, bookings, now) : Promise.resolve([] as WonJob[]),
    loadVisits(orgId, day),
  ]);
  const bookingLines = wins.length > 0 ? await wonBookingLines(orgId, bookings, wins.map((w) => w.job.remoteId), now) : {};
  return { wins, visits, bookingLines };
}

/* ── won and never booked ── */

/** A wall, not a working number: the live account wins well under a hundred
    work orders a month. Logged when it binds. */
const WINS_CAP = 1000;
/** Supabase answers at most this many rows a request, whatever was asked. */
const PAGE = 1000;
/** `.in()` rides in the URL; keep it short. */
const CHUNK = 100;

const WIN_COLUMNS =
  "uuid, generated_job_id, status, company_uuid, geo_city, category_uuid, " +
  "job_description, date, quote_date, completion_date, work_order_date";

type WinRow = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  company_uuid: string | null;
  geo_city: string | null;
  category_uuid: string | null;
  job_description: string | null;
  date: string | null;
  quote_date: string | null;
  completion_date: string | null;
  work_order_date: string | null;
  total_invoice_amount?: string | null;
  invoice_sent?: number | null;
  invoice_date?: string | null;
  quote_sent?: number | null;
  quote_sent_stamp?: string | null;
  payment_received?: number | null;
  payment_received_stamp?: string | null;
};

function chunks(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

/** The `.or()` that dates a work order by when it was WON: `work_order_date`,
    and `date` (when it was raised) only where ServiceM8 never set one. The
    sync stores ServiceM8's zero date as null (sm8-sync-plan), so `is.null`
    is the whole test. The floor is a bare day: mirror stamps are naive
    'YYYY-MM-DD HH:MM:SS' text, which sorts after its own day, and a bare day
    needs no quoting inside PostgREST's syntax. */
export function wonSinceFilter(since: string): string {
  return `work_order_date.gte.${since},and(work_order_date.is.null,date.gte.${since})`;
}

async function loadWins(
  orgId: string,
  day: string,
  money: boolean,
  bookings: ListBookings | null = null,
  now: number = Date.now(),
): Promise<WonJob[]> {
  const since = plusDays(day, -WON_WINDOW_DAYS);
  const { data, error } = await supabaseAdmin
    .from("sm8_jobs")
    // the money columns only with the grant — never selected, never sent
    .select(money ? `${WIN_COLUMNS}, ${SM8_JOB_MONEY_COLUMNS}` : WIN_COLUMNS)
    .eq("org_id", orgId)
    .eq("status", "Work Order")
    .eq("active", 1)
    .or(wonSinceFilter(since))
    .order("uuid", { ascending: true })
    .limit(WINS_CAP);
  if (error) {
    console.error(`[home-list] couldn't read the won work orders for org ${orgId}:`, error);
    return [];
  }
  const rows = (data ?? []) as unknown as WinRow[];
  if (rows.length >= WINS_CAP) console.warn(`[home-list] won work orders hit the ${WINS_CAP} cap for org ${orgId}`);
  if (rows.length === 0) return [];

  const booked = bookings
    ? await everBookedOver(orgId, rows.map((r) => r.uuid), bookings, now)
    : await everBooked(orgId, rows.map((r) => r.uuid));
  if (booked === null) return [];
  const left = rows.filter((r) => !booked.has(r.uuid));
  if (left.length === 0) return [];

  const companyIds = [...new Set(left.map((r) => r.company_uuid).filter((x): x is string => !!x))];
  const categoryIds = [...new Set(left.map((r) => r.category_uuid).filter((x): x is string => !!x))];
  const [companies, categories, payments] = await Promise.all([
    readIn<{ uuid: string; name: string | null }>("sm8_companies", "uuid, name", orgId, "uuid", companyIds),
    readIn<{ uuid: string; name: string | null; colour: string | null }>(
      "sm8_categories",
      "uuid, name, colour",
      orgId,
      "uuid",
      categoryIds,
    ),
    /* What has been paid, as the board counts it (loadAllJobs): the job card
       opens on this row, and a won job can carry a deposit. */
    money
      ? readIn<{ job_uuid: string; amount: string | null }>(
          "sm8_job_payments",
          "job_uuid, amount",
          orgId,
          "job_uuid",
          left.map((r) => r.uuid),
          true,
        )
      : Promise.resolve([] as { job_uuid: string; amount: string | null }[]),
  ]);

  const companyName = new Map(companies.map((c) => [c.uuid, c.name]));
  // trailing spaces on live category names, bare hex on colours — as loadAllJobs
  const categoryInfo = new Map(
    categories.map((c) => [c.uuid, { name: c.name?.trim() || null, colour: sm8CategoryColour(c.colour) }]),
  );
  const paid = new Map<string, number>();
  for (const p of payments) {
    const cents = parseSm8AmountToCents(p.amount);
    if (cents !== null) paid.set(p.job_uuid, (paid.get(p.job_uuid) ?? 0) + cents);
  }

  const out: WonJob[] = [];
  for (const r of left) {
    const wonOn = (r.work_order_date ?? r.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wonOn)) continue;
    const job: AllJobsMirrorJob = {
      remoteId: r.uuid,
      jobNumber: r.generated_job_id,
      status: r.status,
      clientName: r.company_uuid ? companyName.get(r.company_uuid) ?? null : null,
      description: oneLine(r.job_description),
      suburb: r.geo_city,
      categoryName: r.category_uuid ? categoryInfo.get(r.category_uuid)?.name ?? null : null,
      categoryColour: r.category_uuid ? categoryInfo.get(r.category_uuid)?.colour ?? null : null,
      date: r.date,
      quoteDate: r.quote_date,
      completionDate: r.completion_date,
      // never booked, by construction — that is why it is on the list
      nextBooking: null,
      money: money ? jobMoneyOf(r) : null,
      paidCents: money ? paid.get(r.uuid) ?? 0 : 0,
    };
    out.push({ job, wonOn });
  }
  return out;
}

/** Which of these jobs has EVER had a scheduled diary block — any date, past
    or future. One is enough: a job that was booked and done is not waiting
    on a day. Recorded time on site (`activity_was_scheduled = 0`) is not a
    booking. Paged, because a job booked week after week can hold more rows
    than one answer carries, and a short answer would call a booked job
    unbooked. Null when a read fails. */
async function everBooked(orgId: string, ids: readonly string[]): Promise<Set<string> | null> {
  const booked = new Set<string>();
  const results = await Promise.all(
    chunks(ids).map(async (chunk) => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("sm8_job_activities")
          .select("job_uuid")
          .eq("org_id", orgId)
          .eq("active", 1)
          .eq("activity_was_scheduled", 1)
          .in("job_uuid", chunk)
          .order("uuid", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          console.error(`[home-list] couldn't read the bookings for org ${orgId}:`, error);
          return false;
        }
        const rows = (data ?? []) as { job_uuid: string | null }[];
        for (const a of rows) if (a.job_uuid) booked.add(a.job_uuid);
        if (rows.length < PAGE) return true;
      }
    }),
  );
  return results.every(Boolean) ? booked : null;
}

/** `everBooked`, over our bookings (two-way phase 3): the same question
    with each block's uuid, so a booking we took out books nothing, and a
    booking we sent that the mirror doesn't hold yet books its job. Null
    when a read fails, as `everBooked` is. */
async function everBookedOver(
  orgId: string,
  ids: readonly string[],
  bookings: ListBookings,
  now: number,
): Promise<Set<string> | null> {
  const blocks: { uuid: string; job: string }[] = [];
  const results = await Promise.all(
    chunks(ids).map(async (chunk) => {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("sm8_job_activities")
          .select("uuid, job_uuid")
          .eq("org_id", orgId)
          .eq("active", 1)
          .eq("activity_was_scheduled", 1)
          .in("job_uuid", chunk)
          .order("uuid", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) {
          console.error(`[home-list] couldn't read the bookings for org ${orgId}:`, error);
          return false;
        }
        const got = (data ?? []) as { uuid: string | null; job_uuid: string | null }[];
        for (const a of got) if (a.uuid && a.job_uuid) blocks.push({ uuid: a.uuid, job: a.job_uuid });
        if (got.length < PAGE) return true;
      }
    }),
  );
  if (!results.every(Boolean)) return null;

  const over = await readBookingOverlay(orgId, bookings.state, { uuids: blocks.map((b) => b.uuid), rows: false }, now);
  const spelled = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const booked = new Set<string>();
  for (const b of blocks) if (!over.gone.has(b.uuid.toLowerCase())) booked.add(b.job);
  for (const s of over.sentNotMirrored) {
    const id = spelled.get(s.jobUuid.toLowerCase());
    if (id && !over.gone.has(s.uuid.toLowerCase())) booked.add(id);
  }
  return booked;
}

/** Won jobs asked of the overlay at a time: each rides in a filter in up
    to three spellings. */
const LINE_CHUNK = 15;

/** Each of these jobs' booking line, by the job's uuid in lower case: the
    line of the newest booking of ours on it that has something to say —
    the card's own line (sm8-booking-plan's bookingLine), so the two never
    disagree. A job with none has no entry. A read that fails says nothing
    for its jobs (logged by the overlay). */
async function wonBookingLines(
  orgId: string,
  bookings: ListBookings,
  jobUuids: readonly string[],
  now: number,
): Promise<Record<string, BookingState>> {
  const rows: BookingOverlayRow[] = [];
  for (let i = 0; i < jobUuids.length; i += LINE_CHUNK) {
    const over = await readBookingOverlay(orgId, bookings.state, { jobUuids: jobUuids.slice(i, i + LINE_CHUNK) }, now);
    rows.push(...over.rows);
  }
  const creates = rows.filter((r) => r.op === "create");
  if (creates.length === 0) return {};
  const statusRows = new Map(rows.filter((r) => r.op === "update").map((r) => [r.id, r]));
  const takeBacks = new Map(rows.filter((r) => r.op === "delete" && !!r.depends_on).map((r) => [r.depends_on as string, r]));
  const mirror = (await readMirrorBookings(orgId, creates.map((c) => c.remote_uuid))) ?? new Map();

  const lines: Record<string, BookingState> = {};
  const newestFirst = [...creates].sort(
    (a, b) => pressedAt(b).localeCompare(pressedAt(a)) || (a.booking_start ?? "").localeCompare(b.booking_start ?? ""),
  );
  for (const c of newestFirst) {
    const job = (c.sm8_job_uuid ?? "").toLowerCase();
    if (!job || lines[job]) continue;
    const m = mirror.get(c.remote_uuid.toLowerCase());
    const said = bookingLine({
      create: c,
      statusRow: c.depends_on ? (statusRows.get(c.depends_on) ?? null) : null,
      takeBack: takeBacks.get(c.id) ?? null,
      hold: bookings.hold,
      offered: bookings.offered,
      trial: bookings.trial,
      // the list draws the words and the tone; the doors are the card's
      viewerIsPresser: false,
      mirror: m
        ? { active: m.active, jobUuid: m.jobUuid, staffUuid: m.staffUuid, start: m.start, end: m.end, editDate: m.editDate }
        : null,
      now,
      zone: bookings.zone,
    });
    if (said.key && said.text) lines[job] = said;
  }
  return lines;
}

/* ── leftover bookings ── */

/** How many leftover bookings the list carries at most. */
export const LEFTOVERS_CAP = 20;
/** A wall on the future bookings read to find them. Logged when it binds. */
const FUTURE_CAP = 1000;

/** THE LEFTOVER BOOKINGS: future, scheduled, active bookings with a person
    and an end, on active jobs that are Completed or Unsuccessful — the one
    rule, isLeftover, on the account's own zone and the server's clock —
    less the ones we cleared (the overlay's gone), soonest first, at most 20.
    Nothing without the account's zone: there is no Sydney fallback. A read
    that fails lists none (logged). */
export async function loadLeftovers(
  orgId: string,
  day: string,
  bookings: ListBookings,
  now: number = Date.now(),
): Promise<LeftoverRow[]> {
  if (!sm8BookingsAllowed() || !bookings.zone) return [];
  const zone = bookings.zone;
  const { data, error } = await supabaseAdmin
    .from("sm8_job_activities")
    .select("uuid, job_uuid, staff_uuid, start_date, end_date, activity_was_scheduled, active")
    .eq("org_id", orgId)
    .eq("active", 1)
    .eq("activity_was_scheduled", 1)
    .gte("start_date", `${day} 00:00:00`)
    .order("start_date", { ascending: true })
    .limit(FUTURE_CAP);
  if (error) {
    console.error(`[home-list] couldn't read the future bookings for org ${orgId}:`, error);
    return [];
  }
  type Act = {
    uuid: string;
    job_uuid: string | null;
    staff_uuid: string | null;
    start_date: string | null;
    end_date: string | null;
    activity_was_scheduled: number | null;
    active: number | null;
  };
  const acts = ((data ?? []) as Act[]).filter((a) => a.uuid && a.job_uuid && a.start_date);
  if (acts.length >= FUTURE_CAP) console.warn(`[home-list] future bookings hit the ${FUTURE_CAP} cap for org ${orgId}`);
  if (acts.length === 0) return [];

  const jobIds = [...new Set(acts.map((a) => a.job_uuid!))];
  const jobs = new Map<string, { number: string | null; status: string }>();
  for (const chunk of chunks(jobIds)) {
    const { data: rows, error: jobError } = await supabaseAdmin
      .from("sm8_jobs")
      .select("uuid, generated_job_id, status")
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("status", ["Completed", "Unsuccessful"])
      .in("uuid", chunk);
    if (jobError) {
      console.error(`[home-list] couldn't read the finished jobs for org ${orgId}:`, jobError);
      return [];
    }
    for (const j of (rows ?? []) as { uuid: string; generated_job_id: string | null; status: string }[]) {
      jobs.set(j.uuid, { number: j.generated_job_id, status: j.status });
    }
  }
  const left = acts.filter((a) => {
    const job = jobs.get(a.job_uuid!);
    return (
      !!job &&
      isLeftover(
        { scheduled: a.activity_was_scheduled, active: a.active, start: a.start_date, end: a.end_date, staffUuid: a.staff_uuid },
        job.status,
        zone,
        now,
      )
    );
  });
  if (left.length === 0) return [];

  /* the ones we cleared stay hidden for as long as the Clear's row exists */
  const over = await readBookingOverlay(orgId, bookings.state, { uuids: left.map((a) => a.uuid), rows: false }, now);
  const kept = left.filter((a) => !over.gone.has(a.uuid.toLowerCase())).slice(0, LEFTOVERS_CAP);
  if (kept.length === 0) return [];

  const staffIds = [...new Set(kept.map((a) => a.staff_uuid!))];
  const staff = await readIn<{ uuid: string; first: string | null }>("sm8_staff", "uuid, first", orgId, "uuid", staffIds);
  const firstOf = new Map(staff.map((p) => [p.uuid, p.first?.trim().split(/\s+/)[0] || null]));
  return kept.map((a) => {
    const job = jobs.get(a.job_uuid!)!;
    return {
      activityUuid: a.uuid,
      jobUuid: a.job_uuid!,
      jobNumber: job.number,
      jobStatus: job.status,
      staffName: firstOf.get(a.staff_uuid!) ?? null,
      start: a.start_date!,
    };
  });
}

/** Rows of one table by an id list, chunked, for this org. A failed chunk
    reads as nothing — these only name things. */
async function readIn<T>(
  table: string,
  columns: string,
  orgId: string,
  column: string,
  ids: readonly string[],
  activeOnly = false,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const parts = await Promise.all(
    chunks(ids).map(async (chunk) => {
      let q = supabaseAdmin.from(table).select(columns).eq("org_id", orgId);
      if (activeOnly) q = q.eq("active", 1);
      const { data } = await q.in(column, chunk);
      return (data ?? []) as unknown as T[];
    }),
  );
  return parts.flat();
}

/* ── services with no day ── */

/** A wall: the live workspace has one unbooked visit. */
const VISITS_CAP = 500;

async function loadVisits(orgId: string, day: string): Promise<VisitToBook[]> {
  const { data, error } = await supabaseAdmin
    .from("maintenance_visits")
    .select("id, agreement_id, due_date")
    .eq("org_id", orgId)
    /* Unlinked and unplaced. `is.null`, never `neq`: a `neq` filter drops the
       NULL rows, which are exactly the ones asked for. */
    .is("remote_id", null)
    .is("booked_date", null)
    // open: not done, not skipped — named, so a NULL can't slip either way
    .in("status", ["upcoming", "booked"])
    .lte("due_date", plusDays(day, VISIT_WINDOW_DAYS))
    .order("due_date", { ascending: true })
    .limit(VISITS_CAP);
  if (error) {
    console.error(`[home-list] couldn't read the visits for org ${orgId}:`, error);
    return [];
  }
  const rows = (data ?? []) as { id: string; agreement_id: string; due_date: string }[];
  if (rows.length === 0) return [];

  const agreementIds = [...new Set(rows.map((r) => r.agreement_id))];
  const { data: agreementRows, error: agreementError } = await supabaseAdmin
    .from("maintenance_agreements")
    .select("id, client_name, label, status")
    .eq("org_id", orgId)
    .in("id", agreementIds);
  if (agreementError) {
    console.error(`[home-list] couldn't read the agreements for org ${orgId}:`, agreementError);
    return [];
  }
  /* The board's own rule: only an active agreement's visits are work. A
     paused or ended one keeps its generated visits, and they are nobody's. */
  const active = new Map(
    ((agreementRows ?? []) as { id: string; client_name: string | null; label: string | null; status: string }[])
      .filter((a) => a.status === "active")
      .map((a) => [a.id, a]),
  );
  const out: VisitToBook[] = [];
  for (const r of rows) {
    const a = active.get(r.agreement_id);
    if (!a) continue;
    out.push({ id: r.id, clientName: a.client_name, label: a.label, dueDate: String(r.due_date).slice(0, 10) });
  }
  return out;
}
