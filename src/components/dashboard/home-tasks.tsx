"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { DateField } from "@/components/ui/date-field";
import { completeTask, createTask, deleteTask, reopenTask } from "@/app/actions/dashboard";
import { dueLabel, type DashTask } from "@/lib/dashboard/tasks";
import { auDayOf, fmtAuDayMonth } from "@/lib/au-dates";

/* The Tasks tab — the board's own task body, `.wb2-urbody.twocol`.

   THE TICK LEADS, because ticking is the whole interaction. That is the
   board's rule and it is the reason this stopped being a `.dash-row` with a
   "Done" button floating at the end: on the board the circle is the first
   thing under your thumb, and everything else on the row is context for it.

   Two lanes: yours on the left, everyone else's on the right behind a hair
   rule. Under 1100px it stacks, because a 400px-wide task lane is worse than
   one below the work. */

function Due({ task, today }: { task: DashTask; today: string }) {
  const due = dueLabel(task.dueDate, today);
  if (!due) return null;
  return <span className={`wb2-chip ${due.state === "bad" ? "dan" : "warn"}`}>{due.label}</span>;
}

function Tick({
  task,
  today,
  who,
  onDone,
  pending,
  del,
  flash,
}: {
  task: DashTask;
  today: string;
  who?: string;
  onDone: (id: string) => void;
  pending: boolean;
  /** Wired only when the viewer may delete this task — its creator, or `team`. */
  del?: { confirming: boolean; ask: () => void; go: () => void; keep: () => void };
  /** Arrived here from a journal chip naming this task. */
  flash?: boolean;
}) {
  /* Deleting has no undo — unlike completing, there is no row left to reopen —
     so the ✕ never fires the action itself: the row swaps into a confirm.
     Focus lands on Keep, so Enter twice backs out rather than deletes. */
  if (del?.confirming) {
    return (
      <div className="wb2-tk hm-tkcf" data-task-id={task.id}>
        <span className="wb2-tkb hm-tkcfx" aria-hidden="true">
          <Icon name="x" size={13} />
        </span>
        <span className="wb2-tkt">
          <b>{task.title}</b>
          <em className="hm-tkq">Delete for good?</em>
        </span>
        <button className="hm-tkyes" type="button" disabled={pending} onClick={del.go}>
          Delete
        </button>
        <button className="hm-tkno" type="button" disabled={pending} onClick={del.keep} autoFocus>
          Keep
        </button>
      </div>
    );
  }
  return (
    <div className={"wb2-tk" + (flash ? " hm-tkfl" : "")} data-task-id={task.id}>
      <button
        className="wb2-tkb"
        type="button"
        disabled={pending}
        aria-label={`Mark "${task.title}" done`}
        onClick={() => onDone(task.id)}
      >
        <Icon name="check" size={13} />
      </button>
      <span className="wb2-tkt">
        <b>{task.title}</b>
        {(task.detail || who) && (
          <em>{[who, task.detail].filter(Boolean).join(" · ")}</em>
        )}
      </span>
      <Due task={task} today={today} />
      {del && (
        <button
          className="hm-tkdel"
          type="button"
          disabled={pending}
          aria-label={`Delete "${task.title}"`}
          onClick={del.ask}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}

/** Completed rows keep the shape but lose the control — the circle would
    invite a second click that does nothing. */
function DoneRow({
  id,
  title,
  detail,
  undo,
  flash,
}: {
  id: string;
  title: string;
  detail: string;
  undo?: () => void;
  flash?: boolean;
}) {
  return (
    <div className={"wb2-tk" + (flash ? " hm-tkfl" : "")} data-task-id={id}>
      <span className="wb2-tkb on" aria-hidden="true">
        <Icon name="check" size={13} />
      </span>
      <span className="wb2-tkt">
        <b className="hm-struck">{title}</b>
        <em>{detail}</em>
      </span>
      {undo ? (
        <button className="hm-undo" type="button" onClick={undo}>
          Undo
        </button>
      ) : (
        <span className="wb2-chip ok">Done</span>
      )}
    </div>
  );
}

/* "Done today" / "Done 22 July". `today` is an AU calendar date, so the
   completion has to resolve to one too — reading done_at's day in UTC puts
   anything finished before ~10am AEST on the previous date. */
function doneLabel(iso: string, today: string): string {
  const day = auDayOf(iso);
  return day === today ? "Done today" : `Done ${fmtAuDayMonth(day)}`;
}

export function HomeTasks({
  today,
  mine,
  team,
  done,
  reported,
  viewerStaffId,
  canManage,
  assignable,
  focusTaskId = null,
  onFocusHandled,
}: {
  today: string;
  mine: DashTask[];
  team: DashTask[] | null;
  done: DashTask[];
  reported: DashTask[];
  viewerStaffId: string | null;
  canManage: boolean;
  assignable: { id: string; name: string }[];
  /** A task named by a journal chip: scroll to it and mark it, once. */
  focusTaskId?: string | null;
  onFocusHandled?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const [assignedTo, setAssignedTo] = useState(assignable[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");

  // the team lane is everyone else's open work — yours already has a lane
  const others = (team ?? []).filter((t) => t.assigneeId !== viewerStaffId);

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

  /* ARRIVING FROM A JOURNAL CHIP. The panel was just revealed, so the row is
     somewhere in a list the reader has never scrolled — bring it to the middle
     and mark it for a moment, then hand the focus back so pressing the same
     chip a second time works.

     The row is found in the DOM rather than through a ref map: which of the
     four lanes holds it (yours, the team's, recently done, reported) is the
     server's answer, not this component's, and a query by `data-task-id`
     doesn't care. A task that is on none of them — someone else's, older than
     the done window — simply isn't found, and the tab switch is the whole
     journey. `scrollIntoView` is optional-called: jsdom has no layout and does
     not implement it. */
  useEffect(() => {
    if (!focusTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-task-id="${focusTaskId}"]`);
    row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setFlashId(focusTaskId);
    const t = setTimeout(() => {
      setFlashId(null);
      onFocusHandled?.();
    }, 1800);
    return () => clearTimeout(t);
  }, [focusTaskId, onFocusHandled]);

  /* Who gets the ✕ mirrors deleteTask's own rule: the creator, or a manager.
     The action re-decides regardless. Guarded on viewerStaffId so a viewer
     with no staff record never reads an ownerless task (createdBy null) as
     theirs — null === null must not grant the control. */
  const delFor = (t: DashTask) =>
    canManage || (!!viewerStaffId && t.createdBy === viewerStaffId)
      ? {
          confirming: confirmId === t.id,
          ask: () => setConfirmId(t.id),
          go: () => run(() => deleteTask(t.id), () => setConfirmId(null)),
          keep: () => setConfirmId(null),
        }
      : undefined;
  const assign = () =>
    run(
      () => createTask({ assignedTo, title, detail: detail || undefined, dueDate: dueDate || undefined }),
      () => {
        setTitle("");
        setDetail("");
        setDueDate("");
        setOpen(false);
      },
    );

  const hasSide = others.length > 0 || reported.length > 0 || done.length > 0;

  return (
    <>
      {error && <div className="tp-err">{error}</div>}

      {canManage && (
        <div className="hm-panelbar">
          <button className="hm-link" type="button" disabled={pending} onClick={() => setOpen((v) => !v)}>
            <Icon name="plus" size={13} />
            Assign a task
          </button>
        </div>
      )}

      {canManage && open && (
        <div className="lv-form">
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

      <div className={"wb2-urbody" + (hasSide ? " twocol" : "")}>
        <div className="wb2-urqueue">
          <div className="wb2-sect">Yours</div>
          {mine.length === 0 ? (
            <p className="hm-none">Nothing assigned to you right now.</p>
          ) : (
            <div className="wb2-tasks">
              {mine.map((t) => (
                <Tick
                  key={t.id}
                  task={t}
                  today={today}
                  onDone={markDone}
                  pending={pending}
                  del={delFor(t)}
                  flash={flashId === t.id}
                />
              ))}
            </div>
          )}
        </div>

        {hasSide && (
          <div className="wb2-urside">
            {others.length > 0 && (
              <>
                <div className="wb2-sect">Across the team</div>
                <div className="wb2-tasks">
                  {others.map((t) => (
                    <Tick
                      key={t.id}
                      task={t}
                      today={today}
                      who={t.assigneeName}
                      onDone={markDone}
                      pending={pending}
                      del={delFor(t)}
                      flash={flashId === t.id}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Work you handed out, reported back when it's finished. Only ever
                someone else's completion — you don't need telling about your own. */}
            {reported.length > 0 && (
              <>
                <div className="wb2-sect">Completed for you</div>
                <div className="wb2-tasks">
                  {reported.map((t) => (
                    <DoneRow
                      key={t.id}
                      id={t.id}
                      flash={flashId === t.id}
                      title={t.title}
                      detail={`${t.doneByName ?? t.assigneeName}${
                        t.doneAt ? ` · ${doneLabel(t.doneAt, today).toLowerCase()}` : ""
                      }`}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Finishing something shouldn't make it vanish without trace — and
                a tap on the tick is easy to make by accident, so it reverses. */}
            {done.length > 0 && (
              <>
                <div className="wb2-sect">Recently done</div>
                <div className="wb2-tasks">
                  {done.map((t) => (
                    <DoneRow
                      key={t.id}
                      id={t.id}
                      flash={flashId === t.id}
                      title={t.title}
                      detail={t.doneAt ? doneLabel(t.doneAt, today) : ""}
                      undo={() => undo(t.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
