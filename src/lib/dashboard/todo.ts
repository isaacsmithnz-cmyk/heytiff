/* HOME › TO DO (v2, docs/design.md rule 39; decisions 25 and 28) — the
   pure half: what is waiting on you, one row each, and the one button on
   the right that does the thing.

   It gathers what had three doors today, and adds no source of its own:

     the bell        every alert it carried (`chips`: expiries, queues to
                     decide, a timesheet sent back, a SWMS to sign, files
                     stuck on the way to ServiceM8), the reminders that have
                     come due (Later), and work somebody gave you that you
                     haven't answered for (Got it). Decision 25: the bell
                     goes, so To do is now their only door.
     the list        Home's old right-hand list (`placeHomeList`): your
                     tasks late or due today, the ServiceM8 asks that made
                     a task for you, won jobs never booked, services with
                     no day, leftover bookings, open issues.
     notices         a notice you haven't read, until you do (decision 28).
     timesheets      sheets sent in and waiting on an approver (F-178).
     emails          an email you forwarded to Tiff that she has read into
                     a job, until you make it, file it or say it isn't one
                     (28 October 2026: the bell is gone, so this is its door).

   A row says its state with a dot (rule 17): red for wrong or late, orange
   for needs a look, grey for your information. Wrong first, then a look,
   then for your information; inside each, the order below.

   A task you can finish leads with a tick (rule 39); its button is the
   other thing you'd do (Later on a reminder, Got it on new work, Open or
   Reply on the rest). Everything else is one button, a door.

   THE SIDEBAR'S COUNT is the bell's: what came to you (the alerts, the
   reminders due, new work and unread notices), not the work rows the list
   adds, which the bell never counted (`bellCount`). Decision 25 moves the
   bell's count, and the board draws it smaller than To do's (3 and 9). */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { recordHref } from "@/lib/records/ref";
import { jobPageHref, projectHref, visitHref } from "@/lib/shell/links";
import type { HomeIssue } from "./issues";
import { assignmentLine, assignmentsNotAlreadyDue, type NewAssignment } from "./assignments";
import { LIST_CHIP_KINDS, type Dot, type HomeList, type ListAlertRow, type ListRow } from "./home-list";
import type { ActionChip, ChipKind } from "./chips";

export type TodoTone = "wrong" | "look" | "info";

/** The one button on the right. A link goes to the record; Later and Got
    it act on a task where you are; Book in opens the Visit form over Home
    with the job filled in (rule 52), and the row itself still opens the
    job's Visits. */
export type TodoAct =
  | { kind: "link"; label: string; href: string }
  | { kind: "later"; taskId: string }
  | { kind: "gotit"; taskId: string }
  | { kind: "bookIn"; label: "Book in"; jobUuid: string; href: string }
  /** a task's Open: its own form over Home (Isaac, 24 October 2026), never the old desk */
  | { kind: "task"; label: "Open"; taskId: string }
  /** a field issue with nothing to open: Make it a task, or Done, in Your feed */
  | { kind: "issue"; issueId: string; title: string };

export type TodoSource = "reminder" | "assignment" | "alert" | "list" | "timesheets" | "notice" | "email";

/** Which of Home's three columns a row stands in (Isaac, 20 October): Today
    is only what has a time ("anything with a specific time can go on today.
    We'll use that as a schedule"): a booking, a task with an hour, a
    reminder. Everything due but untimed (a rego running out, a job to book,
    a task due today) is To do's, the most urgent at the top. Activity, now
    Your feed, is what comes in. */
export type HomeColumn = "today" | "todo" | "activity";

export type TodoRow = {
  key: string;
  source: TodoSource;
  /** Left out, To do. */
  col?: HomeColumn;
  tone: TodoTone;
  name: string;
  line: string;
  /** The line says the trouble, so it wears the dot's colour ("Runs out
      today"); otherwise it is grey. */
  lineTone: boolean;
  /** The task a tick completes, for a row that is one. */
  tick: string | null;
  act: TodoAct;
};

/** A due reminder, with how late it is said on the server (a clock in a
    render body is a hydration trap). */
export type TodoReminder = { taskId: string; title: string; late: string };

/** An email you forwarded to Tiff, read and waiting on you: its subject, the
    day it came in, and the job it's for when she found one. */
export type EmailWaiting = { id: string; subject: string; day: string; forJob: string | null };

/** A notice you haven't read, current and not your own. */
export type UnreadNotice = { id: string; title: string; from: string | null; day: string };

export type TodoExtras = {
  reminders: TodoReminder[];
  assignments: NewAssignment[];
  notices: UnreadNotice[];
  /** Sheets sent in and waiting on an approver; 0 without `approvals`. */
  timesheets: number;
  /** Emails you forwarded to Tiff, read and waiting on you. */
  emails?: EmailWaiting[];
};

export const EMPTY_TODO: TodoExtras = { reminders: [], assignments: [], notices: [], timesheets: 0 };

export type TodoInput = TodoExtras & {
  /** The day a dated alert is due against, ISO; left out, none is Today's. */
  today?: string;
  /** Every alert, yours and the team's, as the bell had them. */
  chips: readonly ActionChip[];
  /** Home's list, placed (`placeHomeList`), or null for nobody signed in. */
  list: HomeList | null;
};

/** How many rows Home shows before Show all. */
export const TODO_HOME_CAP = 6;

const fmt = fmtAuWeekdayDayMonth;
const enc = encodeURIComponent;

/** A mention's Reply: on Home, in Your feed, where it is answered in place (20 October 2026). */
export const deskAskHref = (noteUuid: string) => `/dashboard?reply=${enc(noteUuid)}`;

const toneOfDot = (dot: Dot): TodoTone => (dot === "late" ? "wrong" : dot === "today" ? "look" : "info");

/* ── the bell's alerts the list doesn't carry ── */

/** What the button says for each kind of alert. */
const ALERT_VERB: Readonly<Record<ChipKind, string>> = {
  licence: "Renew",
  "work-rights": "Renew",
  rego: "Renew",
  insurance: "Renew",
  ctp: "Renew",
  service: "Log service",
  "org-insurance": "Renew",
  "org-licence": "Renew",
  expenses: "Review",
  timesheet: "Open",
  claim: "Open",
  "leave-queue": "Review",
  "leave-declined": "Open",
  profile: "Finish",
  swms: "Sign on",
  "swms-issue": "Review",
  "swms-template": "Approve",
  "cert-wording": "Approve",
  "sm8-writes": "Open",
  "sm8-done": "Open",
  "sm8-booking": "Open",
};

/** What comes in to be looked at or approved: Activity's, not To do's. */
const INCOMING: ReadonlySet<ChipKind> = new Set<ChipKind>([
  "expenses",
  "timesheet",
  "claim",
  "leave-queue",
  "leave-declined",
  "swms-issue",
  "swms-template",
  "cert-wording",
  "sm8-writes",
  "sm8-done",
  "sm8-booking",
]);

function alertRow(chip: ActionChip, today?: string): TodoRow {
  return {
    key: `alert:${chip.key}`,
    source: "alert",
    /* due, not timed: To do's (Today is only what has a time, 20 October 2026) */
    col: INCOMING.has(chip.kind) ? "activity" : "todo",
    tone: chip.state === "bad" ? "wrong" : "look",
    name: chip.label,
    line: chip.subject,
    lineTone: false,
    tick: null,
    act: { kind: "link", label: ALERT_VERB[chip.kind], href: chip.href },
  };
}

/* ── the list's rows ── */

/** A list alert's button: its own verb where it has one, else what the
    row is for, landing where the row would. */
function listAlertAct(r: ListAlertRow): TodoAct {
  const v = r.verb;
  if (v && "door" in v && v.door.to === "href") return { kind: "link", label: v.label, href: v.door.href };
  if (v && "placeVisit" in v) return { kind: "link", label: "Book in", href: visitHref(v.placeVisit) };
  if (v && "bookIn" in v) return { kind: "bookIn", label: "Book in", jobUuid: v.bookIn, href: jobPageHref(v.bookIn, "visits") };
  if (v && "clear" in v) return { kind: "link", label: "Clear", href: jobPageHref(v.clear.jobUuid, "visits") };
  if (v && "door" in v && v.door.to === "job") return { kind: "link", label: v.label, href: jobPageHref(v.door.remoteId, "visits") };
  const d = r.door;
  if (d.to === "task") return { kind: "task", label: "Open", taskId: d.id };
  const href =
    d.to === "href" ? d.href : d.to === "job" ? jobPageHref(d.remoteId) : d.to === "mention" ? deskAskHref(d.id) : "/dashboard";
  /* a paper with no verb of its own is renewed where the row lands; a
     service is the vehicle's, opened */
  const paper = r.id.startsWith("chip:") && !/^Service\b/.test(r.sub);
  return { kind: "link", label: paper ? "Renew" : "Open", href };
}

/** Where a field issue opens: what it is about, or null for nothing. */
function issueHref(i: HomeIssue): string | null {
  if (!i.targetId) return null;
  switch (i.targetKind) {
    case "job":
      return jobPageHref(i.targetId);
    case "visit":
      return visitHref(i.targetId);
    case "agreement":
      return recordHref({ kind: "agreement", id: i.targetId });
    case "project":
      return projectHref(i.targetId);
    case "none":
      return null;
  }
}

/** A sentence's full stop goes: a row's line is a phrase. */
const phrase = (s: string) => s.replace(/\.$/, "");

function listRows(list: HomeList): TodoRow[] {
  const out: TodoRow[] = [];
  const walk = (rows: readonly ListRow[], group: string) => {
    for (const r of rows) {
      switch (r.kind) {
        case "task": {
          /* your own, late or due today: a team task is someone else's,
             and later ones wait on the Tasks face */
          if (r.who !== null || (group !== "late" && group !== "today")) break;
          const ask = r.door.to === "mention" ? r.door.id : null;
          out.push({
            key: `task:${r.id}`,
            source: "list",
            col: "todo",
            tone: group === "late" ? "wrong" : "look",
            name: r.title,
            line: phrase(r.sub),
            lineTone: group === "late",
            tick: r.id,
            act: ask
              ? { kind: "link", label: "Reply", href: deskAskHref(ask) }
              : { kind: "task", label: "Open", taskId: r.id },
          });
          break;
        }
        case "alert":
          out.push({
            key: r.id,
            source: "list",
            col: "todo",
            tone: toneOfDot(r.dot),
            name: r.title,
            line: phrase(r.sub),
            lineTone: r.dot !== "quiet",
            tick: null,
            act: listAlertAct(r),
          });
          break;
        case "issue": {
          /* one on a job, a visit, an agreement or a project is To do's and
             opens it; one with none is Your feed's, made a task or done
             there (Isaac, 24 October 2026: the desk's last doors) */
          const href = issueHref(r.issue);
          out.push({
            key: r.id,
            source: "list",
            ...(href ? {} : { col: "activity" as const }),
            tone: toneOfDot(r.dot),
            name: r.title,
            line: phrase(r.sub),
            lineTone: false,
            tick: null,
            act: href
              ? { kind: "link", label: "Open", href }
              : { kind: "issue", issueId: r.issue.id, title: r.issue.summary },
          });
          break;
        }
        case "rollup":
          /* the won jobs stay one row, the board's to book; the rest open
             out, one row a thing */
          if (r.id === "rollup:wins") {
            out.push({
              key: r.id,
              source: "list",
              tone: "look",
              name: r.title.charAt(0).toUpperCase() + r.title.slice(1),
              line: phrase(r.sub),
              lineTone: false,
              tick: null,
              act: { kind: "link", label: "Book", href: "/dashboard/schedule" },
            });
          } else walk(r.rows, group);
          break;
      }
    }
  };
  for (const g of list.groups) walk(g.rows, g.key);
  return out;
}

/* ── the whole list ── */

const TONE_ORDER: Readonly<Record<TodoTone, number>> = { wrong: 0, look: 1, info: 2 };

export function todoRows(input: TodoInput): TodoRow[] {
  const remindIds = input.reminders.map((r) => r.taskId);
  const news = assignmentsNotAlreadyDue(input.assignments, remindIds);
  /* a task with its own row above — due now, or new to you — is that row */
  const ownRow = new Set([...remindIds, ...news.map((a) => a.taskId)]);

  const reminders: TodoRow[] = input.reminders.map((r) => ({
    key: `reminder:${r.taskId}`,
    source: "reminder",
    col: "today",
    tone: "look",
    name: r.title,
    line: `Reminder, ${r.late}`,
    lineTone: false,
    tick: r.taskId,
    act: { kind: "later", taskId: r.taskId },
  }));
  const given: TodoRow[] = news.map((a) => ({
    key: `assignment:${a.taskId}`,
    source: "assignment",
    col: "activity",
    tone: "look",
    name: a.title,
    line: assignmentLine(a, fmt) ?? "Given to you",
    lineTone: false,
    tick: a.taskId,
    act: { kind: "gotit", taskId: a.taskId },
  }));

  /* the list carries the dated expiries in its own words; every other
     alert comes from the bell's list, once each */
  const listed = input.list !== null;
  const seen = new Set<string>();
  const alerts: TodoRow[] = [];
  for (const chip of [...input.chips].sort((a, b) => a.urgency - b.urgency)) {
    if (seen.has(chip.key)) continue;
    seen.add(chip.key);
    if (listed && LIST_CHIP_KINDS.includes(chip.kind)) continue;
    alerts.push(alertRow(chip, input.today));
  }

  const list = input.list ? listRows(input.list).filter((r) => r.tick === null || !ownRow.has(r.tick)) : [];

  const timesheets: TodoRow[] =
    input.timesheets > 0
      ? [
          {
            key: "timesheets",
            source: "timesheets",
            col: "activity",
            tone: "look",
            name: "Timesheets",
            line: `${input.timesheets} to approve`,
            lineTone: false,
            tick: null,
            act: { kind: "link", label: "Review", href: "/dashboard/team?view=timesheets" },
          },
        ]
      : [];

  const notices: TodoRow[] = input.notices.map((n) => ({
    key: `notice:${n.id}`,
    source: "notice",
    col: "activity",
    tone: "info",
    name: n.title,
    line: n.from ? `A notice from ${n.from}, ${fmt(n.day)}` : `A notice, ${fmt(n.day)}`,
    lineTone: false,
    tick: null,
    act: { kind: "link", label: "Open", href: "/dashboard/team?view=notices" },
  }));

  const emails: TodoRow[] = (input.emails ?? []).map((e) => ({
    key: `email:${e.id}`,
    source: "email",
    col: "activity",
    tone: "look",
    name: e.subject,
    line: e.forJob ? `Tiff read your email: it's for job ${e.forJob}` : "Tiff read your email: a new job",
    lineTone: false,
    tick: null,
    act: { kind: "link", label: "Open", href: `/dashboard/conversations?open=email-${e.id}` },
  }));

  const all = [...reminders, ...given, ...alerts, ...list, ...timesheets, ...notices, ...emails];
  /* stable: each source is already in its own order */
  return all
    .map((row, i) => ({ row, i }))
    .sort((a, b) => TONE_ORDER[a.row.tone] - TONE_ORDER[b.row.tone] || a.i - b.i)
    .map((x) => x.row);
}

/** The sidebar's count beside Home: what the bell counted (every alert,
    the reminders due and the new work not already due), and the notices
    you haven't read (decision 28). */
export function bellCount(input: {
  chips: readonly { key: string }[];
  reminders: readonly { taskId: string }[];
  assignments: readonly NewAssignment[];
  notices: readonly unknown[];
  emails?: readonly unknown[];
}): number {
  const alerts = new Set(input.chips.map((c) => c.key)).size;
  const news = assignmentsNotAlreadyDue(
    input.assignments,
    input.reminders.map((r) => r.taskId),
  ).length;
  return alerts + input.reminders.length + news + input.notices.length + (input.emails?.length ?? 0);
}

/** A row's column on Home. */
export const columnOf = (row: TodoRow): HomeColumn => row.col ?? "todo";
