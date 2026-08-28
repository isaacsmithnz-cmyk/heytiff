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

import {
  jobMoneyOf,
  collectionFrom,
  isAwaitingPayment,
  MONEY_BASIS,
  type CollectionState,
  type JobMoney,
} from "./job-money";

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
  /** ServiceM8's own category colour, already sanitised to '#rrggbb' or null. */
  categoryColour: string | null;
  /** The job's own date, naive local — when it was raised. */
  date: string | null;
  quoteDate: string | null;
  completionDate: string | null;
  /** Next diary block from job_activities, naive local, or null. */
  nextBooking: string | null;
  money: JobMoney | null;
  /** Summed from this job's payment rows — the collection truth. Zero both
      when nothing was paid and when the reader holds no money grant; the
      grant case is already distinguished by `money` being null. */
  paidCents: number;
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
  /** The category's own colour from ServiceM8, or null — worn as a dot, never
      as the chip's whole surface, because their palette makes no contrast
      promises against our text. */
  categoryColour: string | null;
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
  money: {
    valueCents: number | null;
    /** Counted from payment rows, never from a flag — see collectionFrom. */
    paidCents: number;
    collection: CollectionState;
    /** Null = ServiceM8 never sent the flag; the chip stays off. */
    quoteSent: boolean | null;
    quoteSentOn: string | null;
  } | null;
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

/** The four ServiceM8 date fields a row can be dated BY, in the shape both
    callers hold — the board's slim mirror row and the sheet's full detail. */
export type Sm8Dated = {
  status: string | null;
  date: string | null;
  quoteDate: string | null;
  completionDate: string | null;
  /** The next dispatched booking's start, when there is one. */
  nextBooking: string | null;
};

/** WHICH DAY A JOB IS SHOWN BY, and what to call it. Exported because the job
    SHEET needs the same answer for a card the board never handed it: a
    ServiceM8 clone opens its parent, and the parent's dates are not the ones
    on the row that was clicked. Deriving it twice is how the same job comes
    to be "raised Fri 27 Mar" in one place and "completed Fri 21 Aug" in the
    other. */
export function sm8DateFacts(
  job: Sm8Dated,
  today: string
): { date: string | null; label: string; booked: boolean } {
  const tab = tabOfSm8(job.status);
  const nextBooking = day(job.nextBooking);
  const booked = tab === "work" && nextBooking !== null && nextBooking >= today;

  if (tab === "completed" || tab === "unsuccessful") {
    return {
      date: day(job.completionDate) ?? day(job.date),
      label: tab === "completed" ? "completed" : "closed",
      booked,
    };
  }
  if (tab === "quotes") {
    return { date: day(job.quoteDate) ?? day(job.date), label: "quoted", booked };
  }
  if (booked) return { date: nextBooking, label: "booked", booked };
  return { date: day(job.date), label: "raised", booked };
}

/** A ServiceM8 status's tone, said once so a chip and a row agree. */
export function sm8Tone(status: string | null): "" | "ok" | "dan" {
  return status === "Completed" ? "ok" : status === "Unsuccessful" ? "dan" : "";
}

function sm8Row(
  job: AllJobsMirrorJob,
  today: string,
  tracked: AllJobRow["tracked"]
): AllJobRow {
  const { date, label: dateLabel, booked } = sm8DateFacts(job, today);

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
    categoryColour: job.categoryColour,
    statusLabel: job.status ?? "Job",
    tone: sm8Tone(job.status),
    date,
    dateLabel,
    booked,
    tracked,
    money: job.money
      ? {
          valueCents: job.money.valueCents,
          paidCents: job.paidCents,
          collection: collectionFrom(job.money.valueCents, job.paidCents),
          quoteSent: job.money.quoteSent,
          quoteSentOn: job.money.quoteSentOn,
        }
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
    categoryColour: null,
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
    categoryColour: null,
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

/* ── ServiceM8 field readers, pure and shared by loader and sheet ── */

/** ServiceM8 category colours arrive as BARE hex — "e7b5ff", no hash (the
    live mirror confirmed it). Accept 3/6/8-digit hex with or without the
    hash, hand back a lowercase '#…' ready for CSS, and refuse anything else
    so a surprise value can never reach a style attribute. */
export function sm8CategoryColour(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^#/, "").toLowerCase();
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return null;
  return `#${s}`;
}

/** Minutes between two naive 'YYYY-MM-DD HH:MM:SS' stamps, by treating both
    as UTC — no timezone in the arithmetic at all, which is the point: parsing
    a wall clock into a local Date would make a duration depend on where the
    server runs. Null for malformed input or a negative span. */
export function sm8MinutesBetween(start: string, end: string): number | null {
  const at = (s: string): number | null => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  };
  const a = at(start);
  const b = at(end);
  if (a === null || b === null || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/** "18h 30m" / "3h" / "45m" — the shape ServiceM8's own billing tab uses. */
export function fmtMinutesAsHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** One checklist item, as the sheet renders it. */
export type JobChecklistItem = {
  name: string;
  /** 'Todo' | 'Photo' | 'Document' | 'Form' — verbatim from ServiceM8. */
  itemType: string | null;
  section: string | null;
  done: boolean;
  doneOn: string | null;
  /** The whole naive stamp, to the minute — the diary orders a day by it. */
  doneAt: string | null;
  doneBy: string | null;
};

/** Split a sort-ordered checklist into its sections, order preserved. A run
    of items with no section leads the list unlabelled, exactly as ServiceM8
    lays it out. */
export function groupChecklist(
  items: readonly JobChecklistItem[]
): { section: string | null; items: JobChecklistItem[] }[] {
  const groups: { section: string | null; items: JobChecklistItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

/* ── search LIVED HERE ──

   `matchesJobSearch` and `filterView` filtered these three lists against the
   box in their own card header. Both are gone with that box: the board's one
   search sits above the card and reaches every side, so a query never narrows
   this view any more — it replaces it. The rule they carried is the part
   worth keeping and it moved intact, to `matchesWords` in work-search: typed
   words taken literally, every one of them having to land. */

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
    asked. Counts jobs worth a KNOWN amount with some of it still out, so it
    can't be inflated by the many jobs whose total ServiceM8 never filled in.
    Null when the reader has no money access. */
export function awaitingPaymentCount(view: AllJobsView): number | null {
  const withMoney = view.completed.filter((r) => r.money !== null);
  if (withMoney.length === 0) return null;
  return withMoney.filter((r) => isAwaitingPayment(r.money!.collection)).length;
}

/** What's still out on finished work, in cents — the figure behind the count.
    Only jobs with a known total contribute, so this never guesses. */
export function awaitingPaymentCents(view: AllJobsView): number {
  return view.completed.reduce((sum, r) => {
    const m = r.money;
    if (!m || !isAwaitingPayment(m.collection) || m.valueCents === null) return sum;
    return sum + Math.max(0, m.valueCents - m.paidCents);
  }, 0);
}

/** Re-export so the sheet and rows read one job's money the same way. */
export { jobMoneyOf, MONEY_BASIS };
