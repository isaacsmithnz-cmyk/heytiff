/* ISSUES ON HOME — the pure half.

   An issue is the "this keeps happening" memory the note router writes when a
   debrief says a unit has tripped again: one row per summary per target, and
   a repeat bumps `occurrences` rather than adding a second row (see
   actions/workboard-notes). Until 2026-09-15 nothing on Home read them — the
   project screen listed its own, and Tiff's brain could be asked — so the
   diary said "1 issue" and offered nowhere to go.

   THEY ARE NOT TASKS. No assignee, no due date, nothing to tick: an issue is
   a fact about a site that stays true until somebody says it is not. So it is
   its own group on the Tasks face, and its one action is "Mark resolved". */

export type IssueTargetKind = "none" | "project" | "visit" | "agreement" | "job";

export type HomeIssue = {
  id: string;
  /** The words the note used, verbatim. */
  summary: string;
  /** "the middle rooftop one" — free text, never an equipment row. */
  equipmentRef: string | null;
  /** How many times it has been said. One is a fault; three is a pattern. */
  occurrences: number;
  /** ISO dates, in the workspace's zone. */
  firstSeen: string;
  lastSeen: string;
  targetKind: IssueTargetKind;
  targetId: string | null;
  /** Where it is, in words — "Job 1042, Bayview Apartments" — or null for an
      issue that was not about a job, or whose target has gone. */
  where: string | null;
};

/** Where an issue is, from what its target has to say for itself. One rule
    for every kind, so the read module carries no words of its own:
    a job number leads when there is one, otherwise the client and what the
    work is called. */
export function issueWhere(t: {
  jobNumber?: string | null;
  clientName?: string | null;
  label?: string | null;
}): string | null {
  const client = t.clientName?.trim() || null;
  const label = t.label?.trim() || null;
  if (t.jobNumber) return client ? `Job ${t.jobNumber}, ${client}` : `Job ${t.jobNumber}`;
  if (client && label) return `${client}, ${label}`;
  return client ?? label;
}
