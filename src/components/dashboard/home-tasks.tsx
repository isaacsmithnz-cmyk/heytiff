"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { NoteToken } from "@/components/notes/note-token";
import {
  completeTask,
  createTask,
  deleteTask,
  reopenTask,
  resolveIssue,
  setTaskDue,
} from "@/app/actions/dashboard";
import { dueLabel, sortTasks, type DashTask } from "@/lib/dashboard/tasks";
import { entryForDoor, type JournalEntry } from "@/lib/dashboard/journal";
import { issueSeen, type HomeIssue } from "@/lib/dashboard/issues";
import { zonedParts } from "@/lib/dashboard/day-rail";
import { clockLabel } from "@/lib/workboard/schedule";
import { auDayOf, daysUntil, fmtAuDayMonth, fmtAuWeekdayDayMonth } from "@/lib/au-dates";

/* THE TASKS — the work you owe, the work you handed out, and what keeps
   going wrong.

   A LIST BESIDE A PAGE (the three-room handoff, 2026-09-14). The list is
   four groups in the order they want you — Overdue, Open, Issues, Done — with
   a real checkbox leading every task row, because ticking is the whole
   interaction. The chosen row is read in full beside it: its state in a
   word, the facts, the words it came from, and the things you can do to it.

   THE GROUPS ARE THE BADGE'S OWN TEST. A task is overdue when its date is
   before today, which is exactly how the rail's red count is made; two
   places that must agree use the one comparison. Yours and the team's share
   the groups (the team's arrive only with `team`), and the assignee says
   whose each is. Done holds your own recent completions, which reverse with
   the same checkbox, and the work you handed out that came back finished.

   ISSUES ARE NOT TASKS (2026-09-15). An issue is the "this keeps happening"
   row a debrief writes: no assignee, no date, nothing to tick — a fact about
   a site that stays true until somebody says it is not. So it is its own
   group, its slot holds a dot instead of a checkbox, and its one action is
   "Mark resolved". It arrives only with the workboard, like the jobs.

   A ROW KNOWS THE NOTE IT CAME FROM without asking for it. The diary is
   already in the page's hands and every entry records the tasks and issues
   it made, so the source is found by looking, and "Open in diary" is a move
   within the card rather than a page. A task typed straight in has no note
   and says nothing about one.

   THE COMPOSER IS THE SAME DOOR AS THE DIARY'S — `NoteToken`, saying "Add a
   task…" here — so a spoken "Luke to order grilles by Friday" is read by the
   same router that files a note. "Assign a task", the form with a person and
   a date on it, stays for anyone who may assign, under the composer. */

type Row =
  | { kind: "task"; id: string; task: DashTask }
  | { kind: "issue"; id: string; issue: HomeIssue };

function Confirm({
  pending,
  onGo,
  onKeep,
}: {
  pending: boolean;
  onGo: () => void;
  onKeep: () => void;
}) {
  /* Deleting has no undo — unlike completing, there is no row left to reopen —
     so the button never fires the action itself: it swaps into a confirm.
     Focus lands on Keep, so Enter twice backs out rather than deletes. */
  return (
    <span className="hm-confirm">
      <span>Delete for good?</span>
      <button className="hm-btn text del" type="button" disabled={pending} onClick={onGo}>
        Delete
      </button>
      <button className="hm-btn" type="button" disabled={pending} onClick={onKeep} autoFocus>
        Keep
      </button>
    </span>
  );
}

/* "Done today" / "Done 22 July". `today` is an AU calendar date, so the
   completion has to resolve to one too — reading done_at's day in UTC puts
   anything finished before ~10am AEST on the previous date. */
export function doneLabel(iso: string, today: string): string {
  const day = auDayOf(iso);
  return day === today ? "Done today" : `Done ${fmtAuDayMonth(day)}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function HomeTasks({
  today,
  mine,
  team,
  done,
  reported,
  issues = [],
  viewerStaffId,
  canManage,
  assignable,
  journal = [],
  tz = null,
  onOpenEntry,
  focusTaskId = null,
  onFocusHandled,
}: {
  today: string;
  mine: DashTask[];
  team: DashTask[] | null;
  done: DashTask[];
  reported: DashTask[];
  /** The workspace's open issues; empty without the workboard. */
  issues?: HomeIssue[];
  viewerStaffId: string | null;
  canManage: boolean;
  assignable: { id: string; name: string }[];
  /** The diary, already loaded — where a row's words are found. */
  journal?: JournalEntry[];
  /** The workspace's zone, for reading a reminder's clock time. */
  tz?: string | null;
  /** Given by Home: switches to the Diary face on that entry. */
  onOpenEntry?: (id: string) => void;
  /** A row named by a diary door — a task's id or an issue's: choose it,
      scroll to it and mark it, once. */
  focusTaskId?: string | null;
  onFocusHandled?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  /* Which focus request has already burned out. The mark itself is DERIVED
     from that rather than stored: a row is marked because a door named it
     and its moment hasn't passed. */
  const [spentFocus, setSpentFocus] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState<string | null>(null);

  const [assignedTo, setAssignedTo] = useState(assignable[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");

  /* ARRIVING FROM A DIARY DOOR chooses the row it named. Answered in render
     (the sanctioned adjust-during-render idiom) rather than in an effect, so
     the pane shows the right row in the same paint as the face. */
  if (focusTaskId && focusTaskId !== seenFocus) {
    setSeenFocus(focusTaskId);
    setSelId(focusTaskId);
    setConfirm(false);
  }

  // the team's open work is everyone else's — yours is already in `mine`
  const others = (team ?? []).filter((t) => t.assigneeId !== viewerStaffId);
  const past = (t: DashTask) => t.dueDate !== null && t.dueDate < today;
  const openAll = sortTasks([...mine, ...others]);
  const asRow = (t: DashTask): Row => ({ kind: "task", id: t.id, task: t });
  const overdue = openAll.filter(past).map(asRow);
  const openRows = openAll.filter((t) => !past(t)).map(asRow);
  const issueRows: Row[] = issues.map((i) => ({ kind: "issue", id: i.id, issue: i }));
  /* Yours first (they reverse), then what came back to you. */
  const doneRows = [...done, ...reported].map(asRow);
  const all = [...overdue, ...openRows, ...issueRows, ...doneRows];
  const sel = all.find((r) => r.id === selId) ?? all[0] ?? null;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const markDone = (id: string) => run(() => completeTask(id));
  const undo = (id: string) => run(() => reopenTask(id));

  /* THE FLASH. The face was just revealed, so the row is somewhere in a list
     the reader has never scrolled — bring it to the middle and mark it for a
     moment, then hand the focus back so pressing the same door a second
     time works. The row is found in the DOM by `data-task-id`: which group
     holds it is the server's answer, not this component's. */
  const flashId = focusTaskId && focusTaskId !== spentFocus ? focusTaskId : null;
  useEffect(() => {
    if (!focusTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${focusTaskId}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => {
      setSpentFocus(focusTaskId);
      onFocusHandled?.();
    }, 1800);
    return () => {
      clearTimeout(t);
      setSpentFocus(null);
    };
  }, [focusTaskId, onFocusHandled]);

  /* Who may delete mirrors deleteTask's own rule: the creator, or a manager.
     The action re-decides regardless. Guarded on viewerStaffId so a viewer
     with no staff record never reads an ownerless task (createdBy null) as
     theirs — null === null must not grant the control. */
  const mayDelete = (t: DashTask) =>
    canManage || (!!viewerStaffId && t.createdBy === viewerStaffId);
  /* The assignee alone may finish, reopen and move it; the creator too. */
  const isOwn = (t: DashTask) =>
    !!viewerStaffId && (t.assigneeId === viewerStaffId || t.createdBy === viewerStaffId);
  const who = (t: DashTask) => (t.assigneeId === viewerStaffId ? "You" : t.assigneeName);
  /* Someone else's completion of work you handed out: no control, a tick. */
  const isReported = (t: DashTask) => reported.some((r) => r.id === t.id);

  const assign = () =>
    run(
      () =>
        createTask({
          assignedTo,
          title,
          detail: detail || undefined,
          dueDate: dueDate || undefined,
        }),
      () => {
        setTitle("");
        setDetail("");
        setDueDate("");
        setOpen(false);
      },
    );

  const select = (id: string) => {
    setSelId(id);
    setConfirm(false);
  };

  /* One line under a title: who, and when — a label and a value, in words. */
  const meta = (t: DashTask) => {
    if (t.status === "done") {
      const by = isReported(t) ? (t.doneByName ?? t.assigneeName) : who(t);
      return (
        <>
          {by},{" "}
          <span className="ok">{t.doneAt ? lower(doneLabel(t.doneAt, today)) : "done"}</span>
        </>
      );
    }
    if (past(t)) {
      const late = -daysUntil(t.dueDate!, today);
      return (
        <>
          {who(t)},{" "}
          <span className="bad">
            due {fmtAuDayMonth(t.dueDate)}, {late} {late === 1 ? "day" : "days"} late
          </span>
        </>
      );
    }
    const due = dueLabel(t.dueDate, today);
    if (!due) return <>{who(t)}, no due date</>;
    return (
      <>
        {who(t)},{" "}
        <span className={due.state === "warn" ? "warn" : undefined}>{lower(due.label)}</span>
      </>
    );
  };

  /* An issue's line: where it is, then how often. Two sentences, because
     "where" already carries a comma of its own. */
  const issueMeta = (i: HomeIssue) =>
    `${i.where ?? "Not on a job"}. Seen ${issueSeen(i.occurrences)}, last ${fmtAuDayMonth(i.lastSeen)}.`;

  const groups: [string, Row[]][] = [
    ["Overdue", overdue],
    ["Open", openRows],
    ["Issues", issueRows],
    ["Done", doneRows],
  ];
  const openCount = overdue.length + openRows.length;
  const counts = [
    `${openCount} open`,
    ...(issueRows.length > 0 ? [`${issueRows.length} ${issueRows.length === 1 ? "issue" : "issues"}`] : []),
    `${doneRows.length} done`,
  ].join(", ");

  const src = sel ? entryForDoor(journal, sel.kind, sel.id) : null;
  const remind = sel?.kind === "task" && sel.task.remindAt ? zonedParts(sel.task.remindAt, tz) : null;

  return (
    <>
      <div className="hm-list">
        <div className="hm-lhead">
          <div className="hm-lt">
            <h2>Tasks</h2>
            <span className="hm-lc">{counts}</span>
          </div>
          <NoteToken as="entry" placeholder="Add a task…" />
          {canManage && (
            <button
              className="hm-link"
              type="button"
              disabled={pending}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              Assign a task
            </button>
          )}
        </div>

        {error && <div className="tp-err">{error}</div>}

        {canManage && open && (
          <div className="lv-form hm-assign">
            <div className="lv-frow">
              <label className="mts-f">
                <span>Assign to</span>
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  {assignable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mts-f" style={{ flex: 2 }}>
                <span>Task</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Renew the WHS induction"
                />
              </label>
              <label className="mts-f">
                <span>Due (optional)</span>
                <DateField
                  value={dueDate || null}
                  today={today}
                  clearable
                  placeholder="No date"
                  onChange={(iso) => setDueDate(iso ?? "")}
                />
              </label>
            </div>
            <div className="lv-fnote">
              <label className="mts-f" style={{ flex: 1 }}>
                <span>Detail (optional)</span>
                <input
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Anything they need to know"
                />
              </label>
            </div>
            <div className="lv-fmeta">
              <span />
              <div className="mts-facts">
                <button
                  className="fl-btn primary"
                  disabled={pending || !title.trim() || !assignedTo}
                  onClick={assign}
                >
                  <Icon name="send" size={14} />
                  Assign
                </button>
                <button className="fl-btn ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {all.length === 0 ? (
          <p className="hm-none">Nothing assigned to you right now.</p>
        ) : (
          <ul className="hm-rows" aria-label="Tasks">
            {groups
              .filter(([, rows]) => rows.length > 0)
              .map(([label, rows]) => (
                <li key={label} className="hm-tgroup">
                  <div className="hm-tgrp">
                    <span>{label}</span>
                    <span>{rows.length}</span>
                  </div>
                  <ul>
                    {rows.map((r) => {
                      const on = sel?.id === r.id;
                      const isDone = r.kind === "task" && r.task.status === "done";
                      return (
                        <li
                          key={r.id}
                          className={
                            "hm-trow" +
                            (on ? " on" : "") +
                            (isDone ? " done" : "") +
                            (flashId === r.id ? " hm-tkfl" : "")
                          }
                          data-task-id={r.id}
                        >
                          {r.kind === "issue" ? (
                            <span className="hm-idot" role="img" aria-label="Open issue" />
                          ) : isReported(r.task) ? (
                            <span className="hm-tick" aria-hidden="true">
                              <Icon name="check" size={12} />
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={"hm-cb" + (isDone ? " on" : "")}
                              aria-label={
                                isDone ? `Reopen "${r.task.title}"` : `Mark "${r.task.title}" done`
                              }
                              disabled={pending}
                              onClick={() => {
                                select(r.id);
                                if (isDone) undo(r.id);
                                else markDone(r.id);
                              }}
                            >
                              {isDone ? <Icon name="check" size={12} /> : null}
                            </button>
                          )}
                          <button
                            type="button"
                            className="hm-tsel"
                            aria-current={on ? "true" : undefined}
                            onClick={() => select(r.id)}
                          >
                            <span className="hm-tt">
                              {r.kind === "issue" ? r.issue.summary : r.task.title}
                            </span>
                            <span className="hm-tm">
                              {r.kind === "issue" ? issueMeta(r.issue) : meta(r.task)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </div>

      <article className="hm-read" aria-label={sel?.kind === "issue" ? "The issue" : "The task"}>
        {sel?.kind === "issue" && (
          <>
            <p className="hm-said">{sel.issue.summary}</p>
            {/* THE STATE IS A WORD IN ITS COLOUR, under the words (laws 10 and
                26): an open issue is amber, "closing in", never red — a fault
                is not a missed date. Then how often, then where it came from. */}
            <p className="hm-when">
              <b className="warn">Open issue.</b>{" "}
              {sel.issue.occurrences > 1
                ? `Seen ${issueSeen(sel.issue.occurrences)}, first ${fmtAuWeekdayDayMonth(sel.issue.firstSeen)}, last ${fmtAuWeekdayDayMonth(sel.issue.lastSeen)}.`
                : `Seen once, on ${fmtAuWeekdayDayMonth(sel.issue.lastSeen)}.`}
              {src && <> Issue from your {fmtAuWeekdayDayMonth(src.day)} note.</>}
            </p>

            <dl className="hm-facts">
              <div>
                <dt>Where</dt>
                <dd className={sel.issue.where ? undefined : "unset"}>{sel.issue.where ?? "Not on a job"}</dd>
              </div>
              <div>
                <dt>Equipment</dt>
                <dd className={sel.issue.equipmentRef ? undefined : "unset"}>
                  {sel.issue.equipmentRef ?? "Not named"}
                </dd>
              </div>
              <div>
                <dt>Seen</dt>
                <dd>{issueSeen(sel.issue.occurrences)}</dd>
              </div>
            </dl>

            {src && (
              <div className="hm-group">
                <span className="hm-gl">From the diary</span>
                <p className="hm-quote">{src.said}</p>
                <span className="hm-qm">
                  <span>
                    {fmtAuWeekdayDayMonth(src.day)}, {src.at}
                  </span>
                  {onOpenEntry && (
                    <button type="button" className="hm-link" onClick={() => onOpenEntry(src.id)}>
                      Open in diary
                    </button>
                  )}
                </span>
              </div>
            )}

            <div className="hm-acts">
              <button
                className="hm-btn primary"
                type="button"
                disabled={pending}
                onClick={() => run(() => resolveIssue(sel.id))}
              >
                Mark resolved
              </button>
            </div>
          </>
        )}

        {sel?.kind === "task" && (
          <>
            <p className="hm-said">{sel.task.title}</p>
            {/* THE STATE IS A WORD IN ITS COLOUR, under the title (laws 10 and
                26): red for past its date, amber for closing in, green for
                done. Where the task came from follows in the same line. */}
            <p className="hm-when">
              {sel.task.status === "done" ? (
                <b className="ok">{sel.task.doneAt ? doneLabel(sel.task.doneAt, today) : "Done"}.</b>
              ) : past(sel.task) ? (
                <b className="bad">
                  Overdue, {-daysUntil(sel.task.dueDate!, today)}{" "}
                  {-daysUntil(sel.task.dueDate!, today) === 1 ? "day" : "days"} late.
                </b>
              ) : dueLabel(sel.task.dueDate, today) ? (
                <b className={dueLabel(sel.task.dueDate, today)!.state === "warn" ? "warn" : undefined}>
                  {dueLabel(sel.task.dueDate, today)!.label}.
                </b>
              ) : (
                <b>Open.</b>
              )}
              {src && <> Task from your {fmtAuWeekdayDayMonth(src.day)} note.</>}
              {sel.task.detail && <> {sel.task.detail}</>}
            </p>

            <dl className="hm-facts">
              <div>
                <dt>Assigned to</dt>
                <dd>{who(sel.task)}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd className={sel.task.dueDate ? (past(sel.task) ? "bad" : undefined) : "unset"}>
                  {sel.task.dueDate ? fmtAuDayMonth(sel.task.dueDate) : "Not set"}
                </dd>
              </div>
              {remind && (
                <div>
                  <dt>Time</dt>
                  <dd>
                    {sel.task.remindKind === "by" ? "by" : "at"} {clockLabel(remind.min)}
                  </dd>
                </div>
              )}
            </dl>

            {src && (
              <div className="hm-group">
                <span className="hm-gl">From the diary</span>
                <p className="hm-quote">{src.said}</p>
                <span className="hm-qm">
                  <span>
                    {fmtAuWeekdayDayMonth(src.day)}, {src.at}
                  </span>
                  {onOpenEntry && (
                    <button type="button" className="hm-link" onClick={() => onOpenEntry(src.id)}>
                      Open in diary
                    </button>
                  )}
                </span>
              </div>
            )}

            <div className="hm-acts">
              {!isReported(sel.task) && (isOwn(sel.task) || canManage) && (
                <button
                  className="hm-btn primary"
                  type="button"
                  disabled={pending}
                  onClick={() => (sel.task.status === "done" ? undo(sel.id) : markDone(sel.id))}
                >
                  {sel.task.status === "done" ? "Reopen" : "Mark done"}
                </button>
              )}
              {sel.task.status !== "done" && (isOwn(sel.task) || canManage) && (
                /* THE DATE IS THE CONTROL. "Move due date" opened a picker
                   in the handoff; here the picker IS the button, reading the
                   date it holds or "Set due date" when there is none, and
                   Clear takes the date off. A reminder rides with the date —
                   see setTaskDue. */
                <DateField
                  value={sel.task.dueDate}
                  today={today}
                  clearable
                  placeholder="Set due date"
                  aria-label="Due date"
                  disabled={pending}
                  onChange={(iso) => run(() => setTaskDue(sel.id, iso))}
                />
              )}
              {mayDelete(sel.task) &&
                (confirm ? (
                  <Confirm
                    pending={pending}
                    onGo={() => run(() => deleteTask(sel.id), () => setConfirm(false))}
                    onKeep={() => setConfirm(false)}
                  />
                ) : (
                  <button
                    className="hm-btn text del"
                    type="button"
                    disabled={pending}
                    aria-label={`Delete "${sel.task.title}"`}
                    onClick={() => setConfirm(true)}
                  >
                    Delete task
                  </button>
                ))}
            </div>
          </>
        )}
      </article>
    </>
  );
}
