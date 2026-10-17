"use client";

import { useContext, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { TimeField } from "@/components/parts/time-field";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import { deleteTask, makeTask, taskPeople, type TaskPeople } from "@/app/actions/dashboard";
import { searchPalette } from "@/app/actions/palette";

export type TaskJob = { uuid: string; label: string };

/* NEW › TASK (rules 44 and 51), and a job's Add › Task. One form wherever a
   task starts (Isaac, 18 October: "on a job it automatically goes on the
   job, from home it's a general task"): what needs doing; the job it is
   for, filled in when it opens on a job's page and clearable, so cleared it
   is a general task; when, a day and a time to have it done by if it has
   one; and who, you unless you may give work and choose someone. It opens
   over the page you're on; saving keeps you there, with a toast and Undo. */
export function TaskForm({ job = null, onClose }: { job?: TaskJob | null; onClose: () => void }) {
  const host = useContext(WindowsContext);
  const whenId = useId();
  const [title, setTitle] = useState("");
  const [forJob, setForJob] = useState<TaskJob | null>(job);
  const [due, setDue] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [people, setPeople] = useState<TaskPeople | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void taskPeople().then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    if (!title.trim()) {
      setError("Say what needs doing.");
      return;
    }
    setSaving(true);
    const made = await makeTask({
      title,
      jobUuid: forJob?.uuid ?? null,
      dueDate: due,
      dueTime: due ? time : null,
      forStaffId: who ?? people?.me ?? null,
    });
    if (!made.ok) {
      setSaving(false);
      setError(made.error);
      return;
    }
    onClose();
    const words = forJob ? (made.jobKept === false ? "Task added, without its job for now" : `Task added to ${forJob.label}`) : "Task added";
    host?.toast(words, async () => {
      await deleteTask(made.taskId);
    });
  }

  const team = people && people.people.length > 0 ? people.people : null;

  return (
    <Dialog
      heading="New task"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" onClick={save} disabled={saving}>
            {saving ? "Adding the task" : "Add task"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="What needs doing" error={error}>
          <TextInput
            value={title}
            invalid={!!error}
            data-autofocus
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <JobField job={forJob} onChange={setForJob} />
        <div className="mk-pair">
          <Field label="When" id={whenId}>
            <DateField
              id={whenId}
              value={due}
              onChange={(d) => {
                setDue(d);
                if (!d) setTime(null);
              }}
              clearable
              placeholder="No day"
            />
          </Field>
          {due && (
            <Field label="By">
              <TimeField value={time} onChange={setTime} placeholder="Any time" />
            </Field>
          )}
        </div>
        {team && (
          <Field label="Who">
            <Chooser
              options={team.map((p) => ({ value: p.id, label: p.id === people?.me ? `${p.name}, you` : p.name }))}
              value={who ?? people?.me ?? null}
              onChange={setWho}
            />
          </Field>
        )}
      </form>
    </Dialog>
  );
}

/* THE JOB (rule 51): a field, filled in, that you can change or clear.
   Empty, it finds a job by number, client or site, as Search does. */
function JobField({ job, onChange }: { job: TaskJob | null; onChange: (j: TaskJob | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TaskJob[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void searchPalette(term).then((f) => {
        if (!live) return;
        setHits(
          f.jobs.slice(0, 6).map((j) => ({
            uuid: j.remoteId,
            label: [j.jobNumber ? `Job ${j.jobNumber}` : "Job", j.clientName, j.suburb].filter(Boolean).join(", "),
          })),
        );
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  if (job) {
    return (
      <Field label="Job">
        <div className="mk-job">
          <span className="mk-job-name">{job.label}</span>
          <IconButton glyph="clear" label="Clear the job" size={32} onClick={() => onChange(null)} />
        </div>
      </Field>
    );
  }
  return (
    <Field label="Job">
      <div className="mk-jobfind">
        <TextInput value={q} placeholder="None, a general task" onChange={(e) => setQ(e.target.value)} />
        {q.trim().length >= 2 && hits.length > 0 && (
          <ul className="mk-jobhits" aria-label="Jobs">
            {hits.map((h) => (
              <li key={h.uuid}>
                <button
                  type="button"
                  className="mk-jobhit"
                  onClick={() => {
                    onChange(h);
                    setQ("");
                    setHits([]);
                  }}
                >
                  {h.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}
