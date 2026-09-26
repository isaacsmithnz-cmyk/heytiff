import { planRows, type PlanLane } from "@/lib/workboard/note-draft";
import type { NoteProposal, NoteStaff } from "@/lib/workboard/note-brain";
import type { Turn } from "@/lib/workboard/note-turns";
import type { LinePlanRow } from "@/lib/calendar/line";

/* WHAT TIFF WILL FILE, AS SHE SAYS IT — pure.

   The plan is a list inside Tiff's turn, one row per thing, each read the
   way she would say it: who, then what, then when. "**Luke**, the Bellevue
   Hill head is on the ute". A task with nobody on it is the one thing she
   cannot work out, so its row asks instead: "**Who** books 3323 in" beside
   "Needs an answer". The other lanes name themselves by where they land.

   A row is keyed by its place in the STORED proposal (`planRows`), never by
   its words, so a cross on a row names exactly one row to the server. */

export type PlanRowView = {
  key: string;
  /** Where the row lands: a lane of the note, or the calendar. */
  lane: PlanLane | "calendar";
  index: number;
  /** The bold word that leads the row: a first name, "Who", or the lane. */
  lead: string;
  /** What joins the lead to the rest: "**Luke**, the head is on the ute"
      reads with a comma, and "**Who** books 3323 in" is one clause. */
  join: ", " | " ";
  /** The rest of the row: the title and, for a task, when. */
  text: string;
  /** Nobody is on this task yet: the row asks "Needs an answer". */
  needs: boolean;
  /** Taken off the plan by its cross. */
  off?: boolean;
  /** A library entry waits for its own press ("Add to the Library"). */
  kb?: "ready" | "busy" | "added";
};

/** The lane's own word, where a row has no person to lead with. */
const LEAD: Record<Exclude<PlanLane, "tasks">, string> = {
  flags: "On the board",
  issueEntries: "Logged",
  bringItems: "Bring",
  progressBullets: "On the job",
  commissioningEntries: "On the job",
  kbEntries: "For everyone",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri 7:00" from the task's day and time; "" when it has neither. The day
    is read as a calendar date, so no zone can move it to the day before. */
export function whenOf(dueDate: string, remindTime: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  const day = d ? DAYS[new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).getUTCDay()] : "";
  const t = /^(\d{1,2}):(\d{2})$/.exec(remindTime);
  const time = t ? `${Number(t[1])}:${t[2]}` : "";
  return [day, time].filter(Boolean).join(" ");
}

export const firstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? "";

/** The plan's rows, in the order `planRows` keeps. `asking` is whether Tiff
    is still waiting on something: only then does an unassigned task ask. */
export function planView(
  proposal: NoteProposal,
  staff: readonly NoteStaff[],
  asking: boolean
): PlanRowView[] {
  return planRows(proposal).map((row) => {
    const base = { key: row.key, lane: row.lane, index: row.index };
    if (row.lane === "tasks") {
      const task = proposal.tasks[row.index]!;
      const who = task.assigneeId ? staff.find((s) => s.id === task.assigneeId) : undefined;
      const when = whenOf(task.dueDate, task.remindTime);
      const text = when ? `${task.title.trim()}, ${when}` : task.title.trim();
      if (who) return { ...base, lead: firstName(who.fullName), join: ", ", text, needs: false };
      return { ...base, lead: "Who", join: " ", text, needs: asking };
    }
    return {
      ...base,
      lead: LEAD[row.lane],
      join: ", ",
      text: row.text.trim(),
      needs: false,
      ...(row.lane === "kbEntries" ? { kb: "ready" as const } : {}),
    };
  });
}

/** What she put on the calendar, as the same rows: "**Thu 1 Oct**, toolbox
    talk, 6:45 am", "**Every month**, the first Thursday, until Aug 2027". It
    is already on, so nothing asks and nothing waits for a press. */
export function calendarRows(plan: readonly LinePlanRow[]): PlanRowView[] {
  return plan.map((row, index) => ({
    key: `calendar:${index}`,
    lane: "calendar",
    index,
    lead: row.lead,
    join: ", ",
    text: row.text,
    needs: false,
  }));
}

/** Tiff's question, said once: her line already ends with it when the model
    followed the brief, and when it did not the question is added. */
export function askLine(say: string, question: string): string {
  const s = say.trim();
  const q = question.trim();
  if (!s) return q;
  if (!q || s.includes(q)) return s;
  return `${s} ${q}`;
}

/** What Tiff has said since you last spoke, as one line — the turns a
    server call returned end with it. */
export function tiffSince(turns: readonly Turn[] | undefined): string {
  if (!turns?.length) return "";
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0 && turns[i]!.who === "tiff"; i--) out.unshift(turns[i]!.text);
  return out.join(" ");
}

/** Tiff's last line in what a server call returned — the diary's line under
    the words too, so it is said once, with the turns (note-turns). */
export { lastTiff } from "@/lib/workboard/note-turns";
