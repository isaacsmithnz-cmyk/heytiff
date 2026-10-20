/* THE JOBS LIST (v2, step 5's first screen; the board v2-board-jobs) — pure,
   client-safe, `today` handed in.

   Today's list is the Workboard's All jobs: one row per ServiceM8 job plus
   one per native visit or project that has none (all-jobs.ts, the union
   rule). This file takes that same union and the two boards' own data, and
   says for every row what the table shows and which of the seven views it
   belongs to. Nothing is stored and nothing is guessed: each view is a list
   the Workboard already keeps.

     All         every row still open: the work orders, the quotes, and the
                 finished work still to invoice or still owed
     To book     All jobs › Work orders › Waiting on a day
     Quotes      All jobs › Quotes, the worklist (quote-worklist.ts)
     To invoice  Maintenance › Completed › To invoice: a visit done and not
                 ticked invoiced, while ServiceM8 hasn't completed its job
     Owed        All jobs › Completed › Awaiting payment (money grant only)
     Projects    Projects › Pipeline: every project not done, one row each
     Agreements  Maintenance › Service agreements, active and paused

   "Where it's up to" is a word from the row's own state: the quote's group,
   the booking, the visit's due day, the project's status and stage, the
   payment rows. "Next" is the day that state is about. "Who" is the people
   on the job's bookings, from today on, or on its last one. */

import { auDayOf, fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { recordHref } from "@/lib/records/ref";
import { jobPageHref, projectHref, visitHref } from "@/lib/shell/links";
import type { Hue, Tone } from "@/components/parts/state";
import {
  allJobsRows,
  awaitingPaymentRows,
  sm8JobIsOpen,
  sm8TimeOf,
  type AllJobRow,
  type AllJobsMirrorJob,
} from "./all-jobs";
import { plusDays } from "./dates";
import { jobHue } from "./job-hue";
import { quoteWorklist, type QuoteItem } from "./quote-worklist";

/* ── the views, the sorts and the address ── */

export const JOB_VIEWS = [
  { key: "all", label: "All" },
  { key: "to-book", label: "To book" },
  { key: "quotes", label: "Quotes" },
  { key: "to-invoice", label: "To invoice" },
  { key: "owed", label: "Owed" },
  { key: "projects", label: "Projects" },
  { key: "agreements", label: "Agreements" },
] as const;

export type JobView = (typeof JOB_VIEWS)[number]["key"];

/** Owed is money: without the grant the view isn't offered at all. */
export const viewsFor = (moneyVisible: boolean) => JOB_VIEWS.filter((v) => moneyVisible || v.key !== "owed");

export const JOB_SORTS = [
  { key: "next", label: "Next first" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "value", label: "Biggest first" },
] as const;

export type JobSort = (typeof JOB_SORTS)[number]["key"];

/** Biggest first sorts by money, so it needs the grant too. */
export const sortsFor = (moneyVisible: boolean) => JOB_SORTS.filter((s) => moneyVisible || s.key !== "value");

/** Who: anyone, nobody booked yet, or one person by name, lower case. */
export const ANYONE = "anyone";
export const NOBODY = "nobody";

export type ListState = { view: JobView; who: string; sort: JobSort; q: string };

export const DEFAULT_STATE: ListState = { view: "all", who: ANYONE, sort: "next", q: "" };

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** The list's state from its address. Anything it doesn't know is the
    default, and the money views and sort fall back without the grant. */
export function readListState(params: Params, moneyVisible: boolean): ListState {
  const view = one(params.view);
  const sort = one(params.sort);
  const who = one(params.who).trim().toLowerCase().slice(0, 80);
  return {
    view: viewsFor(moneyVisible).some((v) => v.key === view) ? (view as JobView) : "all",
    sort: sortsFor(moneyVisible).some((s) => s.key === sort) ? (sort as JobSort) : "next",
    who: who || ANYONE,
    q: one(params.q).trim().slice(0, 120),
  };
}

/** The address for a state: only what differs from the default, so the
    plain list is plain `/dashboard/jobs`. */
export function listHref(state: ListState, path = "/dashboard/jobs"): string {
  const p = new URLSearchParams();
  if (state.view !== DEFAULT_STATE.view) p.set("view", state.view);
  if (state.who !== DEFAULT_STATE.who) p.set("who", state.who);
  if (state.sort !== DEFAULT_STATE.sort) p.set("sort", state.sort);
  if (state.q.trim()) p.set("q", state.q.trim());
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/** The page's address with the list's state written in, every other part
    of it kept as it was (an open record's `?open=`, say). */
export function withListState(href: string, state: ListState): string {
  const url = new URL(href, "https://heytiff.invalid");
  const own = new URL(listHref(state, url.pathname), "https://heytiff.invalid");
  for (const k of ["view", "who", "sort", "q"]) url.searchParams.delete(k);
  for (const [k, v] of own.searchParams) url.searchParams.set(k, v);
  const s = url.searchParams.toString();
  return `${url.pathname}${s ? `?${s}` : ""}${url.hash}`;
}

/* ── one row of the table ── */

export type JobsListRow = {
  key: string;
  /** where the row opens: a job's page, or the visit, agreement or project
      that has no ServiceM8 job */
  href: string;
  number: string | null;
  /** the number is HeyTiff's (#1001 up), not ServiceM8's: said under it */
  numberOurs: boolean;
  client: string;
  site: string | null;
  kind: string;
  hue: Hue;
  state: string;
  tone: Tone;
  next: string;
  /** the day Next is about, YYYY-MM-DD */
  on: string | null;
  /** Next is still to come */
  ahead: boolean;
  /** the people on it, by name */
  who: string[];
  /** ServiceM8's job total, inc GST; null without the grant or a total */
  valueCents: number | null;
  views: JobView[];
  /** what search reads */
  words: string;
};

/* ── the inputs, slimmed from the two boards ── */

export type JobsListVisit = {
  id: string;
  agreementId: string;
  jobNo: number | null;
  remoteId: string | null;
  clientName: string;
  label: string;
  siteLabel: string | null;
  category: { name: string; accent: string } | null;
  dueDate: string;
  bookedDate: string | null;
  status: string;
  completedAt: string | null;
  invoicedAt: string | null;
  techs: string[];
};

export type JobsListAgreement = {
  id: string;
  label: string;
  clientName: string;
  siteLabel: string | null;
  intervalMonths: number;
  status: string;
  category: { name: string; accent: string } | null;
  nextDue: string | null;
  overdueCount: number;
};

export type JobsListProject = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  stage: string;
  status: string;
  updatedAt: string;
  jobs: { remoteId: string | null; role: string }[];
};

export type JobsListTrip = { projectId: string; status: string; bookedDate: string | null; techs: string[] };

export type JobsListInput = {
  jobs: readonly AllJobsMirrorJob[];
  projectLinks: readonly { remoteId: string; projectId: string }[];
  visits: readonly JobsListVisit[];
  agreements: readonly JobsListAgreement[];
  projects: readonly JobsListProject[];
  trips: readonly JobsListTrip[];
  /** ServiceM8 job uuid → the people on its bookings (crewOf) */
  crew: Readonly<Record<string, string[]>>;
  /** ServiceM8 job uuid → the day it became a work order */
  wonOn: Readonly<Record<string, string>>;
  today: string;
  moneyVisible: boolean;
};

/* ── words for days ── */

const dayOf = (s: string | null | undefined): string | null => (s && s.length >= 10 ? s.slice(0, 10) : null);

/** "14 Oct", with the year when it isn't this one. */
function dated(d: string, today: string): string {
  const words = fmtAuDayMonth(d);
  return d.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${d.slice(0, 4)}`;
}

/** A day still to come or just gone: Today, Tomorrow, Yesterday, else "Tue 14 Oct". */
function dayWords(d: string, today: string): string {
  if (d === today) return "Today";
  if (d === plusDays(today, 1)) return "Tomorrow";
  if (d === plusDays(today, -1)) return "Yesterday";
  const words = fmtAuWeekdayDayMonth(d);
  return d.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${d.slice(0, 4)}`;
}

/** A booking: its day, and its time when it has one. */
function bookingWords(stamp: string, today: string): string {
  const d = dayOf(stamp)!;
  const t = stamp.length >= 16 ? sm8TimeOf(stamp) : null;
  return t && stamp.slice(11, 16) !== "00:00" ? `${dayWords(d, today)} ${t}` : dayWords(d, today);
}

/* ── who ── */

/** WHO IS ON A JOB: the people on its bookings from today on, soonest
    first; with none ahead, the people on its last day booked. Pure, so the
    loader's read and the test agree. */
export function crewOf(
  acts: readonly { job_uuid: string; staff_uuid: string | null; start_date: string | null }[],
  names: ReadonlyMap<string, string>,
  today: string,
): Record<string, string[]> {
  const byJob = new Map<string, { staff: string; start: string }[]>();
  for (const a of acts) {
    if (!a.staff_uuid || !a.start_date) continue;
    const list = byJob.get(a.job_uuid) ?? [];
    list.push({ staff: a.staff_uuid, start: a.start_date });
    byJob.set(a.job_uuid, list);
  }
  const floor = `${today} 00:00:00`;
  const out: Record<string, string[]> = {};
  for (const [job, list] of byJob) {
    const ahead = list.filter((a) => a.start >= floor).sort((a, b) => a.start.localeCompare(b.start));
    let pick = ahead;
    if (pick.length === 0) {
      const last = list.map((a) => a.start.slice(0, 10)).sort().at(-1)!;
      pick = list.filter((a) => a.start.slice(0, 10) === last);
    }
    const people: string[] = [];
    for (const a of pick) {
      const name = names.get(a.staff);
      if (name && !people.includes(name)) people.push(name);
    }
    if (people.length) out[job] = people;
  }
  return out;
}

/* ── the rows ── */

const CLOSED_PROJECT = new Set(["done", "archived"]);

/** Which of a project's ServiceM8 jobs it opens on: the install, then the
    quote, then the first other, of those the mirror holds. */
function mainJobOf(p: JobsListProject, held: ReadonlyMap<string, AllJobsMirrorJob>): AllJobsMirrorJob | null {
  const rank = (role: string) => (role === "install" ? 0 : role === "quote" ? 1 : 2);
  const linked = p.jobs
    .filter((j) => j.remoteId && held.has(j.remoteId))
    .sort((a, b) => rank(a.role) - rank(b.role));
  return linked.length ? held.get(linked[0]!.remoteId!)! : null;
}

const words = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

export function jobsListRows(input: JobsListInput): JobsListRow[] {
  const { today, moneyVisible } = input;
  const held = new Map(input.jobs.map((j) => [j.remoteId, j]));
  const visitById = new Map(input.visits.map((v) => [v.id, v]));
  const projectById = new Map(input.projects.map((p) => [p.id, p]));

  /* the projects' open trips: the soonest booked day, and who is on them */
  const nextTrip = new Map<string, string>();
  const tripCrew = new Map<string, string[]>();
  for (const t of input.trips) {
    if (t.status !== "upcoming" && t.status !== "booked") continue;
    const crew = tripCrew.get(t.projectId) ?? [];
    for (const n of t.techs) if (!crew.includes(n)) crew.push(n);
    tripCrew.set(t.projectId, crew);
    if (!t.bookedDate) continue;
    const cur = nextTrip.get(t.projectId);
    if (!cur || t.bookedDate < cur) nextTrip.set(t.projectId, t.bookedDate);
  }

  /* THE UNION, exactly as the Workboard's All jobs builds it */
  const byProject = new Map<string, string[]>();
  for (const l of input.projectLinks) byProject.set(l.projectId, [...(byProject.get(l.projectId) ?? []), l.remoteId]);
  const union = allJobsRows({
    jobs: input.jobs,
    visits: input.visits.map((v) => ({
      id: v.id,
      jobNo: v.jobNo,
      remoteId: v.remoteId,
      clientName: v.clientName,
      label: v.label,
      siteLabel: v.siteLabel,
      categoryName: v.category?.name ?? null,
      dueDate: v.dueDate,
      bookedDate: v.bookedDate,
      status: v.status,
      completedAt: v.completedAt,
    })),
    projects: input.projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      siteLabel: p.siteLabel,
      status: p.status,
      stage: p.stage,
      remoteIds: byProject.get(p.id) ?? [],
      nextBookedDate: nextTrip.get(p.id) ?? null,
      updatedAt: p.updatedAt,
    })),
    today,
  });

  const out = new Map<string, JobsListRow>();
  const put = (row: JobsListRow) => {
    const had = out.get(row.key);
    if (!had) out.set(row.key, row);
    else for (const v of row.views) if (!had.views.includes(v)) had.views.push(v);
  };

  /* a ServiceM8 row's facts every view shares */
  const sm8Base = (r: AllJobRow): Omit<JobsListRow, "state" | "tone" | "next" | "on" | "ahead" | "views"> => ({
    key: r.key,
    href: jobPageHref(r.id),
    number: r.number,
    numberOurs: false,
    client: r.clientName ?? "Unnamed client",
    site: r.suburb,
    kind: r.categoryName ?? (r.statusLabel === "Quote" ? "Quote" : "Job"),
    hue: jobHue(r.categoryColour),
    who: input.crew[r.id] ?? [],
    valueCents: moneyVisible ? (r.money?.valueCents ?? null) : null,
    words: words(r.number, r.clientName, r.suburb, r.title, r.categoryName, r.tracked?.label),
  });

  /* ── quotes: the worklist's group says where each is up to ── */
  const w = quoteWorklist(union.quotes, today);
  const quoteWords = (item: QuoteItem): { state: string; tone: Tone } => {
    if (item.group === "price") return { state: "Quote to write", tone: "info" };
    if (item.group === "cold") return { state: "Going cold", tone: "look" };
    if (item.group === "stale") return { state: "Over 6 months", tone: "info" };
    return item.next.tone === "warn" ? { state: item.next.word, tone: "look" } : { state: "Waiting on an answer", tone: "info" };
  };
  for (const items of Object.values(w.groups)) {
    for (const item of items) {
      const r = item.row;
      const d = dayOf(r.date);
      const sent = r.money?.quoteSentOn ?? null;
      const next =
        item.group === "price"
          ? d ? `Raised ${dated(d, today)}` : "Not dated"
          : sent ? `Sent ${dated(sent, today)}` : d ? `Quoted ${dated(d, today)}` : "Not dated";
      put({ ...sm8Base(r), ...quoteWords(item), next, on: sent ?? d, ahead: false, views: ["all", "quotes"] });
    }
  }

  /* ── open work: booked, or waiting on a day ── */
  const workRow = (r: AllJobRow, booked: boolean): JobsListRow | null => {
    if (r.kind === "sm8") {
      const job = held.get(r.id);
      if (booked && job?.nextBooking) {
        return { ...sm8Base(r), state: "Booked", tone: "info", next: bookingWords(job.nextBooking, today), on: dayOf(job.nextBooking), ahead: true, views: ["all"] };
      }
      const won = input.wonOn[r.id] ?? null;
      const raised = dayOf(job?.date ?? r.date);
      return {
        ...sm8Base(r),
        state: "Waiting on a day",
        tone: "look",
        next: won ? `Won ${dated(won, today)}` : raised ? `Raised ${dated(raised, today)}` : "Not dated",
        on: won ?? raised,
        ahead: false,
        views: ["all", "to-book"],
      };
    }
    if (r.kind === "visit") {
      const v = visitById.get(r.id);
      if (!v) return null;
      const base = visitBase(v);
      if (booked && v.bookedDate)
        return { ...base, state: "Booked", tone: "info", next: dayWords(v.bookedDate, today), on: v.bookedDate, ahead: true, views: ["all"] };
      const late = v.dueDate < today;
      return {
        ...base,
        state: late ? "Overdue" : "Not booked",
        tone: late ? "wrong" : "look",
        next: `${late ? "Was due" : "Due"} ${dated(v.dueDate, today)}`,
        on: v.dueDate,
        ahead: !late,
        views: ["all", "to-book"],
      };
    }
    const p = projectById.get(r.id);
    if (!p) return null;
    const row = projectRow(p);
    return { ...row, views: booked ? ["all", "projects"] : ["all", "to-book", "projects"] };
  };

  const visitBase = (v: JobsListVisit): Omit<JobsListRow, "state" | "tone" | "next" | "on" | "ahead" | "views"> => {
    const linked = v.remoteId ? held.get(v.remoteId) : undefined;
    return {
      key: linked ? `sm8:${linked.remoteId}` : `visit:${v.id}`,
      href: linked ? jobPageHref(linked.remoteId) : visitHref(v.id),
      number: linked ? linked.jobNumber : v.jobNo !== null ? String(v.jobNo) : null,
      numberOurs: !linked && v.jobNo !== null,
      client: v.clientName,
      site: v.siteLabel,
      kind: v.category?.name ?? "Maintenance",
      hue: jobHue(v.category?.accent),
      who: v.techs,
      valueCents: null,
      words: words(v.jobNo !== null ? String(v.jobNo) : null, v.clientName, v.siteLabel, v.label, v.category?.name),
    };
  };

  const projectRow = (p: JobsListProject): Omit<JobsListRow, "views"> => {
    const main = mainJobOf(p, held);
    const trip = nextTrip.get(p.id) ?? null;
    const state =
      p.status === "blocked"
        ? { state: "Blocked", tone: "wrong" as Tone }
        : p.status === "on_hold"
          ? { state: "On hold", tone: "look" as Tone }
          : { state: p.stage, tone: "info" as Tone };
    return {
      key: `project:${p.id}`,
      href: main ? jobPageHref(main.remoteId) : projectHref(p.id),
      number: main?.jobNumber ?? null,
      numberOurs: false,
      client: p.clientName ?? p.name,
      site: p.siteLabel,
      kind: main?.categoryName ?? "Project",
      hue: jobHue(main?.categoryColour),
      ...state,
      next: trip ? dayWords(trip, today) : "No day booked",
      on: trip,
      ahead: !!trip,
      who: tripCrew.get(p.id) ?? [],
      valueCents: moneyVisible ? (main?.money?.valueCents ?? null) : null,
      words: words(main?.jobNumber, p.name, p.clientName, p.siteLabel, p.stage, main?.categoryName),
    };
  };

  for (const r of union.work.booked) {
    const row = workRow(r, true);
    if (row) put(row);
  }
  for (const r of union.work.unbooked) {
    const row = workRow(r, false);
    if (row) put(row);
  }

  /* ── owed: finished, worth a known amount, not all of it paid ── */
  if (moneyVisible) {
    for (const r of awaitingPaymentRows(union)) {
      const d = dayOf(r.date);
      put({
        ...sm8Base(r),
        state: r.money?.collection === "part" ? "Part paid" : "Awaiting payment",
        tone: "look",
        next: d ? `Completed ${dated(d, today)}` : "Completed",
        on: d,
        ahead: false,
        views: ["all", "owed"],
      });
    }
  }

  /* ── to invoice: a visit done and not ticked, unless ServiceM8 has already
     completed its job, which it does by invoicing it (job-steps.ts) ── */
  for (const v of input.visits) {
    if (v.status !== "done" || !v.completedAt || v.invoicedAt) continue;
    const linked = v.remoteId ? held.get(v.remoteId) : undefined;
    if (linked && !sm8JobIsOpen(linked.status)) continue;
    const done = auDayOf(v.completedAt) || dayOf(v.completedAt);
    const facts = { state: "Ready to invoice", tone: "look" as Tone, next: done ? `Done ${dated(done, today)}` : "Done", on: done, ahead: false };
    const base = visitBase(v);
    const had = out.get(base.key);
    if (had) {
      Object.assign(had, facts);
      if (!had.views.includes("to-invoice")) had.views.push("to-invoice");
    } else put({ ...base, ...facts, views: ["all", "to-invoice"] });
  }

  /* ── projects: one row each, the job page of its main job ── */
  for (const p of input.projects) {
    if (CLOSED_PROJECT.has(p.status)) continue;
    if (out.has(`project:${p.id}`)) continue; // already a row of All, and in Projects
    put({ ...projectRow(p), views: ["projects"] });
  }

  /* ── agreements: the service agreements, each opening over the page ── */
  const nextVisitCrew = new Map<string, { due: string; techs: string[] }>();
  for (const v of input.visits) {
    if (v.status !== "upcoming" && v.status !== "booked") continue;
    const cur = nextVisitCrew.get(v.agreementId);
    if (!cur || v.dueDate < cur.due) nextVisitCrew.set(v.agreementId, { due: v.dueDate, techs: v.techs });
  }
  for (const a of input.agreements) {
    if (a.status !== "active" && a.status !== "paused") continue;
    const state: { state: string; tone: Tone } =
      a.status === "paused"
        ? { state: "Paused", tone: "look" }
        : a.overdueCount > 0
          ? { state: `${a.overdueCount} overdue`, tone: "wrong" }
          : { state: a.intervalMonths === 1 ? "Every month" : `Every ${a.intervalMonths} months`, tone: "info" };
    const late = a.nextDue !== null && a.nextDue < today;
    put({
      key: `agreement:${a.id}`,
      href: recordHref({ kind: "agreement", id: a.id }),
      number: null,
      numberOurs: false,
      client: a.clientName,
      site: a.siteLabel,
      kind: a.category?.name ?? "Maintenance",
      hue: jobHue(a.category?.accent),
      ...state,
      next: a.nextDue ? `${late ? "Was due" : "Due"} ${dated(a.nextDue, today)}` : "Nothing due",
      on: a.nextDue,
      ahead: a.nextDue !== null && !late,
      who: a.status === "paused" ? [] : (nextVisitCrew.get(a.id)?.techs ?? []),
      valueCents: null,
      views: ["agreements"],
      words: words(a.clientName, a.siteLabel, a.label, a.category?.name),
    });
  }

  return [...out.values()];
}

/* ── narrowing and ordering ── */

/** Is this row this person's: anyone, nobody on it yet, or one by name. */
export function matchesWho(row: JobsListRow, who: string): boolean {
  if (who === ANYONE) return true;
  if (who === NOBODY) return row.who.length === 0;
  return row.who.some((n) => n.toLowerCase() === who);
}

/** Every typed word has to land, taken literally (work-search's rule). */
export function matchesSearch(row: JobsListRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return needle.split(/\s+/).every((word) => row.words.includes(word));
}

/** The rows a view shows, for this person and this search. */
export function rowsFor(rows: readonly JobsListRow[], state: Pick<ListState, "view" | "who" | "q">): JobsListRow[] {
  return rows.filter((r) => r.views.includes(state.view) && matchesWho(r, state.who) && matchesSearch(r, state.q));
}

/** Each view's count, under the same person and search, so a count is the
    rows its tab shows. */
export function viewCounts(rows: readonly JobsListRow[], state: Pick<ListState, "who" | "q">): Record<JobView, number> {
  const counts = Object.fromEntries(JOB_VIEWS.map((v) => [v.key, 0])) as Record<JobView, number>;
  for (const r of rows) {
    if (!matchesWho(r, state.who) || !matchesSearch(r, state.q)) continue;
    for (const v of r.views) counts[v]++;
  }
  return counts;
}

const byKey = (a: JobsListRow, b: JobsListRow) => a.key.localeCompare(b.key);
/** Dated rows before undated ones, whichever way the dates run. */
const byOn = (dir: 1 | -1) => (a: JobsListRow, b: JobsListRow) =>
  a.on === b.on ? byKey(a, b) : a.on === null ? 1 : b.on === null ? -1 : dir * a.on.localeCompare(b.on);

/** NEXT FIRST: what is still to come, soonest first, then the rest, the
    latest first. Newest and oldest run on the same day; biggest on value. */
export function sortRows(rows: readonly JobsListRow[], sort: JobSort): JobsListRow[] {
  const list = [...rows];
  if (sort === "newest") return list.sort(byOn(-1));
  if (sort === "oldest") return list.sort(byOn(1));
  if (sort === "value")
    return list.sort((a, b) =>
      a.valueCents === b.valueCents ? byOn(-1)(a, b) : a.valueCents === null ? 1 : b.valueCents === null ? -1 : b.valueCents - a.valueCents,
    );
  return list.sort((a, b) => (a.ahead !== b.ahead ? (a.ahead ? -1 : 1) : a.ahead ? byOn(1)(a, b) : byOn(-1)(a, b)));
}

/** Everyone on any row, A to Z, for the Who chooser. */
export function peopleOf(rows: readonly JobsListRow[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) for (const n of r.who) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
