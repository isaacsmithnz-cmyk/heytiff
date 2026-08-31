"use client";

import { NoteToken } from "@/components/notes/note-token";
import { debriefVoice, type DayPhase } from "@/lib/dashboard/debrief-voice";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { JournalEntry } from "@/lib/dashboard/journal";

/* THE DEBRIEF, ON ITS OWN FACE.

   It used to be a bar at the top of the Journal — the one dark thing on a
   daylight card, sitting above the record it produces. As a tab it gets to be
   what it actually is: a room you go into to talk, with one question in it.

   THE QUESTION FOLLOWS THE HOUR. Same flow, same button, same lane in the
   model — but "How did today go?" at six in the morning is the wrong
   question, and the same control gets pressed at both ends of a day. The
   phase is resolved by the loader in the workspace's zone (see
   lib/dashboard/debrief-voice), never from a clock read in a render body.

   Nothing else is in here. The chips that used to prompt what to say, and the
   line explaining that typing works too, are both gone (Isaac, 2026-08-30) —
   the mark, the question and the button carry it. */

export function HomeDebrief({
  phase,
  last,
  today,
}: {
  phase: DayPhase;
  /** The newest thing in the diary, if there is one. */
  last: JournalEntry | null;
  today: string;
}) {
  const voice = debriefVoice(phase);

  return (
    <div className="hm-dbf">
      <h2 className="hm-dbft">{voice.title}</h2>

      <NoteToken as="debrief" cta={voice.cta} />

      {last && (
        <div className="hm-dbfl">
          <div className="wb2-sect">
            {last.day === today ? `Earlier today · ${last.at}` : fmtAuWeekdayDayMonth(last.day)}
          </div>
          {/* Verbatim, and clamped in CSS rather than cut here: a debrief is
              often a paragraph, and the footer is a reminder of what you said,
              not a second copy of the record one tab across. */}
          <p className="hm-dbfsaid">{last.said}</p>
        </div>
      )}
    </div>
  );
}
