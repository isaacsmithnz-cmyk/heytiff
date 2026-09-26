/* HOME'S RIGHT-HAND LIST — the pure half: the types, the placement rules and
   the words. No clock and no I/O; the reads are ./home-list-query.

   ONE LIST OF WHAT IS WAITING ON YOU, in five groups by urgency — Late,
   Today, Jobs to book, No date, Later — and a group with nothing in it is not
   there. Tasks come first in every group (a box you tick), then alerts (a
   dot: the business telling you something), each alert a door to its thing
   carrying at most the one verb it needs.

   EVERY ROW IS PLACED BY ITS OWN DATE AGAINST `day`. `day` is the workspace's
   day — the ServiceM8 account's zone, Sydney without one — the same day the
   day bar draws. A chip's bad/warn `state` is never used to place a dated
   row: chips are counted on Sydney's date, which is a second clock, and a
   Perth evening would put yesterday's expiry under Today by one and Late by
   the other. The one rule both clocks share is `expiryDue` (lib/expiry-due),
   the one the calendar reads too.

   COUNTS COUNT THINGS, not rows (Isaac, 2026-09-25): a roll-up of seventeen
   won jobs makes "Jobs to book 17", not 1.

   JOBS TO BOOK are ServiceM8 Work Orders won in the last 90 days that were
   never booked at all — not the board's "Waiting on a day", which counts any
   work order with no FUTURE booking. The two numbers must never stand side by
   side, and they use different words ("no day" here) so they can't be read
   as one another.

   DOORS ARE DATA. A row says where it goes — a URL, a job's card, a diary
   entry, a mention, a task — and the screen that draws the list decides how
   to open each (the list's UI, the frame's one job card). Nothing here reads
   write state: a Book in that books in ServiceM8 is a later phase's, and it
   will ask `offersSend` itself. */

import { daysUntil, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { expiryDue } from "@/lib/expiry-due";
import { fmtKm } from "@/components/fleet/logic";
import { agoLabel } from "@/lib/format/duration";
import { fmtAud } from "@/lib/workboard/project-money";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { ActionChip, ChipKind } from "./chips";
import { zonedParts } from "./day-rail";
import type { HomeIssue } from "./issues";
import { entryForDoor, entryForTask, type JournalEntry } from "./journal";
import type { DashTask } from "./tasks";

/* ── the rules' numbers ── */

/** A won job this fresh gets its own row under Today; older ones roll up. */
export const FRESH_WIN_DAYS = 2;
/** How far back a won, never-booked work order still counts as one to book. */
export const WON_WINDOW_DAYS = 90;
/** How far ahead an unbooked maintenance visit is worth listing — the board's
    own working horizon (ALL_JOBS_HORIZON_DAYS), so the two agree. */
export const VISIT_WINDOW_DAYS = 56;

/** The bell's kinds that reach the list: the ones that count down to a date.
    The rest — queues to decide, a timesheet sent back, a SWMS to sign, files
    stuck on the way to ServiceM8 — stay on the bell until Isaac says (spec
    question 1); adding a kind here is the whole switch. */
export const LIST_CHIP_KINDS: readonly ChipKind[] = [
  "licence",
  "work-rights",
  "rego",
  "insurance",
  "ctp",
  "service",
  "org-licence",
  "org-insurance",
];

export type ListGroupKey = "late" | "today" | "tobook" | "nodate" | "later";

export const GROUP_TITLE: Readonly<Record<ListGroupKey, string>> = {
  late: "Late",
  today: "Today",
  tobook: "Jobs to book",
  nodate: "No date",
  later: "Later",
};

const GROUP_ORDER: readonly ListGroupKey[] = ["late", "today", "tobook", "nodate", "later"];

/** What the list says when nothing is in it. */
export const LIST_EMPTY = "Nothing late, due today or coming up.";

/* ── one due date, one rule ── */

export type ExpiryWhen = "late" | "today" | "soon";

/** WHERE A DATED EXPIRY STANDS ON `day`, in the list's words. The rule is
    `expiryDue`'s (lib/expiry-due), which the calendar reads too, and it is
    the bell's: its `bad` is late, its `warn` is today on the day itself and
    soon before it, and its `ok` (beyond the window) or no real day is
    nowhere (null). Nothing here counts the days a second way. */
function whenDue(iso: string, day: string, warnDays: number): { when: ExpiryWhen; due: string } | null {
  const at = expiryDue(iso, day, warnDays);
  if (!at || at.state === "ok") return null;
  return { due: at.due, when: at.state === "bad" ? "late" : at.days === 0 ? "today" : "soon" };
}

/* ── the shapes ── */

/** Where a row goes. The screen decides how: a URL is followed, a job opens
    the one job card over Home, an entry or a mention is found in the Diary, a
    task opens on the Tasks tab. */
export type Door =
  | { to: "href"; href: string }
  | { to: "job"; remoteId: string }
  | { to: "entry"; id: string }
  | { to: "mention"; id: string }
  | { to: "task"; id: string };

export type VerbLabel = "Renew" | "Log service" | "Book in" | "Book" | "Create job";

/** The one small verb an alert carries. A visit's Book in is the only one
    that acts in place — a day picker calling `placeVisit` — and it names the
    visit rather than a door. */
export type Verb = { label: VerbLabel; door: Door } | { label: "Book in"; placeVisit: string };

export type Dot = "late" | "today" | "quiet";

export type ListTaskRow = {
  kind: "task";
  /** The task's own id — what a tick completes. */
  id: string;
  title: string;
  /** Whose it is, by first name, when it isn't yours. */
  who: string | null;
  sub: string;
  /** The sub-line's colour. "fresh" is never placed here: it is the screen's
      own, for a task it has just made. */
  tone: "late" | "fresh" | "";
  door: Door;
};

export type ListAlertRow = {
  kind: "alert";
  id: string;
  title: string;
  sub: string;
  tone: "late" | "";
  dot: Dot;
  /** A figure on the right — a won job's value, only with the money grant. */
  figure: string | null;
  door: Door;
  verb: Verb | null;
};

/** An open issue. It opens in place (facts, Open in diary, Mark resolved),
    so it has no door, only the diary entry that raised it. */
export type ListIssueRow = {
  kind: "issue";
  id: string;
  issue: HomeIssue;
  /** The summary, verbatim. */
  title: string;
  sub: string;
  dot: Dot;
  entryId: string | null;
  verb: Verb | null;
};

/** Several things of one kind as one row that opens in place to list them. */
export type ListRollupRow = {
  kind: "rollup";
  id: string;
  title: string;
  sub: string;
  /** The stretch of `sub` set in bold ("Oldest **3050 Oatley**, …"), or null. */
  strong: string | null;
  verb: Verb | null;
  rows: ListRow[];
  /** How many things it holds — what the group's count adds. */
  count: number;
};

export type ListRow = ListTaskRow | ListAlertRow | ListIssueRow | ListRollupRow;

export type ListGroup = { key: ListGroupKey; title: string; count: number; rows: ListRow[] };

export type HomeList = {
  day: string;
  /** Non-empty groups only, in order. An all-clear list has none. */
  groups: ListGroup[];
  /** The mirror rows behind every won-job row, so a job door opens the card
      on the same row the board would. */
  jobs: AllJobsMirrorJob[];
};

/* ── the inputs ── */

/** A ServiceM8 Work Order won and never booked, and the day it was won
    (`work_order_date`, else `date`). */
export type WonJob = { job: AllJobsMirrorJob; wonOn: string };

/** A maintenance visit with no day and no ServiceM8 job yet. */
export type VisitToBook = {
  id: string;
  clientName: string | null;
  label: string | null;
  dueDate: string;
};

/** A task a ServiceM8 mention made (`mention_asks`, which the Diary area
    owns): read off the diary's conversations by mention-asks'
    `mentionTasksOf`. `asker` is their first name; `day` is the ask's. */
export type MentionTask = { taskId: string; noteId: string; asker: string; day: string };

export type ListCaps = {
  /** `assets_all` — the register, where a vehicle's papers are renewed. */
  assetsAll: boolean;
  /** `workboard_manage` — placing a visit on a day. */
  placeVisits: boolean;
  /** `workboard_money` — a won job's value. */
  money: boolean;
  /** The workspace holds a ServiceM8 copy. Without one there are no won
      jobs, no money and no Create job: the list runs on HeyTiff's own data. */
  sm8: boolean;
};

export type ListInput = {
  day: string;
  /** The workspace's zone, for a task's hour and the day it was added. */
  tz: string | null;
  warnDays: number;
  viewerStaffId: string | null;
  /** Staff id → first name, for "From Callum". */
  names: Readonly<Record<string, string>>;
  tasks: readonly DashTask[];
  journal: readonly JournalEntry[];
  chips: readonly ActionChip[];
  issues: readonly HomeIssue[];
  wins: readonly WonJob[];
  visits: readonly VisitToBook[];
  caps: ListCaps;
  mentions?: readonly MentionTask[];
};

/* ── words ── */

const fmt = fmtAuWeekdayDayMonth;

/** "4:30 pm" — the journal's own style, built from minutes so no locale's
    spacing can creep in. */
function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

const DETAIL_MAX = 60;

/** Staff id → first name: "From Callum", not "From Callum Reid". The list's
    reads say names by it (home-list-query), and the diary says the people
    its tasks are on by the same rule (desk-data). */
export function firstNames(names: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, name] of names) {
    const first = name.trim().split(/\s+/)[0];
    if (first) out[id] = first;
  }
  return out;
}

/** The first sentence of a task's detail, cut at 60 characters. */
export function firstSentence(detail: string | null): string {
  const flat = (detail ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  const s = m ? m[1] : flat;
  if (s.length > DETAIL_MAX) return `${s.slice(0, DETAIL_MAX - 1).trimEnd()}…`;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

const firstNameOf = (name: string | null | undefined): string =>
  (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The day a timestamp fell on in the workspace. */
function dayOf(stamp: string, tz: string | null): string {
  return zonedParts(stamp, tz)?.day ?? stamp.slice(0, 10);
}

/** "Job 3323, Randwick" — its number and where. */
function jobTitle(job: AllJobsMirrorJob): string {
  const place = job.suburb?.trim() || job.clientName?.trim() || null;
  if (job.jobNumber) return place ? `Job ${job.jobNumber}, ${place}` : `Job ${job.jobNumber}`;
  return place ?? "A won job";
}

/** "3050 Oatley" — the same, said in passing. */
function jobShort(job: AllJobsMirrorJob): string {
  const place = job.suburb?.trim() || job.clientName?.trim() || null;
  return [job.jobNumber, place].filter(Boolean).join(" ") || "job";
}

/** "Bayview Apartments, annual service". */
function visitTitle(v: VisitToBook): string {
  const client = v.clientName?.trim() || null;
  const label = v.label?.trim() || null;
  if (client && label) return `${client}, ${label}`;
  return client ?? label ?? "A service visit";
}

/** Whole dollars — a list glances, it doesn't reconcile. */
function jobFigure(job: AllJobsMirrorJob, caps: ListCaps): string | null {
  const cents = job.money?.valueCents;
  if (!caps.money || cents == null) return null;
  return fmtAud(Math.round(cents / 100) * 100);
}

const PAPER: Partial<Record<ChipKind, string>> = { rego: "Rego", insurance: "Insurance", ctp: "Green slip" };

/** What a chip is, said in passing: "Trailer rego", "your White Card",
    "public liability". A business paper's first word is lowered only when it
    is an ordinary capitalised word, so "ARC authorisation" keeps its capitals. */
function chipShort(chip: ActionChip): string {
  const ref = chip.ref;
  if (!ref) return chip.subject;
  switch (ref.kind) {
    case "vehicle":
      return `${chip.subject} ${chip.kind === "service" ? "service" : (PAPER[chip.kind] ?? "").toLowerCase()}`.trim();
    case "self":
      return `your ${ref.name}`;
    case "staff":
      return `${firstNameOf(chip.subject)}'s ${ref.name}`;
    case "org-credential":
      return /^[A-Z][a-z]/.test(ref.name) ? ref.name[0].toLowerCase() + ref.name.slice(1) : ref.name;
  }
}

function chipTitle(chip: ActionChip): string {
  const ref = chip.ref;
  if (!ref) return chip.subject;
  switch (ref.kind) {
    case "vehicle":
      return ref.name;
    case "self":
      return `Your ${ref.name}`;
    case "staff":
      return `${ref.name}, ${chip.subject}`;
    case "org-credential":
      return ref.name;
  }
}

function chipSub(chip: ActionChip, when: ExpiryWhen, due: string | null): string {
  const on = due ? fmt(due) : "";
  const ref = chip.ref;
  if (ref?.kind === "vehicle" && chip.kind === "service") {
    if (ref.kmLeft != null)
      return ref.kmLeft < 0 ? `Service overdue ${fmtKm(-ref.kmLeft)} km.` : `Service due in ${fmtKm(ref.kmLeft)} km.`;
    return when === "late" ? `Service was due ${on}.` : when === "today" ? "Service due today." : `Service due ${on}.`;
  }
  // a vehicle's paper names itself; a person's or the business's is the title
  const paper = PAPER[chip.kind];
  const ran = paper ? `${paper} ran` : "Ran";
  const runs = paper ? `${paper} runs` : "Runs";
  const base = when === "late" ? `${ran} out ${on}.` : when === "today" ? `${runs} out today.` : `${runs} out ${on}.`;
  return ref?.kind === "org-credential" && ref.issuer ? `${base} ${ref.issuer}.` : base;
}

/* ── doors ── */

const enc = encodeURIComponent;

function chipDoor(chip: ActionChip, caps: ListCaps): Door {
  const ref = chip.ref;
  const sec = chip.kind === "work-rights" ? "workrights" : "licences";
  if (!ref) return { to: "href", href: chip.href };
  switch (ref.kind) {
    case "vehicle":
      /* The register's card for anyone who holds the register; your own van
         on My vehicle for anyone who doesn't. */
      return caps.assetsAll
        ? { to: "href", href: `/dashboard/assets?v=${enc(ref.id)}` }
        : { to: "href", href: chip.href };
    case "self":
      return { to: "href", href: `/dashboard/profile?sec=${sec}` };
    case "staff":
      return { to: "href", href: `/dashboard/team/${enc(ref.id)}?sec=${sec}` };
    case "org-credential":
      return { to: "href", href: "/dashboard/admin/organization?sec=credentials" };
  }
}

/** Renew and Log service land on the vehicle card's own screen, and only for
    someone who holds the register — without it a renewal cannot be recorded.
    A person's paper and the business's carry no verb: it would land exactly
    where the row does. */
function chipVerb(chip: ActionChip, caps: ListCaps): Verb | null {
  const ref = chip.ref;
  if (ref?.kind !== "vehicle" || !caps.assetsAll) return null;
  const at = `/dashboard/assets?v=${enc(ref.id)}`;
  if (chip.kind === "service") return { label: "Log service", door: { to: "href", href: `${at}&screen=add:service` } };
  if (chip.kind === "rego" || chip.kind === "insurance" || chip.kind === "ctp")
    return { label: "Renew", door: { to: "href", href: `${at}&screen=${chip.kind}` } };
  return null;
}

/* ── placement ── */

/* Order inside a group: tasks, then alerts — expiries, visits, jobs — then
   issues, then roll-ups (in the same kind order among themselves). */
const RANK = { task: 0, expiry: 1, visit: 2, job: 3, issue: 4, rollup: 5 } as const;
type Placed = { rank: number; row: ListRow };

const byDueThenNewest = (a: DashTask, b: DashTask): number => {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
};

/** Where one chip goes, or null for a chip the list doesn't carry. */
function chipWhen(chip: ActionChip, day: string, warnDays: number): { when: ExpiryWhen; due: string | null } | null {
  if (!LIST_CHIP_KINDS.includes(chip.kind)) return null;
  if (chip.due) return whenDue(chip.due, day, warnDays);
  /* A service judged by the odometer has no day. Its state is all there is:
     past the distance is late, inside the warning distance is coming up. */
  if (chip.kind === "service" && chip.ref?.kind === "vehicle" && chip.ref.kmLeft != null)
    return { when: chip.state === "bad" ? "late" : "soon", due: null };
  return null;
}

/** The first of each, by key, in the order given — yours before the team's. */
function onceEach<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function countOf(rows: readonly ListRow[]): number {
  return rows.reduce((n, r) => n + (r.kind === "rollup" ? r.count : 1), 0);
}

/** "Trailer rego, Hilux service, public liability." / "…, and 2 more." */
function namesThree(parts: readonly string[]): string {
  const shown = parts.slice(0, 3).join(", ");
  const more = parts.length - 3;
  const said = more > 0 ? `${shown}, and ${more} more.` : `${shown}.`;
  return said.charAt(0).toUpperCase() + said.slice(1);
}

export function placeList(input: ListInput): HomeList {
  const { day, tz, warnDays, viewerStaffId, names, journal, caps } = input;
  const groups: Record<ListGroupKey, Placed[]> = { late: [], today: [], tobook: [], nodate: [], later: [] };
  const put = (key: ListGroupKey, rank: number, row: ListRow) => groups[key].push({ rank, row });

  /* ── tasks: yours and the team's, once each ── */
  const mentionOf = new Map((input.mentions ?? []).map((m) => [m.taskId, m]));
  const tasks = onceEach(input.tasks, (t) => t.id)
    .filter((t) => t.status === "open")
    .sort(byDueThenNewest);
  for (const t of tasks) {
    const key: ListGroupKey = !t.dueDate
      ? "nodate"
      : t.dueDate < day
        ? "late"
        : t.dueDate === day
          ? "today"
          : "later";
    const mention = mentionOf.get(t.id) ?? null;
    const entry = mention ? null : entryForTask(journal, t.id);
    const door: Door = mention
      ? { to: "mention", id: mention.noteId }
      : entry
        ? { to: "entry", id: entry.id }
        : { to: "task", id: t.id };

    let sub: string;
    const at = key === "today" ? zonedParts(t.remindAt, tz) : null;
    if (key === "late" || key === "later") {
      const said = firstSentence(t.detail);
      sub = said ? `Due ${fmt(t.dueDate)}. ${said}` : `Due ${fmt(t.dueDate)}.`;
    } else if (at && at.day === day) {
      sub = `${t.remindKind === "by" ? "By" : "At"} ${clock(at.min)}.`;
    } else if (mention) {
      /* the ask was yours; a task given to someone else since is theirs,
         and "asked you" beside their name would say it was theirs to do */
      const yours = viewerStaffId !== null && t.assigneeId === viewerStaffId;
      sub = `${mention.asker} asked${yours ? " you" : ""}, ${fmt(mention.day)}.`;
    } else if (entry) {
      sub = `Your diary, ${fmt(entry.day)}.`;
    } else {
      const added = fmt(dayOf(t.createdAt, tz));
      const from =
        t.createdBy && t.createdBy !== t.assigneeId && t.createdBy !== viewerStaffId
          ? names[t.createdBy] || null
          : null;
      sub = from ? `From ${from}, ${added}.` : `Added ${added}.`;
    }

    put(key, RANK.task, {
      kind: "task",
      id: t.id,
      title: t.title,
      who: viewerStaffId !== null && t.assigneeId === viewerStaffId ? null : firstNameOf(t.assigneeName) || null,
      sub,
      tone: key === "late" ? "late" : "",
      door,
    });
  }

  /* ── the bell's dated chips ── */
  const dated = onceEach(input.chips, (c) => c.key)
    .map((chip) => ({ chip, at: chipWhen(chip, day, warnDays) }))
    .filter((c): c is { chip: ActionChip; at: { when: ExpiryWhen; due: string | null } } => c.at !== null)
    // oldest first; a distance with no day after the dated ones, worst first
    .sort((a, b) => (a.at.due ?? "9999").localeCompare(b.at.due ?? "9999") || a.chip.urgency - b.chip.urgency);
  const chipRow = (chip: ActionChip, when: ExpiryWhen, due: string | null): ListAlertRow => ({
    kind: "alert",
    id: `chip:${chip.key}`,
    title: chipTitle(chip),
    sub: chipSub(chip, when, due),
    tone: when === "late" ? "late" : "",
    dot: when === "late" ? "late" : when === "today" ? "today" : "quiet",
    figure: null,
    door: chipDoor(chip, caps),
    verb: chipVerb(chip, caps),
  });
  const coming: { chip: ActionChip; row: ListAlertRow }[] = [];
  for (const { chip, at } of dated) {
    const row = chipRow(chip, at.when, at.due);
    if (at.when === "soon") coming.push({ chip, row });
    else put(at.when, RANK.expiry, row);
  }

  /* ── visits with no day ── */
  const visits = [...input.visits].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const visitsToBook: { v: VisitToBook; row: ListAlertRow }[] = [];
  for (const v of visits) {
    const d = daysUntil(v.dueDate, day);
    if (d > VISIT_WINDOW_DAYS) continue;
    const row: ListAlertRow = {
      kind: "alert",
      id: `visit:${v.id}`,
      title: visitTitle(v),
      sub: d < 0 ? `Was due ${fmt(v.dueDate)}. No day yet.` : d === 0 ? "Due today. No day yet." : `Due ${fmt(v.dueDate)}. No day yet.`,
      tone: d < 0 ? "late" : "",
      dot: d < 0 ? "late" : d === 0 ? "today" : "quiet",
      figure: null,
      door: { to: "href", href: `/dashboard/workboard?visit=${enc(v.id)}` },
      // a booking stays a visit, and placing one is the board's manage grant
      verb: caps.placeVisits ? { label: "Book in", placeVisit: v.id } : null,
    };
    if (d < 0) put("late", RANK.visit, row);
    else if (d === 0) put("today", RANK.visit, row);
    else visitsToBook.push({ v, row });
  }

  /* ── won jobs never booked ── */
  const wins = (caps.sm8 ? input.wins : [])
    .map((w) => ({ ...w, age: Math.max(0, -daysUntil(w.wonOn.slice(0, 10), day)) }))
    .filter((w) => w.age <= WON_WINDOW_DAYS)
    .sort((a, b) => b.age - a.age || (a.job.jobNumber ?? "").localeCompare(b.job.jobNumber ?? ""));
  const jobRow = (w: (typeof wins)[number], fresh: boolean): ListAlertRow => ({
    kind: "alert",
    id: `job:${w.job.remoteId}`,
    title: jobTitle(w.job),
    sub: fresh ? `Won ${agoLabel(w.age)}. No day yet.` : `Won ${agoLabel(w.age)}.`,
    tone: "",
    dot: fresh ? "today" : "quiet",
    figure: jobFigure(w.job, caps),
    door: { to: "job", remoteId: w.job.remoteId },
    verb: { label: "Book in", door: { to: "href", href: `/dashboard/workboard?job=${enc(w.job.remoteId)}` } },
  });
  const freshWins = wins.filter((w) => w.age <= FRESH_WIN_DAYS);
  const olderWins = wins.filter((w) => w.age > FRESH_WIN_DAYS);
  // newest first under Today: the one won this morning is the one to book
  for (const w of [...freshWins].reverse()) put("today", RANK.job, jobRow(w, true));

  /* ── open issues ── */
  for (const issue of input.issues) {
    const today = issue.lastSeen === day;
    const sub = today
      ? issue.firstSeen === day
        ? "New today."
        : "Seen again today."
      : issue.occurrences > 1
        ? `Open since ${fmt(issue.firstSeen)}. Seen ${issue.occurrences} times.`
        : `Open since ${fmt(issue.firstSeen)}.`;
    put(today ? "today" : "later", RANK.issue, {
      kind: "issue",
      id: `issue:${issue.id}`,
      issue,
      title: issue.summary,
      sub,
      dot: today ? "today" : "quiet",
      entryId: entryForDoor(journal, "issue", issue.id)?.id ?? null,
      /* Before ServiceM8 can be written a job to, Create job opens the job the
         issue is on; it is offered only where that job is ServiceM8's. */
      verb:
        caps.sm8 && issue.targetKind === "job" && issue.targetId
          ? { label: "Create job", door: { to: "job", remoteId: issue.targetId } }
          : null,
    });
  }

  /* ── roll-ups ── */
  if (coming.length) {
    put("later", RANK.rollup + 0.1, {
      kind: "rollup",
      id: "rollup:coming",
      title: `${coming.length} coming up`,
      sub: namesThree(coming.map((c) => chipShort(c.chip))),
      strong: null,
      verb: null,
      rows: coming.map((c) => c.row),
      count: coming.length,
    });
  }
  if (visitsToBook.length) {
    const n = visitsToBook.length;
    const soonest = visitsToBook[0].v;
    put("tobook", RANK.rollup + 0.2, {
      kind: "rollup",
      id: "rollup:visits",
      title: `${n} ${n === 1 ? "service" : "services"} due with no day`,
      // the client alone: "Soonest Bayview Apartments, due Mon 5 Oct."
      sub: `Soonest ${soonest.clientName?.trim() || visitTitle(soonest)}, due ${fmt(soonest.dueDate)}.`,
      strong: null,
      verb: null,
      rows: visitsToBook.map((x) => x.row),
      count: n,
    });
  }
  if (olderWins.length) {
    const n = olderWins.length;
    const oldest = olderWins[0];
    const short = jobShort(oldest.job);
    put("tobook", RANK.rollup + 0.3, {
      kind: "rollup",
      id: "rollup:wins",
      title: `${n}${freshWins.length ? " more" : ""} won ${n === 1 ? "job" : "jobs"} with no day`,
      sub: `Oldest ${short}, won ${agoLabel(oldest.age)}.`,
      strong: short,
      verb: { label: "Book", door: { to: "href", href: "/dashboard/workboard" } },
      rows: olderWins.map((w) => jobRow(w, false)),
      count: n,
    });
  }

  const out: ListGroup[] = [];
  for (const key of GROUP_ORDER) {
    // stable: each kind was pushed already in its own order
    const rows = groups[key].sort((a, b) => a.rank - b.rank).map((p) => p.row);
    if (rows.length) out.push({ key, title: GROUP_TITLE[key], count: countOf(rows), rows });
  }
  return { day, groups: out, jobs: wins.map((w) => w.job) };
}

/** The things the list has a row for, by the id a door between faces names
    them with — a task's id, an issue's, an alert's and a roll-up's own, and
    what a roll-up holds — the same ids its rows carry as `data-thing`. A
    door from the diary lights these rows where the list has them, and
    opens the Tasks tab for a thing the list does not hold (a task already
    ticked off). */
export function thingsOnList(list: HomeList): Set<string> {
  const out = new Set<string>();
  const walk = (rows: readonly ListRow[]) => {
    for (const r of rows) {
      out.add(r.kind === "issue" ? r.issue.id : r.id);
      if (r.kind === "rollup") walk(r.rows);
    }
  };
  for (const g of list.groups) walk(g.rows);
  return out;
}

/* ── the list, from the page's data ── */

/** What `loadHomeList` reads for the list, beyond what the page already has. */
export type HomeListReads = {
  day: string;
  tz: string | null;
  warnDays: number;
  caps: ListCaps;
  names: Record<string, string>;
  wins: WonJob[];
  visits: VisitToBook[];
};

/** What the page already loads for today's Home, which the list places too.
    `DashboardData` is one of these as it stands. */
export type HomeListBase = {
  viewerStaffId: string | null;
  tasks: { mine: readonly DashTask[]; team: readonly DashTask[] | null };
  chips: { self: readonly ActionChip[]; team: readonly ActionChip[] };
  issues: readonly HomeIssue[];
  journal: readonly JournalEntry[];
  mentions?: readonly MentionTask[];
};

/** The list, from its own reads and the page's. Pure, so it can run wherever
    the frame holds both — the words were dated on the server by `day`. */
export function placeHomeList(reads: HomeListReads, base: HomeListBase): HomeList {
  return placeList({
    day: reads.day,
    tz: reads.tz,
    warnDays: reads.warnDays,
    caps: reads.caps,
    names: reads.names,
    wins: reads.wins,
    visits: reads.visits,
    viewerStaffId: base.viewerStaffId,
    tasks: [...base.tasks.mine, ...(base.tasks.team ?? [])],
    chips: [...base.chips.self, ...base.chips.team],
    issues: base.issues,
    journal: base.journal,
    mentions: base.mentions,
  });
}
