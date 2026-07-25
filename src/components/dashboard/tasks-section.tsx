"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { completeTask, createTask, reopenTask } from "@/app/actions/dashboard";
import { dueLabel, type DashTask } from "@/lib/dashboard/tasks";
import { auDayOf } from "@/lib/au-dates";

/* Your tasks (everyone) plus, for `team` holders, an assign form and the rest
   of the team's open tasks. Completing your own is intrinsic; assigning and
   closing anyone's needs the capability — all re-checked server-side. */

function DueChip({ task, today }: { task: DashTask; today: string }) {
  const due = dueLabel(task.dueDate, today);
  if (!due) return null;
  return (
    <span className={`dchip2 ${due.state}`}>
      <Icon name={due.state === "bad" ? "alert" : "clock"} size={12} />
      {due.label}
    </span>
  );
}

function TaskRow({
  task,
  today,
  showAssignee,
  onDone,
  pending,
}: {
  task: DashTask;
  today: string;
  showAssignee?: boolean;
  onDone: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div className="dash-row">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="dr-subj">{task.title}</div>
        {task.detail && <div className="dr-detail">{task.detail}</div>}
        {showAssignee && <div className="dr-detail">Assigned to {task.assigneeName}</div>}
      </div>
      <DueChip task={task} today={today} />
      <button className="fl-btn ghost" disabled={pending} onClick={() => onDone(task.id)}>
        <Icon name="check" size={14} />
        Done
      </button>
    </div>
  );
}

/* "Done today" / "Done 22 July" — when a completed task was ticked off.

   `today` is an AU calendar date, so the completion has to be resolved to one
   too: done_at is a timestamp, and reading its day in UTC puts anything
   finished before ~10am AEST on the previous date. */
function doneLabel(iso: string, today: string): string {
  const day = auDayOf(iso);
  if (day === today) return "Done today";
  return `Done ${fmtAuDay(day)}`;
}

/** "22 July" from an ISO date — formatted as a plain date, never a timestamp,
    so the zone can't shift it back a day on the way out. */
function fmtAuDay(iso: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${iso}T00:00:00Z`));
}

export function TasksSection({
  today,
  mine,
  team,
  done,
  reported,
  viewerStaffId,
  canManage,
  assignable,
}: {
  today: string;
  mine: DashTask[];
  team: DashTask[] | null;
  /** Your recently-completed tasks — a finished task leaves a trace, with an undo. */
  done: DashTask[];
  /** Work you assigned to someone else that has come back completed. */
  reported: DashTask[];
  viewerStaffId: string | null;
  canManage: boolean;
  assignable: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [assignedTo, setAssignedTo] = useState(assignable[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");

  // the team subsection is everyone else's open work — yours already shows above
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

  return (
    <div className="card2">
      <div className="c2h">
        <div className="ci">
          <Icon name="check" size={19} />
        </div>
        <div>
          <b>Your tasks</b>
          <em>What&rsquo;s on your plate{canManage ? " — and the team&rsquo;s" : ""}</em>
        </div>
        {canManage && (
          <button className="fl-btn primary" style={{ marginLeft: "auto" }} disabled={pending} onClick={() => setOpen((v) => !v)}>
            <Icon name="plus" size={14} />
            Assign a task
          </button>
        )}
      </div>

      {error && <div className="tp-err">{error}</div>}

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
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Renew the WHS induction" />
            </label>
            <label className="mts-f">
              <span>Due (optional)</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>
          <div className="lv-fnote">
            <label className="mts-f" style={{ flex: 1 }}>
              <span>Detail (optional)</span>
              <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Anything they need to know" />
            </label>
          </div>
          <div className="lv-fmeta">
            <span />
            <div className="mts-facts">
              <button className="fl-btn primary" disabled={pending || !title.trim() || !assignedTo} onClick={assign}>
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

      {mine.length === 0 ? (
        <div className="dash-mini">Nothing assigned to you right now.</div>
      ) : (
        mine.map((t) => <TaskRow key={t.id} task={t} today={today} onDone={markDone} pending={pending} />)
      )}

      {canManage && others.length > 0 && (
        <>
          <div className="dash-sub">Across the team</div>
          {others.map((t) => (
            <TaskRow key={t.id} task={t} today={today} showAssignee onDone={markDone} pending={pending} />
          ))}
        </>
      )}

      {/* Work you handed out, reported back when it's finished. Only ever
          someone else's completion — you don't need telling about your own. */}
      {reported.length > 0 && (
        <>
          <div className="dash-sub">Completed for you</div>
          {reported.map((t) => (
            <div className="dash-row" key={t.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dr-subj">{t.title}</div>
                <div className="dr-detail">
                  {t.doneByName ?? t.assigneeName}
                  {t.doneAt ? ` · ${doneLabel(t.doneAt, today).toLowerCase()}` : ""}
                </div>
              </div>
              <span className="dchip2 ok">
                <Icon name="check" size={12} />
                Done
              </span>
            </div>
          ))}
        </>
      )}

      {/* Finishing something shouldn't make it vanish without trace — and a tap
          on Done is easy to make by accident, so it has to be reversible. */}
      {done.length > 0 && (
        <>
          <div className="dash-sub">Recently done</div>
          {done.map((t) => (
            <div className="dash-row" key={t.id}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dr-subj" style={{ color: "var(--gray400)" }}>
                  {t.title}
                </div>
                {t.doneAt && <div className="dr-detail">{doneLabel(t.doneAt, today)}</div>}
              </div>
              <span className="dchip2 ok">
                <Icon name="check" size={12} />
                Done
              </span>
              <button className="fl-btn ghost" disabled={pending} onClick={() => undo(t.id)}>
                Undo
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
