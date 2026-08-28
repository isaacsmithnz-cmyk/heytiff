/* WORK SOMEBODY GAVE YOU — the bell's other group.

   A reminder is something you asked for at a time you chose. An assignment is
   the opposite: you did not ask, you were not there, and until now the only
   way to find out was to open the Tasks panel on the off-chance. Isaac's rule
   is that being given a task alerts you the moment it exists, time or no
   time.

   DERIVED AT READ, LIKE THE REMINDERS BESIDE IT — no scheduler, no queue, no
   delivery state. The question is a filter on the tasks table:

     open AND yours AND somebody else made it AND you haven't said "Got it".

   That is the whole feature, and it is why every writer gets it for free: a
   task typed on the panel, one Tiff minted from a note, one made from a
   ServiceM8 mention all insert into the same table, and none of them has to
   remember to announce itself.

   ACKNOWLEDGING IS NOT DOING. "Got it" takes the row off the bell and leaves
   the task open on your list, because the two questions are different — "have
   you seen this" and "have you done it" — and a bell that only clears when
   the work is finished is a bell people turn off. */

/** One task somebody gave you that you haven't answered for yet. */
export type NewAssignment = {
  taskId: string;
  title: string;
  detail: string | null;
  /** Who gave it to you, resolved to a display name. Null when their staff
      card has gone or was never readable — the row still rings, because the
      work is real whether or not we can name the giver. */
  fromName: string | null;
  /** ISO day, or null for a task with no deadline on it. */
  dueDate: string | null;
  /** ISO instant the task was created — what the row's "when" reads off. */
  createdAt: string;
};

/** What the row says under the title, or NOTHING.

    Two facts at most: who gave it to you and when it is wanted. Both are
    optional — a task from a person whose staff card we can't read is still a
    task, and one with no deadline is an ordinary task rather than a broken
    one — and when neither is known this returns null and the row draws no
    second line at all.

    That null is the point. The obvious fallback was "Assigned to you", which
    is exactly what the group heading above the row already says: a caption
    that exists because the design didn't explain itself. The title alone is
    the honest row. */
export function assignmentLine(
  a: NewAssignment,
  dueLabel: (iso: string) => string
): string | null {
  /* Both fragments start with a capital, joined by the house's own middle
     dot — the same shape the money block's "Raised Fri 27 Mar · Paid Thu 2
     Apr" wears, so two meta lines on one screen can't disagree about it. */
  const from = a.fromName ? `From ${a.fromName}` : null;
  const due = a.dueDate ? `Due ${dueLabel(a.dueDate)}` : null;
  return [from, due].filter(Boolean).join(" · ") || null;
}

/** The bell shows a task ONCE.

    A task can be both an unacknowledged assignment and a reminder that has
    come due — somebody gave it to you this morning and set a nudge for
    lunchtime. Two rows for one task is the badge counting the same job twice,
    and the reminder is the more specific statement (it is due NOW, not merely
    news), so the reminder wins and the assignment drops.

    Written here rather than in the component because it is a rule about the
    data, and the badge and the panel must never disagree about how many
    things need you. */
export function assignmentsNotAlreadyDue(
  assignments: readonly NewAssignment[],
  dueReminderTaskIds: readonly string[]
): NewAssignment[] {
  const due = new Set(dueReminderTaskIds);
  return assignments.filter((a) => !due.has(a.taskId));
}
