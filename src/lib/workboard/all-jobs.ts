/* The whole book of work, in one list — pure, client-safe, `today` handed in.

   WHY THIS EXISTS. Maintenance and Projects are DERIVED boards: they show
   work that has been promoted into an agreement or a project. Everything else
   a business does — the small service call, the one-off install, the quote
   that hasn't been answered — was mirrored from ServiceM8 and then visible
   nowhere. This is the flat book ServiceM8 itself keeps, and the funnel: see
   an untracked job, put it on a board.

   THE UNION RULE, in one sentence: ONE ROW PER SERVICEM8 JOB, PLUS ONE ROW
   PER NATIVE ITEM THAT HAS NO SERVICEM8 JOB.

   That is what makes the counts reconcile with ServiceM8's own board — every
   mirrored job appears exactly once — while still showing the work that only
   exists here. A job that IS tracked wears a chip naming what it belongs to,
   instead of its visit or project appearing again as a second row. Absorption
   is decided by PRESENCE, never by the mere existence of a link: if the
   mirror hasn't got the job yet (fresh backfill, wipe, standalone), the
   native row shows, because a warming cache must never make work disappear.

   PROJECT TRIPS NEVER ROWIFY. A project's rough-in day is a sub-event of the
   project, and listing five trips beside 538 work orders buries the thing
   they belong to. The project is the row; the trips live inside it.

   THE HORIZON, and why only native visits get one. A maintenance agreement
   generates its whole future — roughly thirteen visits apiece, out for years
   — because ServiceM8 has no recurring jobs and that engine is why the
   agreement exists. Those far-future rows are the SAME job repeating, and
   they would swamp the real ones. So a native visit shows only inside the
   working horizon. A LINKED visit is exempt: it appears as its ServiceM8 row,
   at whatever date ServiceM8 says, because that row is a real job somebody
   raised. The asymmetry is deliberate — speculation is horizoned, fact is
   not. */

import { jobMoneyOf, collectionState, type JobMoney } from "./job-money";

/** How far ahead a NOT-YET-RAISED maintenance visit is worth listing. Matches
    the board's own history window so the tab's two directions are symmetrical. */
export const ALL_JOBS_HORIZON_DAYS = 56;

/* ── inputs ── */

/** One mirrored ServiceM8 job, as the loader hands it over. */
export type AllJobsMirrorJob = {
  remoteId: string;
  jobNumber: string | null;
  /** Verbatim: 'Quote' | 'Work Order' | 'Completed' | 'Unsuccessful'. */
  status: string | null;
  clientName: string | null;
  description: string | null;
  suburb: string | null;
  categoryName: string | null;
  /** The job's own date, naive local — when it was raised. */
  date: string | null;
  quoteDate: string | null;
  completionDate: string | null;
  /** Next diary block from job_activities, naive local, or null. */
  nextBooking: string | null;
  money: JobMoney | null;
};

/** A maintenance visit, slimmed from BoardVisit. */
export type AllJobsVisit = {
  id: string;
  jobNo: number | null;
  remoteId: string | null;
  clientName: string;
  label: string;
  siteLabel: string | null;
  categoryName: string | null;
  dueDate: string;
  bookedDate: string | null;
  status: string;
  completedAt: string | null;
};

/** A project, slimmed from BoardProject, plus its own links and next trip. */
export type AllJobsProject = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  status: string;
  stage: string;
  /** Every ServiceM8 job this project links, present in the mirror or not. */
  remoteIds: string[];
  /** The soonest booked day across its open trips, if any. */
  nextBookedDate: string | null;
  updatedAt: string;
};

/* ── output ── */

export type AllJobsTab = "work" | "quotes" | "completed";

export type AllJobRow = {
  /** Stable across renders and unique across kinds. */
  key: string;
  kind: "sm8" | "visit" | "project";
  id: string;
  /** The number, and WHOSE it is — never render one unlabelled beside the
      other, because both families are four digits and they mean different
      things (see BoardVisit.jobNo). */
  number: string | null;
  numberSystem: "sm8" | "ours" | null;
  clientName: string | null;
  title: string | null;
  suburb: string | null;
  categoryName: string | null;
  /** What to call this row's state, in the reader's language. */
  statusLabel: string;
  /** Existing chip vocabulary: "" | ok | warn | dan. */
  tone: "" | "ok" | "warn" | "dan";
  /** The date this row is ABOUT, and what it means. */
  date: string | null;
  dateLabel: string;
  booked: boolean;
  /** Present when this job is already on one of the other two boards. */
  tracked: { kind: "visit" | "project"; label: string; id: string } | null;
  /** Null when the reader has no money access, or the row carries none. */
  money: { valueCents: number | null; collection: ReturnType<typeof collectionState> } | null;
  /** Sort key within its section — a naive date string or "". */
  sortOn: string;
};

export type AllJobsView = {
  work: { booked: AllJobRow[]; unbooked: AllJobRow[] };
  quotes: AllJobRow[];
  completed: AllJobRow[];
  unsuccessful: AllJobRow[];
};

/* ── helpers ── */

const day = (naive: string | null): string | null =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/** Add days to an ISO date without a Date round-trip at midnight. */
function plusDaysISO(iso: string, days: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Descending by date, blanks last, then by key so ties never wobble. */
const byNewest = (a: AllJobRow, b: AllJobRow) =>
  a.sortOn === b.sortOn
    ? a.key.localeCompare(b.key)
    : a.sortOn === ""
      ? 1
      : b.sortOn === ""
        ? -1
        : b.sortOn.localeCompare(a.sortOn);

/** Ascending — soonest first. Used for booked work, where next is next. */
const bySoonest = (a: AllJobRow, b: AllJobRow) =>
  a.sortOn === b.sortOn
    ? a.key.localeCompare(b.key)
    : a.sortOn === ""
      ? 1
      : b.sortOn === ""
        ? -1
        : a.sortOn.localeCompare(b.sortOn);

/** ServiceM8's status verbatim → the tab it belongs on. */
function tabOfSm8(status: string | null): AllJobsTab | "unsuccessful" | null {
  switch (status) {
    case "Quote":
      return "quotes";
    case "Work Order":
      return "work";
    case "Completed":
      return "completed";
    case "Unsuccessful":
      return "unsuccessful";
    default:
      // ServiceM8 adding a fifth status must not drop the job on the floor:
      // an unknown state is still open work somebody raised.
      return status ? "work" : null;
  }
}

function sm8Row(
  job: AllJobsMirrorJob,
  today: string,
  tracked: AllJobRow["tracked"]
): AllJobRow {
  const tab = tabOfSm8(job.status);
  const nextBooking = day(job.nextBooking);
  const booked = tab === "work" && nextBooking !== null && nextBooking >= today;

  let date: string | null;
  let dateLabel: string;
  if (tab === "completed" || tab === "unsuccessful") {
    date = day(job.completionDate) ?? day(job.date);
    dateLabel = tab === "completed" ? "completed" : "closed";
  } else if (tab === "quotes") {
    date = day(job.quoteDate) ?? day(job.date);
    dateLabel = "quoted";
  } else if (booked) {
    date = nextBooking;
    dateLabel = "booked";
  } else {
    date = day(job.date);
    dateLabel = "raised";
  }

  return {
    key: `sm8:${job.remoteId}`,
    kind: "sm8",
    id: job.remoteId,
    number: job.jobNumber,
    numberSystem: "sm8",
    clientName: job.clientName,
    title: job.description,
    suburb: job.suburb,
    categoryName: job.categoryName,
    statusLabel: job.status ?? "Job",
    tone: job.status === "Completed" ? "ok" : job.status === "Unsuccessful" ? "dan" : "",
    date,
    dateLabel,
    booked,
    tracked,
    money: job.money
      ? { valueCents: job.money.valueCents, collection: collectionState(job.money) }
      : null,
    sortOn: date ?? "",
  };
}

function visitRow(v: AllJobsVisit, today: string): AllJobRow {
  const done = v.status === "done" || v.status === "skipped";
  const booked = !done && v.bookedDate !== null;
  const date = done ? v.completedAt ?? v.dueDate : (v.bookedDate ?? v.dueDate);
  return {
    key: `visit:${v.id}`,
    kind: "visit",
    id: v.id,
    number: v.jobNo !== null ? String(v.jobNo) : null,
    numberSystem: v.jobNo !== null ? "ours" : null,
    clientName: v.clientName,
    title: v.label,
    suburb: v.siteLabel,
    categoryName: v.categoryName,
    statusLabel: done ? (v.status === "skipped" ? "Skipped" : "Done") : "Maintenance",
    tone: done ? (v.status === "skipped" ? "warn" : "ok") : "",
    date,
    dateLabel: done ? "completed" : booked ? "booked" : v.dueDate < today ? "was due" : "due",
    booked,
    tracked: null,
    // Nothing native carries a ServiceM8 invoice; our own claims belong to
    // projects, not to a single visit.
    money: null,
    sortOn: date ?? "",
  };
}

function projectRow(p: AllJobsProject): AllJobRow {
  const done = p.status === "done";
  const booked = !done && p.nextBookedDate !== null;
  const date = done ? p.updatedAt.slice(0, 10) : p.nextBookedDate;
  return {
    key: `project:${p.id}`,
    kind: "project",
    id: p.id,
    number: null,
    numberSystem: null,
    clientName: p.clientName ?? p.name,
    title: p.name,
    suburb: p.siteLabel,
    categoryName: p.stage,
    statusLabel: done
      ? "Project done"
      : p.status === "blocked"
        ? "Project blocked"
        : p.status === "on_hold"
          ? "Project on hold"
          : "Project",
    tone: done ? "ok" : p.status === "blocked" ? "dan" : p.status === "on_hold" ? "warn" : "",
    date,
    dateLabel: done ? "closed" : booked ? "next on site" : "no day booked",
    booked,
    tracked: null,
    money: null,
    sortOn: date ?? "",
  };
}

/** The whole view. Everything here is derived — nothing is stored. */
export function allJobsRows(input: {
  jobs: readonly AllJobsMirrorJob[];
  visits: readonly AllJobsVisit[];
  projects: readonly AllJobsProject[];
  today: string;
}): AllJobsView {
  const { today } = input;
  const horizon = plusDaysISO(today, ALL_JOBS_HORIZON_DAYS);
  const backTo = plusDaysISO(today, -ALL_JOBS_HORIZON_DAYS);

  /* Which ServiceM8 jobs are actually on screen. Absorption is keyed off THIS
     set, not off the link columns: a link pointing at a job the mirror hasn't
     got yet absorbs nothing, so the native row still shows. */
  const present = new Set(input.jobs.map((j) => j.remoteId));

  /* What each present job is already tracked as. Visits win over projects
     when a job is somehow both: a visit is the more specific answer. */
  const trackedBy = new Map<string, AllJobRow["tracked"]>();
  for (const p of input.projects) {
    for (const remoteId of p.remoteIds) {
      if (present.has(remoteId) && !trackedBy.has(remoteId)) {
        trackedBy.set(remoteId, { kind: "project", label: p.name, id: p.id });
      }
    }
  }
  for (const v of input.visits) {
    if (v.remoteId && present.has(v.remoteId)) {
      trackedBy.set(v.remoteId, {
        kind: "visit",
        label: v.jobNo !== null ? `#${v.jobNo}` : v.label,
        id: v.id,
      });
    }
  }

  const view: AllJobsView = {
    work: { booked: [], unbooked: [] },
    quotes: [],
    completed: [],
    unsuccessful: [],
  };

  for (const job of input.jobs) {
    const tab = tabOfSm8(job.status);
    if (tab === null) continue;
    const row = sm8Row(job, today, trackedBy.get(job.remoteId) ?? null);
    if (tab === "quotes") view.quotes.push(row);
    else if (tab === "completed") view.completed.push(row);
    else if (tab === "unsuccessful") view.unsuccessful.push(row);
    else if (row.booked) view.work.booked.push(row);
    else view.work.unbooked.push(row);
  }

  for (const v of input.visits) {
    if (v.remoteId && present.has(v.remoteId)) continue; // absorbed by its job
    const done = v.status === "done" || v.status === "skipped";
    if (done) {
      // The board already windows its history; this guards a wider caller.
      if ((v.completedAt ?? v.dueDate) < backTo) continue;
      view.completed.push(visitRow(v, today));
      continue;
    }
    if (v.dueDate > horizon) continue; // speculation is horizoned — see header
    const row = visitRow(v, today);
    if (row.booked) view.work.booked.push(row);
    else view.work.unbooked.push(row);
  }

  for (const p of input.projects) {
    if (p.status === "archived") continue;
    if (p.remoteIds.some((r) => present.has(r))) continue; // absorbed by its jobs
    const row = projectRow(p);
    if (p.status === "done") view.completed.push(row);
    else if (row.booked) view.work.booked.push(row);
    else view.work.unbooked.push(row);
  }

  view.work.booked.sort(bySoonest);
  view.work.unbooked.sort(byNewest);
  view.quotes.sort(byNewest);
  view.completed.sort(byNewest);
  view.unsuccessful.sort(byNewest);
  return view;
}

/* ── search ── */

/** Typed words, taken literally — the opposite of note-match's token guessing.
    Someone typing "medical" means medical. Matches number, client, title,
    suburb and category so one box answers every way a job is remembered. */
export function matchesJobSearch(row: AllJobRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [row.number, row.clientName, row.title, row.suburb, row.categoryName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  // Every word must appear somewhere — "ardex cool" finds the cool room job
  // at Ardex without finding every job at Ardex.
  return needle.split(/\s+/).every((word) => hay.includes(word));
}

export function filterView(view: AllJobsView, query: string): AllJobsView {
  if (!query.trim()) return view;
  const keep = (rows: AllJobRow[]) => rows.filter((r) => matchesJobSearch(r, query));
  return {
    work: { booked: keep(view.work.booked), unbooked: keep(view.work.unbooked) },
    quotes: keep(view.quotes),
    completed: keep(view.completed),
    unsuccessful: keep(view.unsuccessful),
  };
}

/* ── the count lines under each tab's title ── */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function workCountLine(view: AllJobsView): string {
  const total = view.work.booked.length + view.work.unbooked.length;
  if (total === 0) return "Nothing open";
  return `${plural(total, "job", "jobs")} on — ${view.work.booked.length} booked, ${
    view.work.unbooked.length
  } waiting on a day`;
}

export function quotesCountLine(view: AllJobsView): string {
  const n = view.quotes.length;
  return n === 0 ? "No quotes out" : `${plural(n, "quote", "quotes")} awaiting an answer`;
}

export function completedCountLine(view: AllJobsView, showUnsuccessful: boolean): string {
  const n = view.completed.length;
  const u = view.unsuccessful.length;
  const head = n === 0 ? "Nothing finished recently" : `${plural(n, "job", "jobs")} finished`;
  if (u === 0) return head;
  return showUnsuccessful ? `${head}, ${u} that didn't go ahead` : head;
}

/** Money owed on finished work — the question a completed list is really
    asked. Null when the reader has no money access. */
export function awaitingPaymentCount(view: AllJobsView): number | null {
  const withMoney = view.completed.filter((r) => r.money !== null);
  if (withMoney.length === 0) return null;
  return withMoney.filter((r) => r.money!.collection === "awaiting").length;
}

/** Re-export so the sheet and rows read one job's money the same way. */
export { jobMoneyOf };
