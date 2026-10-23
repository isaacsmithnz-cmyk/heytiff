"use client";

import { useContext, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextArea } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { TimeField } from "@/components/parts/time-field";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import { completeTask, deleteTask, makeTasks, readTaskForEdit, reopenTask, taskPeople, updateTask, type TaskForEdit, type TaskPeople } from "@/app/actions/dashboard";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { taskLinesOf } from "@/lib/dashboard/task-lines";
import { JobField, type FormJob } from "./job-field";

export type TaskJob = FormJob;

/* NEW › TASK (rules 44 and 51), and a job's Add › Task. One form wherever a
   task starts (Isaac, 18 October: "on a job it automatically goes on the
   job, from home it's a general task"): what needs doing, one task a line,
   so a list makes several at once; the job they are for, filled in when it
   opens on a job's page and clearable, so cleared they are general tasks;
   when, a day and a time to have them done by; and who, you unless you may
   give work and choose someone. The lines share the rest; tasks that need
   different days or people are what Tiff is for. It opens over the page
   you're on; saving keeps you there, with a toast whose Undo takes them all
   back.

   A TASK OPENS ITS OWN FORM (Isaac, 24 October 2026): To do's rows and a
   job card's tasks open this form over the page, filled in, with Delete,
   Mark done and Save. Who can be Anyone ("It can just say anyone"): the
   task is for its job, open on the job's card for whoever is there. When
   is Add date, then Add time if it needs one; without a time it's due any
   time that day. A done task says who ticked it and when. */
const ANYONE = "anyone";

/** "Fri 24 Oct, 2:10 pm" from an instant, on the account's clock as the browser reads it. */
function whenDone(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = fmtAuWeekdayDayMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `${day}, ${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`;
}

export function TaskForm({
  job = null,
  taskId = null,
  onClose,
  onChanged,
}: {
  job?: TaskJob | null;
  /** an existing task: the form opens on it, to change, tick or delete */
  taskId?: string | null;
  onClose: () => void;
  /** told when a task changed here, so the list it opened from reads again */
  onChanged?: () => void;
}) {
  const host = useContext(WindowsContext);
  const whenId = useId();
  const [task, setTask] = useState<TaskForEdit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [forJob, setForJob] = useState<TaskJob | null>(job);
  const [due, setDue] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  /* Add date and Add time are doors: the field shows once pressed */
  const [dating, setDating] = useState(false);
  const [timing, setTiming] = useState(false);
  const [people, setPeople] = useState<TaskPeople | null>(null);
  /* a task for a job is anyone's until someone is chosen */
  const [who, setWho] = useState<string | null>(job ? ANYONE : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void taskPeople().then((p) => live && setPeople(p));
    if (taskId)
      void readTaskForEdit(taskId).then((r) => {
        if (!live) return;
        if (!r.ok) {
          setLoadError(r.error);
          return;
        }
        const t = r.task;
        setTask(t);
        setTitle(t.title);
        setForJob(t.job ?? t.suggestedJob);
        setDue(t.dueDate);
        setTime(t.dueTime);
        setWho(t.assigneeId ?? ANYONE);
      });
    return () => {
      live = false;
    };
  }, [taskId]);

  const editing = !!taskId;
  const lines = editing ? (title.trim() ? [title.trim()] : []) : taskLinesOf(title);
  const many = lines.length > 1;
  const anyone = who === ANYONE && !!forJob;

  async function save() {
    if (lines.length === 0) {
      setError("Say what needs doing.");
      return;
    }
    setSaving(true);
    if (editing && taskId) {
      const r = await updateTask(taskId, {
        title,
        jobUuid: forJob?.uuid ?? null,
        dueDate: due,
        dueTime: due ? time : null,
        forStaffId: anyone || who === ANYONE ? null : who,
        anyone,
      });
      setSaving(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      onChanged?.();
      host?.toast("Task saved");
      return;
    }
    const made = await makeTasks({
      text: title,
      jobUuid: forJob?.uuid ?? null,
      dueDate: due,
      dueTime: due ? time : null,
      forStaffId: anyone || who === ANYONE ? null : (who ?? people?.me ?? null),
      anyone,
    });
    if (!made.ok) {
      setSaving(false);
      setError(made.error);
      return;
    }
    onClose();
    onChanged?.();
    const n = made.taskIds.length;
    const what = n > 1 ? `${n} tasks added` : "Task added";
    const words = forJob ? (made.jobKept === false ? `${what}, without the job for now` : `${what} to ${forJob.label}`) : what;
    host?.toast(words, async () => {
      for (const id of made.taskIds) await deleteTask(id);
    });
  }

  async function tick() {
    if (!taskId) return;
    setSaving(true);
    const r = task?.done ? await reopenTask(taskId) : await completeTask(taskId, { postDone: true });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    onChanged?.();
    host?.toast(task?.done ? "Task open again" : "Task done", task?.done ? undefined : async () => {
      await reopenTask(taskId, { takeBackDone: true });
      onChanged?.();
    });
  }

  async function remove() {
    if (!taskId) return;
    setSaving(true);
    const r = await deleteTask(taskId);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onClose();
    onChanged?.();
    host?.toast("Task deleted");
  }

  const team = people && people.people.length > 0 ? people.people : null;
  /* who it can be for: Anyone, once it's for a job; then the team, or you */
  const whoOptions = [
    ...(forJob ? [{ value: ANYONE, label: "Anyone" }] : []),
    ...(team
      ? team.map((p) => ({ value: p.id, label: p.id === people?.me ? `${p.name}, you` : p.name }))
      : people?.me && forJob
        ? [{ value: people.me, label: "You" }]
        : []),
  ];
  const whoValue = who === ANYONE && !forJob ? (people?.me ?? null) : (who ?? people?.me ?? null);
  const showDate = dating || !!due;
  const showTime = !!due && (timing || !!time);

  if (editing && !task && !loadError)
    return (
      <Dialog heading="Task" width={560} onClose={onClose}>
        <p className="mk-quiet">Reading the task</p>
      </Dialog>
    );

  return (
    <Dialog
      heading={editing ? "Task" : "New task"}
      width={560}
      onClose={onClose}
      foot={
        editing ? (
          <>
            <Button kind="delete" onClick={() => void remove()} disabled={saving}>
              Delete
            </Button>
            <span className="mk-gap" />
            <Button kind="second" onClick={() => void tick()} disabled={saving}>
              {task?.done ? "Not done yet" : "Mark done"}
            </Button>
            <Button kind="main" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving" : "Save"}
            </Button>
          </>
        ) : (
          <>
            <Button kind="second" onClick={onClose}>
              Cancel
            </Button>
            <Button kind="main" onClick={save} disabled={saving}>
              {saving ? (many ? `Adding ${lines.length} tasks` : "Adding the task") : many ? `Add ${lines.length} tasks` : "Add task"}
            </Button>
          </>
        )
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {loadError ? <p className="mk-error">{loadError}</p> : null}
        <Field label="What needs doing" error={error}>
          <TextArea
            value={title}
            rows={3}
            invalid={!!error}
            data-autofocus
            onKeyDown={(e) => {
              /* Enter is a new line, a new task; ⌘ or Ctrl with Enter saves */
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <JobField
          job={forJob}
          onChange={(j) => {
            setForJob(j);
            /* a job's task starts as anyone's; without a job it's a person's */
            if (j && who === null) setWho(ANYONE);
          }}
        />
        {whoOptions.length > 1 || (whoOptions.length === 1 && whoOptions[0].value === ANYONE) ? (
          <Field label="Who">
            <Chooser options={whoOptions} value={whoValue} onChange={setWho} />
          </Field>
        ) : null}
        <div className="mk-when">
          <span className="pt-field-label" id={whenId}>
            When
          </span>
          <div className="mk-whenrow">
            {showDate ? (
              <DateField
                id={whenId}
                value={due}
                onChange={(d) => {
                  setDue(d);
                  if (!d) {
                    setTime(null);
                    setTiming(false);
                    setDating(false);
                  }
                }}
                clearable
                placeholder="Choose a day"
              />
            ) : (
              <Button kind="second" size={32} onClick={() => setDating(true)} aria-describedby={whenId}>
                Add date
              </Button>
            )}
            {due ? (
              showTime ? (
                <TimeField
                  value={time}
                  onChange={(t) => {
                    setTime(t);
                    if (!t) setTiming(false);
                  }}
                  placeholder="Any time"
                />
              ) : (
                <Button kind="second" size={32} onClick={() => setTiming(true)}>
                  Add time
                </Button>
              )
            ) : null}
          </div>
        </div>
        {task ? (
          <p className="mk-quiet">
            {[
              task.madeBy ? `Made by ${task.madeBy}${task.madeAt ? `, ${whenDone(task.madeAt)}` : ""}` : null,
              task.done ? `Done by ${task.done.by ?? "someone"}, ${whenDone(task.done.at)}` : null,
            ]
              .filter(Boolean)
              .join(". ")}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
