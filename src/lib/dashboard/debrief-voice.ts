/* THE DEBRIEF SPEAKS AT THE HOUR IT IS.

   One tab, one habit, three voices. "How did today go?" is the right question
   at knock-off and the wrong one at 6am, and the same control gets pressed at
   both ends of a day — a spark on the way out of the yard is a brief, the
   same button at four is a debrief. The feature keeps its name (Isaac calls
   it the debrief); only what it says changes.

   Nothing here reads a clock. The phase arrives from the loader, in the
   workspace's zone, for the same reason `today` does: a component that asks
   the browser what time it is renders differently on the server and the
   client, and React Compiler is on for this app — see the hydration trap the
   date already avoids in home.tsx. */

export type DayPhase = "morning" | "midday" | "knock";

/** Where the working day turns. Eleven is when a trade morning is spent, and
    three is when the run is done and the paperwork starts — both chosen to
    sit inside the default rail (7–5) rather than on its ends, so the wording
    changes while you are still looking at the page. */
export const MIDDAY_FROM_MIN = 11 * 60;
export const KNOCK_FROM_MIN = 15 * 60;

export function phaseOf(nowMin: number | null): DayPhase {
  /* No clock (a rail day that is not today, an unreadable zone) is treated as
     the start of a day rather than the end of one: "what's on" invites, and
     is never wrong the way "how did today go?" is wrong at dawn. */
  if (nowMin === null) return "morning";
  if (nowMin >= KNOCK_FROM_MIN) return "knock";
  if (nowMin >= MIDDAY_FROM_MIN) return "midday";
  return "morning";
}

export type DebriefVoice = {
  /** The question, at the top of the panel. */
  title: string;
  /** What the button says. It is the same flow every time. */
  cta: string;
};

/* No phrase for the entry underneath. "Last night's debrief" is a guess about
   a row whose own date is right there — and a wrong guess on any day the last
   thing you said was Friday. The entry says when it was; the panel doesn't
   need to say it differently. */
const VOICES: Record<DayPhase, DebriefVoice> = {
  morning: { title: "What’s on today?", cta: "Start the brief" },
  midday: { title: "How’s it tracking?", cta: "Start the check-in" },
  knock: { title: "How did today go?", cta: "Start the debrief" },
};

export function debriefVoice(phase: DayPhase): DebriefVoice {
  return VOICES[phase];
}
