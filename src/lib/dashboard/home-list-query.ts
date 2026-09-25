/* HOME'S RIGHT-HAND LIST — the reads. The rules and the words are
   ./home-list; this file fetches only what the page does not already hold.

   Everything else on the list — your tasks and the team's, the bell's dated
   chips, the open issues, the diary a task came from — is already in the
   page's hands for today's Home, so the list places those and reads none of
   them again (`placeHomeList`). What is new is two questions:

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
   louder. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Capability } from "@/lib/permissions";
import { sm8CategoryColour, type AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { oneLine } from "@/lib/workboard/all-jobs-query";
import { plusDays } from "@/lib/workboard/dates";
import { jobMoneyOf, parseSm8AmountToCents, SM8_JOB_MONEY_COLUMNS } from "@/lib/workboard/job-money";
import {
  VISIT_WINDOW_DAYS,
  WON_WINDOW_DAYS,
  type HomeListReads,
  type ListCaps,
  type VisitToBook,
  type WonJob,
} from "./home-list";
import type { StaffNames } from "./tasks-query";

/** What the list needs from the page loader — a part of the new Home's
    shared context (`DeskContext`, ./desk-data), so that context can be handed
    in as it is once it carries `connected`. */
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
};

/** The list's own reads, placed later by `placeHomeList` beside the page's. */
export async function loadHomeList(ctx: HomeListContext): Promise<HomeListReads> {
  const board = ctx.caps.has("workboard");
  const caps: ListCaps = {
    assetsAll: ctx.caps.has("assets_all"),
    placeVisits: board && ctx.caps.has("workboard_manage"),
    money: board && ctx.caps.has("workboard_money"),
    sm8: ctx.connected,
  };
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

/** Staff id → first name: "From Callum", not "From Callum Reid". */
function firstNames(names: StaffNames): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of names) {
    const first = name.trim().split(/\s+/)[0];
    if (first) out[id] = first;
  }
  return out;
}

/** The two reads, side by side. Without ServiceM8 there are no work orders
    to ask about, so only the visits are read. */
export async function loadJobsToBook(
  orgId: string,
  day: string,
  opts: { money: boolean; sm8: boolean },
): Promise<{ wins: WonJob[]; visits: VisitToBook[] }> {
  const [wins, visits] = await Promise.all([
    opts.sm8 ? loadWins(orgId, day, opts.money) : Promise.resolve([] as WonJob[]),
    loadVisits(orgId, day),
  ]);
  return { wins, visits };
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

async function loadWins(orgId: string, day: string, money: boolean): Promise<WonJob[]> {
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

  const booked = await everBooked(orgId, rows.map((r) => r.uuid));
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
