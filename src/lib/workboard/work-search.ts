/* THE ONE SEARCH BOX, and everything it reaches.

   The board used to carry two search fields, both INSIDE the white card: one
   in the agreements ledger's header, one repeated across the three All jobs
   list headers. Which search you could reach therefore depended on the tab
   you happened to be standing on — and on Urgent, Upcoming, Calendar,
   Pipeline and Schedule there was none at all. Ask somebody to find the
   Kingsford job and they don't first decide which of three sides owns it;
   that is the software's question, not theirs.

   So there is one box now, above the card and beside the mirror-health chip,
   and this module is what it reaches: every ServiceM8 job in the loaded
   window, every maintenance visit and agreement, every project and every
   trip. Results are GROUPED BY THE SIDE that owns each thing, because an
   answer has to say where it will take you as well as what it found.

   ONE THING, ONE HIT. A ServiceM8 job already promoted onto a board is found
   as the promotion — the visit, the trip, the project — and never also as
   itself: a row found twice looks like two jobs. Absorption is by PRESENCE of
   the link (a visit's or trip's own remoteId, a project's link rows), the
   same rule the All jobs union already runs on.

   Pure and client-safe: everything here is derived from what the page already
   loaded. The rest of the mirror — anything older than the board's window —
   is reached by the server action instead, and its rows come back through
   `elsewhere` so they can be told apart from what was on screen all along. */

import type { BoardVisit, BoardAgreement } from "./board-query";
import type { BoardProject, ProjectBoardVisit } from "./projects-board-query";
import type { AllJobsMirrorJob } from "./all-jobs";

/** Below this a query is a keystroke on the way to one, not a question. The
    same floor the mirror search uses, so the local and remote halves of one
    box never disagree about when searching has started. */
export const SEARCH_MIN = 2;

/** Past this a group is answering with a wall rather than an answer. The
    count line says what was held back — a cap nobody is told about reads as
    "that's all there is". */
export const GROUP_CAP = 25;

export type WorkHitGo =
  | { side: "jobs"; kind: "job"; remoteId: string }
  | { side: "maintenance"; kind: "visit"; id: string }
  | { side: "maintenance"; kind: "agreement"; id: string }
  | { side: "projects"; kind: "trip"; id: string }
  | { side: "projects"; kind: "project"; id: string };

export type WorkHit = {
  key: string;
  /** Where choosing this row takes you — side first, because most of these
      are on a side you aren't standing on. */
  go: WorkHitGo;
  /** The number and WHOSE it is. Both families are four digits and they mean
      different things, so neither is ever rendered bare (see BoardVisit.jobNo). */
  number: string | null;
  numberSystem: "sm8" | "ours" | null;
  /** Who the work is for — the row's first line. */
  title: string;
  /** What the work is — the row's second line. */
  sub: string | null;
  where: string | null;
  date: string | null;
  /** What the date MEANS: due, booked, quoted, completed. */
  dateLabel: string;
  statusLabel: string;
  /** The existing chip vocabulary — this module never invents a tone. */
  tone: "" | "ok" | "warn" | "dan";
  /** Still live work: sorted ahead of what's finished. */
  live: boolean;
};

export type WorkSearchGroupKey = "jobs" | "maintenance" | "projects" | "elsewhere";

export type WorkSearchGroup = {
  key: WorkSearchGroupKey;
  label: string;
  note: string;
  /** Capped at GROUP_CAP — `found` is how many there really were. */
  hits: WorkHit[];
  found: number;
};

export type WorkSearchResult = {
  groups: WorkSearchGroup[];
  /** Every match, cap or no cap — the headline count. */
  total: number;
};

export type WorkSearchInput = {
  today: string;
  jobs: readonly AllJobsMirrorJob[];
  visits: readonly BoardVisit[];
  agreements: readonly BoardAgreement[];
  projects: readonly BoardProject[];
  trips: readonly ProjectBoardVisit[];
  /** Which ServiceM8 jobs each project has claimed — half of the absorption. */
  projectLinks: readonly { projectId: string; remoteId: string }[];
  /** Mirror rows the server found past the loaded window. */
  elsewhere?: readonly AllJobsMirrorJob[];
};

/** Typed words, taken literally — the rule the job list has always used, and
    the opposite of note-match's token guessing. Every word must appear
    somewhere, so "ardex cool" finds the cool room at Ardex without finding
    every job at Ardex.

    An empty query matches NOTHING here, where the list filter it grew from
    matched everything: this box decides whether searching is happening at
    all, and "not asked yet" must never read as "all of it matched". */
export function matchesWords(
  fields: readonly (string | null | undefined)[],
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return needle.split(/\s+/).every((word) => hay.includes(word));
}

const day = (naive: string | null | undefined): string | null =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/* ── one hit per kind ──

   Each of these speaks its side's own language — a visit is "due", a quote is
   "quoted", a project is "promised" — because collapsing five vocabularies
   into one would make the row shorter and the answer vaguer. */

function jobHit(job: AllJobsMirrorJob, today: string): WorkHit {
  const done = job.status === "Completed" || job.status === "Unsuccessful";
  const quote = job.status === "Quote";
  const nextBooking = day(job.nextBooking);
  const booked = !done && !quote && nextBooking !== null && nextBooking >= today;

  return {
    key: `job:${job.remoteId}`,
    go: { side: "jobs", kind: "job", remoteId: job.remoteId },
    number: job.jobNumber,
    numberSystem: job.jobNumber ? "sm8" : null,
    title: job.clientName ?? "Unnamed client",
    sub: job.description,
    where: job.suburb,
    date: done
      ? day(job.completionDate) ?? day(job.date)
      : quote
        ? day(job.quoteDate) ?? day(job.date)
        : booked
          ? nextBooking
          : day(job.date),
    dateLabel: done
      ? job.status === "Completed"
        ? "completed"
        : "closed"
      : quote
        ? "quoted"
        : booked
          ? "booked"
          : "raised",
    statusLabel: job.status ?? "Job",
    tone: job.status === "Completed" ? "ok" : job.status === "Unsuccessful" ? "dan" : "",
    live: !done,
  };
}

function visitHit(v: BoardVisit, today: string): WorkHit {
  const done = v.status === "done" || v.status === "skipped";
  const placed = v.bookedDate ?? day(v.bookedStart);
  return {
    key: `visit:${v.id}`,
    go: { side: "maintenance", kind: "visit", id: v.id },
    number: v.jobNo !== null ? String(v.jobNo) : v.jobNumber,
    numberSystem: v.jobNo !== null ? "ours" : v.jobNumber ? "sm8" : null,
    title: v.clientName,
    sub: v.label,
    where: v.siteLabel,
    date: done ? day(v.completedAt) ?? v.dueDate : placed ?? v.dueDate,
    dateLabel: done ? "completed" : placed ? "booked" : v.dueDate < today ? "was due" : "due",
    statusLabel: done ? (v.status === "skipped" ? "Skipped" : "Done") : "Maintenance",
    tone: done ? (v.status === "skipped" ? "warn" : "ok") : "",
    live: !done,
  };
}

function agreementHit(a: BoardAgreement): WorkHit {
  const paused = a.status === "paused";
  const overdue = !paused && a.overdueCount > 0;
  return {
    key: `agreement:${a.id}`,
    go: { side: "maintenance", kind: "agreement", id: a.id },
    number: null,
    numberSystem: null,
    title: a.clientName,
    sub: a.label,
    where: a.siteLabel ?? a.siteAddress,
    date: paused ? null : a.nextDue,
    dateLabel: paused ? "paused" : overdue ? "overdue since" : a.nextDue ? "next due" : "no open visits",
    statusLabel: paused ? "Paused" : "Agreement",
    tone: paused ? "warn" : overdue ? "dan" : "",
    live: !paused,
  };
}

function projectHit(p: BoardProject): WorkHit {
  const done = p.status === "done";
  return {
    key: `project:${p.id}`,
    go: { side: "projects", kind: "project", id: p.id },
    number: null,
    numberSystem: null,
    title: p.name,
    sub: p.clientName,
    where: p.siteLabel ?? p.siteAddress,
    date: done ? day(p.updatedAt) : p.promisedFinish,
    dateLabel: done ? "closed" : p.promisedFinish ? "promised" : "no date promised",
    statusLabel: done
      ? "Project done"
      : p.status === "blocked"
        ? "Project blocked"
        : p.status === "on_hold"
          ? "Project on hold"
          : "Project",
    tone: done ? "ok" : p.status === "blocked" ? "dan" : p.status === "on_hold" ? "warn" : "",
    live: !done,
  };
}

function tripHit(t: ProjectBoardVisit, today: string): WorkHit {
  const done = t.status === "done" || t.status === "skipped";
  const placed = t.bookedDate ?? day(t.bookedStart);
  return {
    key: `trip:${t.id}`,
    go: { side: "projects", kind: "trip", id: t.id },
    number: t.jobNo !== null ? String(t.jobNo) : t.jobNumber,
    numberSystem: t.jobNo !== null ? "ours" : t.jobNumber ? "sm8" : null,
    title: t.projectName,
    sub: t.label,
    where: t.siteLabel,
    date: done ? day(t.completedAt) ?? t.dueDate : placed ?? t.dueDate,
    dateLabel: done ? "completed" : placed ? "booked" : t.dueDate < today ? "was due" : "due",
    statusLabel: done ? (t.status === "skipped" ? "Skipped" : "Done") : "Trip",
    tone: done ? (t.status === "skipped" ? "warn" : "ok") : "",
    live: !done,
  };
}

/* ── order ──

   Live work first and SOONEST first; finished work after it and NEWEST first.
   Both halves are "nearest the present", which is the one ordering that
   answers a search: what's coming up is what you're chasing, and the recent
   past is the half of history anyone looks for. A blank date sorts last
   either way, and the key breaks ties so nothing wobbles between renders. */
const bySoonest = (a: WorkHit, b: WorkHit) =>
  a.date === b.date
    ? a.key.localeCompare(b.key)
    : !a.date
      ? 1
      : !b.date
        ? -1
        : a.date.localeCompare(b.date);

const byNewest = (a: WorkHit, b: WorkHit) =>
  a.date === b.date
    ? a.key.localeCompare(b.key)
    : !a.date
      ? 1
      : !b.date
        ? -1
        : b.date.localeCompare(a.date);

function ordered(hits: WorkHit[]): WorkHit[] {
  return [
    ...hits.filter((h) => h.live).sort(bySoonest),
    ...hits.filter((h) => !h.live).sort(byNewest),
  ];
}

function group(
  key: WorkSearchGroupKey,
  label: string,
  note: string,
  hits: WorkHit[]
): WorkSearchGroup | null {
  if (hits.length === 0) return null;
  const sorted = ordered(hits);
  return { key, label, note, hits: sorted.slice(0, GROUP_CAP), found: sorted.length };
}

export function searchWorkboard(input: WorkSearchInput, query: string): WorkSearchResult {
  const q = query.trim();
  if (q.length < SEARCH_MIN) return { groups: [], total: 0 };
  const { today } = input;

  /* Absorption, decided before anything is matched: a ServiceM8 job that some
     board has already claimed is findable as that claim and not as itself. */
  const claimed = new Set<string>();
  for (const v of input.visits) if (v.remoteId) claimed.add(v.remoteId);
  for (const t of input.trips) if (t.remoteId) claimed.add(t.remoteId);
  for (const l of input.projectLinks) claimed.add(l.remoteId);

  const jobs: WorkHit[] = [];
  const onScreen = new Set<string>();
  for (const j of input.jobs) {
    onScreen.add(j.remoteId);
    if (claimed.has(j.remoteId)) continue;
    if (!matchesWords([j.jobNumber, j.clientName, j.description, j.suburb, j.categoryName], q)) {
      continue;
    }
    jobs.push(jobHit(j, today));
  }

  const maintenance: WorkHit[] = [];
  for (const v of input.visits) {
    const tags = v.tags.map((t) => t.name);
    if (!matchesWords([v.jobNumber, v.jobNo === null ? null : String(v.jobNo), v.clientName, v.label, v.siteLabel, v.category?.name, ...tags], q)) {
      continue;
    }
    maintenance.push(visitHit(v, today));
  }
  for (const a of input.agreements) {
    const tags = a.tags.map((t) => t.name);
    if (!matchesWords([a.clientName, a.label, a.siteLabel, a.siteAddress, a.category?.name, ...tags], q)) {
      continue;
    }
    maintenance.push(agreementHit(a));
  }

  const projects: WorkHit[] = [];
  for (const p of input.projects) {
    if (!matchesWords([p.name, p.clientName, p.siteLabel, p.siteAddress, p.stage], q)) continue;
    projects.push(projectHit(p));
  }
  for (const t of input.trips) {
    if (!matchesWords([t.jobNumber, t.jobNo === null ? null : String(t.jobNo), t.projectName, t.clientName, t.label, t.siteLabel], q)) {
      continue;
    }
    projects.push(tripHit(t, today));
  }

  /* The mirror's older half. Filtered against the SAME rule the local half
     runs, because the server's query is broader than the words typed (it
     matches a company by name and then takes that company's jobs), and a row
     nobody's words picked out reads as a miss. */
  const elsewhere: WorkHit[] = [];
  for (const j of input.elsewhere ?? []) {
    if (onScreen.has(j.remoteId) || claimed.has(j.remoteId)) continue;
    if (!matchesWords([j.jobNumber, j.clientName, j.description, j.suburb, j.categoryName], q)) {
      continue;
    }
    elsewhere.push(jobHit(j, today));
  }

  const groups = [
    group("maintenance", "Maintenance", "Visits and the agreements behind them.", maintenance),
    group("projects", "Projects", "Projects and the trips booked on them.", projects),
    group("jobs", "ServiceM8 jobs", "In the book, not promoted onto a board.", jobs),
    group(
      "elsewhere",
      "Found elsewhere in ServiceM8",
      "Older than the board's window, reached by asking.",
      elsewhere
    ),
  ].filter((g): g is WorkSearchGroup => g !== null);

  return { groups, total: groups.reduce((n, g) => n + g.found, 0) };
}
