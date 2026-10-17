"use client";

import { useContext, useId, useState } from "react";
import { Dialog } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Field, TextInput } from "@/components/parts/field";
import { DateField } from "@/components/ui/date-field";
import { WindowsContext } from "@/components/records/records-context";
import { addTask, deleteTask, setTaskDue } from "@/app/actions/dashboard";

/* NEW › TASK (rules 44 and 51). The one form for a task: what needs doing,
   and when, if it has a day. It opens over the page you're on, fills nothing
   in (rule 44), and saving keeps you where you were, with a toast and Undo.
   The task is yours, as Home's own Add a task makes it; giving it to someone
   is the task's own Give it to. */
export function TaskForm({ onClose }: { onClose: () => void }) {
  const host = useContext(WindowsContext);
  const whenId = useId();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) {
      setError("Say what needs doing.");
      return;
    }
    setSaving(true);
    const made = await addTask(title);
    if (!made.ok) {
      setSaving(false);
      setError(made.error);
      return;
    }
    if (due) await setTaskDue(made.taskId, due);
    onClose();
    host?.toast("Task added", async () => {
      await deleteTask(made.taskId);
    });
  }

  return (
    <Dialog
      heading="New task"
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
        <Field label="When" id={whenId}>
          <DateField id={whenId} value={due} onChange={setDue} clearable placeholder="No day" />
        </Field>
      </form>
    </Dialog>
  );
}
