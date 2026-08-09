import { NoteToken } from "@/components/notes/note-token";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupByDay, type JournalEntry } from "@/lib/dashboard/journal";

/* THE JOURNAL — what you told Tiff, and what it became.

   The record was always there. Every capture writes its transcript to
   `workboard_notes` before the model even runs, as the evidence for what got
   applied, and `applied` lists the rows the confirmation created. Nothing has
   ever read it back to a person. This is that reader — no new table, no change
   to the capture flow.

   EACH ENTRY IS THE WORDS, VERBATIM. Not a tidied summary: the point of
   keeping it is being able to see that Tiff heard "before Thursday" and made a
   task with a date on it. The outcomes sit underneath as quiet links in the
   card family's own link colour — never the ok-green, which this app reserves
   for state.

   NEWEST FIRST, all the way down, so what you just said is where your eye
   already is and the day you are adding to is the day on top. */

export function HomeJournal({ entries, today }: { entries: JournalEntry[]; today: string }) {
  const days = groupByDay(entries, today, fmtAuWeekdayDayMonth);

  return (
    <>
      {/* The composer. `NoteToken as="debrief"` is the same control the topbar
          button opens — one sheet, whichever door you came through. */}
      <div className="hm-comp">
        <div className="hm-compsay">
          <b>Say the day</b>
          <span>Filters, who needs what, anything you&rsquo;ll forget — it gets sorted.</span>
        </div>
        <NoteToken as="debrief" />
      </div>

      {days.length === 0 ? (
        <p className="hm-none">
          Nothing yet. Anything you tell Tiff — typed or spoken, here or from a job — lands
          here with what it turned into.
        </p>
      ) : (
        <div className="hm-jscroll">
          {days.map((d, i) => (
            <div className={"hm-jd" + (i === 0 ? " first" : "")} key={d.day}>
              <div className="hm-jdh">
                <span>{d.label}</span>
                <i className="hm-jdrule" />
                <em>
                  {d.entries.length} debrief{d.entries.length === 1 ? "" : "s"}
                </em>
              </div>
              {d.entries.map((e) => (
                <div className="hm-jr" key={e.id}>
                  <span className="hm-jrt">{e.at}</span>
                  <p className="hm-jrs">{e.said}</p>
                  {e.outcomes.length > 0 && (
                    <span className="hm-jro">
                      {e.outcomes.map((o, n) => (
                        <span key={o}>
                          {n > 0 && <i className="hm-jrdot" />}
                          {o}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
