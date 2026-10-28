import type { Tone } from "@/components/parts/state";
import type { SheetState } from "@/lib/timepay/query";
import { submitDayIndex } from "@/lib/timepay/auto-submit";
import {
  DAY_WORD,
  cycleNoun,
  dayLabel,
  daysToCome,
  isWeekendRate,
  lastDayToCome,
  type DayClass,
  type DayEntry,
  type DaySource,
  type Settings,
  type WeekCtx,
} from "./logic";

/* WHERE A TIMESHEET STANDS, AND WHAT IT SAYS: a day's word and where it
   came from, the break's limits, one word for the sheet, whether it can be
   sent now, the button's word, and the one line under the title. My timesheet draws it, and so does the phone's timesheet
   (api/mobile/timesheet), so a week reads the same in both places. */

/** What to CALL a day: a worked weekend is at a premium for the day of the
    week, not because it ran long, so it says so. */
export function dayWord(entry: DayEntry, cls: DayClass, dow: number, s: Settings): string {
  return isWeekendRate(entry, dow, s) ? "Weekend rates" : DAY_WORD[cls];
}

/* Where a saved day came from, so a presumed day never reads as though the
   person logged it. */
export const SOURCE_NOTE: Record<DaySource, string> = {
  entered: "You logged this day.",
  holiday: "Public holiday — the business is closed.",
  leave: "Booked leave — this came from your leave, not from here.",
  presumed: "Your normal day, filled in for you.",
  expected: "Not yet. This day is marked as worked once the day is over.",
  none: "Weekends aren't counted unless you add them.",
};

/* The break's limits: the stepper went 0 to 120 in fives, and a typed
   number keeps to the same. */
export const BREAK_STEP = 5;
export const BREAK_MAX = 120;
export const clampBreak = (n: number) => Math.min(BREAK_MAX, Math.max(0, Math.round(n)));

/* The sheet's state as one word (rule 17), in the cycle's noun. */
export const statusCopy = (
  status: SheetState["status"],
  noun: string,
): { label: string; tone: Tone; sub: string } =>
  ({
    draft: { label: "Draft", tone: "look" as Tone, sub: "" },
    submitted: { label: "Submitted", tone: "good" as Tone, sub: "With your manager. You'll be told if anything needs a look." },
    approved: { label: "Approved", tone: "good" as Tone, sub: `Signed off. This ${noun} is closed.` },
    sent_back: { label: "Sent back", tone: "wrong" as Tone, sub: "Your manager has a question — answer it and submit again." },
  })[status];

export function sheetLine({
  status: sheetStatus,
  live,
  pastSend,
  settings,
  ctx,
  casual,
  salaried,
  entries,
}: {
  status: SheetState["status"];
  /** the period is the current one */
  live: boolean;
  /** the workspace's send moment for this period has come (server clock) */
  pastSend: boolean;
  settings: Settings;
  ctx: WeekCtx;
  casual: boolean;
  salaried: boolean;
  /** the days on the sheet with something on them (derive's `entries`) */
  entries: number;
}) {
  const noun = cycleNoun(settings.cycle);
  const sent = sheetStatus === "submitted" || sheetStatus === "approved";
  /* With the lock off, a sent week stays open while it runs; approved never
     reopens. */
  const openAfterSending = sheetStatus === "submitted" && !settings.lock && live;
  const frozenSent = sent && !openAfterSending;
  const reopened = sheetStatus === "sent_back";
  const status = statusCopy(sheetStatus, noun);

  /* Sending waits for the days it would freeze; a sent-back sheet never
     waits, since its answer IS a resubmission. */
  const holdForDays = daysToCome(ctx) > 0 && sheetStatus !== "sent_back";

  /* A draft past the send moment is closed when the workspace locks; one
     with days on it was already sent by the loader on the way here. */
  const closedAtSend = settings.lock && pastSend && sheetStatus === "draft";

  /* WHEN THIS SHEET GOES, said once, beside the button. */
  const canSend = !sent && (live || reopened) && !closedAtSend && !holdForDays && entries > 0;
  const lastAhead = lastDayToCome(ctx);
  const submitAt = submitDayIndex(ctx.week, settings.submitDay);
  const itSends = `it sends itself ${settings.submitDay} ${settings.submitTime}${settings.lock ? " and locks" : ""}`;
  const sendLine = holdForDays
    ? (casual ? "Add the days you worked. " : "") +
      (lastAhead >= 0 && lastAhead < submitAt
        ? `Send this ${noun} once ${dayLabel(ctx.week[lastAhead]!)} is over. If you don't, ${itSends}.`
        : `${itSends.charAt(0).toUpperCase()}${itSends.slice(1)}.`)
    : entries === 0
      ? `${casual ? "Add" : "Log"} the days you worked to send this ${noun}.`
      : `Ready to send. If you don't, ${itSends}.`;

  const sub =
    !live && !sent
      ? "This period is closed."
      : closedAtSend
        ? `This ${noun} locked at ${settings.submitDay} ${settings.submitTime}.`
        : salaried && !sent
          ? `Salaried — your pay is the same every ${noun}, so there's nothing to fill in. Leave and public holidays arrive from where they're booked.${
              settings.salariedOtPaid === false
                ? " A long day is still worth recording, but your salary already covers the extra hours."
                : ""
            }`
          : sheetStatus === "draft"
            ? sendLine
            : openAfterSending
              ? `${status.sub} You can still change it until the ${noun} ends.`
              : status.sub;

  return {
    noun,
    sent,
    openAfterSending,
    frozenSent,
    reopened,
    status,
    closedAtSend,
    canSend,
    sendWord: sheetStatus === "sent_back" ? "Send again" : `Send ${noun}`,
    sub,
  };
}
