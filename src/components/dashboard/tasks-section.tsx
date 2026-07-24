"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { completeTask, createTask } from "@/app/actions/dashboard";
import { dueLabel, type DashTask } from "@/lib/dashboard/tasks";

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

export function TasksSection({
  today,
  mine,
  team,
  viewerStaffId,
  canManage,
  assignable,
}: {
  today: string;
  mine: DashTask[];
  team: DashTask[] | null;
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

  const done = (id: string) => run(() => completeTask(id));

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
        mine.map((t) => <TaskRow key={t.id} task={t} today={today} onDone={done} pending={pending} />)
      )}

      {canManage && others.length > 0 && (
        <>
          <div className="dash-sub">Across the team</div>
          {others.map((t) => (
            <TaskRow key={t.id} task={t} today={today} showAssignee onDone={done} pending={pending} />
          ))}
        </>
      )}
    </div>
  );
}
