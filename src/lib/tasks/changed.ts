import { useEffect } from "react";

/* A TASK WAS MADE, CHANGED, TICKED OR DELETED, somewhere on the page. The
   task form says so on the window, and a screen that read its tasks for
   itself reads them again: a task made from New on a job's page never
   reached the job's own To do until a reload (Isaac's walk, 25 October
   2026). A browser event, so neither side imports the other. */
export const TASKS_CHANGED = "heytiff:tasks-changed";

export function sayTasksChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TASKS_CHANGED));
}

/** Calls `read` whenever a task changes anywhere on the page. */
export function useTasksChanged(read: () => void) {
  useEffect(() => {
    window.addEventListener(TASKS_CHANGED, read);
    return () => window.removeEventListener(TASKS_CHANGED, read);
  }, [read]);
}
