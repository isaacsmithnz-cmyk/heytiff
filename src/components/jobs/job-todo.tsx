"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Tick } from "@/components/parts/tick";
import { Icon } from "@/components/shell/icon";
import type { RailTask } from "@/lib/jobs/job-conversation";
import { JobSection } from "./job-section";

/* TO DO, ON A JOB'S OVERVIEW (Isaac, 25 October 2026, "Yes, build the
   refined Overview A"): the section recipe, yellow with a tick as Home's To
   do, and Add task its head's one button, second.

   What's open on the job comes first (an ask in a note, a flag: the
   attention rows, with their own doors), then its open tasks, each a tick
   and its words the door to its own form, then what was ticked in the last
   fortnight, by who and when. A row is at least 32, a hairline under it.
   No count beside the title (rule 29). */

export function JobTodo({
  tasks,
  tasksRead,
  onTick,
  onAddTask,
  open,
  openCount = 0,
  done = [],
  onOpenTask,
}: {
  tasks: RailTask[];
  /** The tasks have been read (empty means none, not not-yet). */
  tasksRead: boolean;
  onTick: (task: RailTask) => void;
  /** Add task, for whoever may set one. */
  onAddTask?: () => void;
  /** What's open on the job, an ask in a note or a flag, above its tasks. */
  open?: ReactNode;
  openCount?: number;
  /** ticked in the last fortnight, with who and when */
  done?: readonly { id: string; title: string; line: string }[];
  /** a task's own form, over the page */
  onOpenTask?: (taskId: string) => void;
}) {
  const nothing = tasks.length === 0 && openCount === 0 && done.length === 0;
  return (
    <JobSection
      name="To do"
      icon="check"
      hue="yellow"
      className="jov-todo"
      action={
        onAddTask ? (
          <Button kind="second" size={32} onClick={onAddTask}>
            Add task
          </Button>
        ) : null
      }
    >
      <ul className="jov-rows">
        {open && openCount > 0 && <li className="jov-row jov-asks">{open}</li>}
        {tasks.map((t) => (
          <li key={t.id} className="jov-row jov-task">
            <Tick checked={false} onChange={() => onTick(t)} label={<span className="sr-only">Done, {t.title}</span>} />
            {onOpenTask ? (
              <button type="button" className="jc-task jov-taskopen" onClick={() => onOpenTask(t.id)}>
                <span className="jc-task-name">{t.title}</span>
                <span className="jc-task-line">{t.line}</span>
              </button>
            ) : (
              <span className="jc-task">
                <span className="jc-task-name">{t.title}</span>
                <span className="jc-task-line">{t.line}</span>
              </span>
            )}
          </li>
        ))}
        {done.map((t) => (
          <li key={t.id} className="jov-row jov-task jov-done">
            <Icon name="check" size={16} />
            <button type="button" className="jc-task jov-taskopen" onClick={() => onOpenTask?.(t.id)}>
              <span className="jc-task-name">{t.title}</span>
              <span className="jc-task-line">{t.line}</span>
            </button>
          </li>
        ))}
        {nothing && <li className="jov-row jov-none">{tasksRead ? "Nothing to do on it." : "Reading the job's tasks"}</li>}
      </ul>
    </JobSection>
  );
}
