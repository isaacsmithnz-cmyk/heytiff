/* ONE JOB, READ OFF A DAY — the law behind the card that comes forward.

   It used to live inside schedule-tab.tsx, which was fine while the rail was
   the only surface that brought a job forward. The capacity window now opens
   its days into the same card, and a second copy of "what is this booking
   doing" is a second answer waiting to disagree with the first: a stack that
   says "not started" beside a block drawn as started is worse than either
   mark alone. So the judgement is stated ONCE, here, over the laid-out day
   both surfaces already share — pure, and therefore pinned by a test.

   THE CLOCK IS AN ARGUMENT, never read here. `nowMin` is the browser's, and
   the caller has already decided whether it can be trusted (it is null when
   the viewer's date disagrees with the board's). A missing mark beats one
   that is hours wrong. */

import type { ScheduleBlock, ScheduleDay } from "./schedule";
import { scheduleBlockPaint, TRACKED_PAINT, type BlockPaint } from "./schedule-colour";

/** One person on the job, and what their booking is doing. */
export type FocusEntry = {
  key: string;
  who: string;
  startMin: number;
  endMin: number;
  /** The word for this booking's state, decided once so the two surfaces can
      never disagree. Null when there is nothing to claim. */
  state: string | null;
  paint: BlockPaint;
  /** Finished work is neutral on the rail and neutral here. */
  done: boolean;
};

/** One treatment this job's blocks wear, decoded: the swatch is drawn by the
    card in the job's own paint, the word says what it means. `cat` is always
    first — the category (or owning board) whose colour washes the block. */
export type FocusMark = {
  kind: "cat" | "qt" | "dan" | "done" | "stale" | "idle" | "late" | "on";
  word: string;
};

export type FocusJob = {
  jobNumber: string | null;
  clientName: string | null;
  suburb: string | null;
  /** The category, or the board that owns it — whatever the block says. */
  label: string;
  /** The job's own paint, for the marks' swatches. */
  paint: BlockPaint;
  /** The status of the job and what its colours mean — only what it wears. */
  marks: FocusMark[];
  entries: FocusEntry[];
};

/** What the day being read knows about time. `tracksTime` comes off the laid
    out day; `nowMin` is the browser's clock, or null when it cannot be
    trusted. */
export type DayClock = {
  dayISO: string;
  today: string;
  nowMin: number | null;
  tracksTime: boolean;
};

/** OWNERSHIP OUTRANKS CATEGORY: a job promoted onto one of our boards wears
    the tracked blue, everything else is painted from its ServiceM8 category. */
export function blockPaint(b: Pick<ScheduleBlock, "tracked" | "categoryColour">): BlockPaint {
  return b.tracked ? TRACKED_PAINT : scheduleBlockPaint(b.categoryColour);
}

/** The block's second line in words, so the hue is never the only thing
    naming a category. */
export function blockLabel(b: Pick<ScheduleBlock, "tracked" | "categoryName">): string {
  if (b.tracked) return b.tracked.kind === "project" ? "Project" : "Maintenance";
  return b.categoryName ?? "No category";
}

/** WHAT ONE BLOCK IS DOING, decided once — the rail draws it as treatment,
    the focus card writes it as a word.

    FILLED MEANS SOMEONE IS ON IT; HOLLOW MEANS IT IS STILL ONLY BOOKED.
    Three gates before a block is allowed to go hollow, because the wrong
    hollow block is worse than none:

    · the day has to have begun. On a day still ahead, nothing is started yet
      by definition, and a whole board of outlines would say nothing.
    · the account has to record time at all. `tracksTime` is false when no
      booking drawn that day carries any, which is a crew that marks jobs
      complete and never clocks on — for them this reading does not exist.
    · the job has to still be open. Completed work has plainly happened, and
      goes pale; Unsuccessful didn't and says so with its own ring.

    LATE is the narrower case on top: hollow AND its start has already gone.
    On today that needs the browser's clock, which is null when it disagrees
    with the board's date — no mark beats one that is hours wrong, so
    lateness simply isn't claimed.

    ONE STATE PER BLOCK. A booking ServiceM8 has already marked complete
    cannot also be accused of not having been started — the crew may well be
    on site without clocking on, which is exactly how the job came to be
    closed while a later visit was still booked. The flag wins. */
export function blockState(
  b: ScheduleBlock,
  clock: DayClock
): { hollow: boolean; late: boolean; word: string | null } {
  const dayBegun = clock.dayISO <= clock.today;
  /* A stale booking is NOT closed off — the job is, but that day's work is
     still on somebody's run, so it stays solid rather than fading. */
  const open = b.closure !== "done" && b.status !== "Unsuccessful";
  const hollow = dayBegun && clock.tracksTime && open && !b.onSite;
  const startedGone =
    clock.dayISO < clock.today || (clock.nowMin !== null && b.startMin < clock.nowMin);
  const late = hollow && b.closure !== "stale" && startedGone;
  const word =
    b.closure === "stale" ? "Marked complete in ServiceM8"
    : b.status === "Unsuccessful" ? "Didn't go ahead"
    : late ? "Nothing recorded yet"
    : hollow ? "Not started"
    : b.closure === "done" ? "Done"
    : b.onSite ? "Started" : null;
  return { hollow, late, word };
}

/** THE JOB BROUGHT FORWARD. Gathered from the LANES rather than from the
    payload, so the cards are exactly the bookings that were drawn — a job
    booked on another day is not on this day and has no business in a stack
    lifted off it. Null when the job draws nothing here. */
export function focusJobOf(day: ScheduleDay, jobUuid: string, clock: DayClock): FocusJob | null {
  const entries: FocusEntry[] = day.lanes.flatMap((l) =>
    l.blocks
      .filter((b) => b.remoteId === jobUuid)
      .map((b) => ({
        key: b.key,
        who: l.name,
        startMin: b.startMin,
        endMin: b.endMin,
        state: blockState(b, clock).word,
        done: b.closure === "done",
        paint: blockPaint(b),
      }))
  );
  if (entries.length === 0) return null;

  const all = day.lanes.flatMap((l) => l.blocks).filter((b) => b.remoteId === jobUuid);
  const first = all[0];
  const label = blockLabel(first);
  /* WHAT THE BLOCK'S PAINT IS SAYING, in words — the footer key scoped to the
     one job on the table. Only treatments this job actually wears; each one
     draws its own swatch in the card, so the decode and the block can't
     drift. The category leads because its colour is the loudest thing on the
     block and the least self-explanatory. */
  const marks: FocusMark[] = [{ kind: "cat", word: label }];
  if (first.status === "Quote") marks.push({ kind: "qt", word: "A quote — dashed edge" });
  if (first.status === "Unsuccessful") marks.push({ kind: "dan", word: "Didn't go ahead" });
  if (all.some((b) => b.closure === "stale"))
    marks.push({ kind: "stale", word: "Marked complete in ServiceM8, still booked" });
  if (all.some((b) => b.closure === "done")) marks.push({ kind: "done", word: "Done and closed" });
  if (all.some((b) => blockState(b, clock).late))
    marks.push({ kind: "late", word: "Nothing recorded yet" });
  else if (all.some((b) => blockState(b, clock).hollow))
    marks.push({ kind: "idle", word: "Not started — hollow cap" });
  else if (all.some((b) => b.onSite && b.closure !== "done"))
    marks.push({ kind: "on", word: "Started" });

  return {
    jobNumber: first.jobNumber,
    clientName: first.clientName,
    suburb: first.suburb,
    label,
    paint: blockPaint(first),
    marks,
    entries,
  };
}

/** The DAY-state among a job's marks, for the sheet's header — the ServiceM8
    statuses (Quote, Unsuccessful, Completed) are already the sheet's own
    chips and stay there. */
export function dayStateOfMarks(
  marks: FocusMark[]
): { kind: "late" | "idle" | "on" | "stale"; word: string } | null {
  const m = marks.find(
    (x): x is FocusMark & { kind: "late" | "idle" | "on" | "stale" } =>
      x.kind === "late" || x.kind === "idle" || x.kind === "on" || x.kind === "stale"
  );
  /* the mark's word carries its own decode ("Not started — hollow cap"); the
     sheet wants the state, not the key */
  return m ? { kind: m.kind, word: m.word.split(" — ")[0] } : null;
}
