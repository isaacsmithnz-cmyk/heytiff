"use client";

import { NoteToken } from "@/components/notes/note-token";
import { debriefVoice, type DayPhase } from "@/lib/dashboard/debrief-voice";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupByDay, type JournalEntry } from "@/lib/dashboard/journal";

/* THE DEBRIEF, ON ITS OWN FACE.

   It used to be a bar at the top of the Journal — the one dark thing on a
   daylight card, sitting above the record it produces. As a tab it gets to be
   what it actually is: a room you go into to talk, with one question in it.

   THE QUESTION FOLLOWS THE HOUR. Same flow, same button, same lane in the
   model — but "How did today go?" at six in the morning is the wrong
   question, and the same control gets pressed at both ends of a day. The
   phase is resolved by the loader in the workspace's zone (see
   lib/dashboard/debrief-voice), never from a clock read in a render body.

   AND NOW IT KEEPS THEM (Isaac, 2026-09-01: "you should be able to see all of
   your previous debriefs"). It showed exactly one — the newest thing in the
   diary, which was not even necessarily a debrief. It could not do better,
   because nothing recorded which door a note came through: `routeNote` took a
   `debrief` flag, used it to decide what to ask the model, and threw it away.
   `is_debrief` keeps it now (docs/migrations/note_is_debrief.sql), so this is
   a log of the times you actually sat down and talked.

   WHAT IT IS NOT is a second copy of the Diary. The diary is everything you
   ever told Tiff, newest first, with what each note became. This is the
   narrower thing: the debriefs, verbatim, under the day they belong to. If
   this face ever starts growing chips and doors it has stopped being a record
   of conversations and become the tab next door. */

export function HomeDebrief({
  phase,
  debriefs,
  today,
}: {
  phase: DayPhase;
  /** Every debrief this person has filed, newest first. */
  debriefs: JournalEntry[];
  today: string;
}) {
  const voice = debriefVoice(phase);
  const days = groupByDay(debriefs, today, fmtAuWeekdayDayMonth);

  return (
    <div className="hm-dbf">
      <h2 className="hm-dbft">{voice.title}</h2>

      <NoteToken as="debrief" cta={voice.cta} />

      {days.length > 0 && (
        <div className="hm-dbflog">
          {/* NAMED, because a list of past conversations appearing under a
              button to start a new one is otherwise just "more words". The
              heading is the only thing on this face that explains the shape
              of what is under it, and it earns its place by saying what the
              rows ARE rather than how to use them. */}
          <div className="wb2-sect">Debriefs you&rsquo;ve filed</div>

          {days.map((d) => (
            <div className="hm-dbfday" key={d.day}>
              <div className="hm-dbfdh">{d.label}</div>
              {d.entries.map((e) => (
                <div className="hm-dbfe" key={e.id}>
                  <span className="hm-dbfet">{e.at}</span>
                  {/* Verbatim and in full. A debrief is often a paragraph, and
                      the point of keeping it is being able to read back what
                      you actually said — a clamp here would make the record
                      less useful than the thing it is a record of. */}
                  <p className="hm-dbfsaid">{e.said}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
