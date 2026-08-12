import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { NoteToken } from "@/components/notes/note-token";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupByDay, type JournalEntry, type Outcome } from "@/lib/dashboard/journal";

/* THE JOURNAL — what you told Tiff, and what it became.

   The record was always there. Every capture writes its transcript to
   `workboard_notes` before the model even runs, as the evidence for what got
   applied, and `applied` lists the rows the confirmation created. Nothing has
   ever read it back to a person. This is that reader — no new table, no change
   to the capture flow.

   EACH ENTRY IS THE WORDS, VERBATIM. Not a tidied summary: the point of
   keeping it is being able to see that Tiff heard "before Thursday" and made a
   task with a date on it.

   THE OUTCOMES ARE THE PAYOFF, so they are chips rather than the 12.5px text
   they used to be — the proof of work was the quietest thing in the entry.
   They wear ONE colour, the dusk skin's teal now the card is ink: ok-green,
   warn and danger mean state in this app and may not be spent on a category.
   The glyph is the only thing that varies, and only two ways — see
   `OutcomeKind`.

   A CHIP IS THE THING IT NAMES. "2 tasks" proved the capture worked and then
   left you to go and find them; now each row that still exists is its own chip
   wearing its own title, and pressing it lands on the row. Only the two groups
   with a real destination link — see `describeAppliedResolved` for why a flag
   and an issue deliberately stay counts.

   NEWEST FIRST, all the way down, so what you just said is where your eye
   already is and the day you are adding to is the day on top. */

/* The chip's inside is the same three parts however it is pressed, so the
   glyph and the words are written once and the element around them changes. */
function ChipBody({ o }: { o: Outcome }) {
  return (
    <>
      <Icon name={o.kind === "todo" ? "check" : "note"} size={12} />
      {o.text}
    </>
  );
}

function OutcomeChip({ o, onOpenTask }: { o: Outcome; onOpenTask?: (id: string) => void }) {
  /* A task is not a page — it is a row on the tab next door — so its chip is a
     button that moves the card, not a link that reloads the screen. */
  if (o.go?.type === "task" && onOpenTask) {
    const id = o.go.id;
    return (
      <button type="button" onClick={() => onOpenTask(id)}>
        <ChipBody o={o} />
      </button>
    );
  }
  if (o.go?.type === "kb")
    return (
      <Link href={`/dashboard/tiff/library?doc=${encodeURIComponent(o.go.id)}`}>
        <ChipBody o={o} />
      </Link>
    );
  if (o.go?.type === "note")
    return (
      <Link href="/dashboard/my-notes">
        <ChipBody o={o} />
      </Link>
    );
  return (
    <span>
      <ChipBody o={o} />
    </span>
  );
}

export function HomeJournal({
  entries,
  today,
  onOpenTask,
}: {
  entries: JournalEntry[];
  today: string;
  /** Given by Home: switches to the Tasks tab and flashes the row. */
  onOpenTask?: (id: string) => void;
}) {
  const days = groupByDay(entries, today, fmtAuWeekdayDayMonth);

  return (
    <>
      {/* THE HEADER IS THE CONTROL. Four shapes now: "Say the day" over a
          coaching line, then the day and date (which went up to the page
          head, where the screen's context belongs), then a lone glass
          capsule — and now a bar that IS the button, wearing the global Tiff
          mark (Isaac, 2026-08-12).

          The capsule died of its own material: it was the topbar button's
          glass, which composites to 1.29:1 against this card, so all that
          showed was a gradient rim the card already wears. `NoteToken` owns
          the whole row now — same sheet, whichever door you came through. */}
      <div className="hm-head">
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
              {/* The day and a rule. It used to end in "2 debriefs", which
                  counted the rows you were already looking at — the entries
                  are right there under it, numbered by their own timestamps
                  (Isaac, 2026-08-12). */}
              <div className="hm-jdh">
                <span>{d.label}</span>
                <i className="hm-jdrule" />
              </div>
              {d.entries.map((e) => (
                <div className="hm-jr" key={e.id}>
                  <span className="hm-jrt">{e.at}</span>
                  <p className="hm-jrs">{e.said}</p>
                  {e.outcomes.length > 0 && (
                    <span className="hm-jro">
                      {e.outcomes.map((o, i) => (
                        // by index: two tasks may honestly carry the same title
                        <OutcomeChip key={i} o={o} onOpenTask={onOpenTask} />
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
