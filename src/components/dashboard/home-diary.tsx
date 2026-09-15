"use client";

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { NoteToken } from "@/components/notes/note-token";
import { navHref } from "@/components/shell/nav";
import { fmtAuWeekdayDateLong, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import {
  agoLabel,
  groupByDay,
  outcomeSummary,
  type JournalEntry,
  type Outcome,
} from "@/lib/dashboard/journal";

/* THE DIARY — what you told Tiff, and what it became.

   The record was always there. Every capture writes its transcript to
   `workboard_notes` before the model even runs, and `applied` lists the rows
   the confirmation created. This is the reader: no new table, no change to
   the capture flow.

   A LIST BESIDE A PAGE (the three-room handoff, 2026-09-14). It was one
   scrolling column with sticky day headings and a stepper to turn the days.
   Now the column is an index — the day, the time, two lines of the words, and
   one quiet line saying what the entry made — and the entry you have chosen
   is read in full beside it, at reading size, with what it became as doors
   under it. The index is newest first, all the way down, so what you just
   said is where your eye already is.

   EACH ENTRY IS THE WORDS, VERBATIM. Not a tidied summary: the point of
   keeping it is being able to see that Tiff heard "before Thursday" and made
   a task with a date on it.

   THE DOORS ARE THE PAYOFF. A chip that is the thing it names — a task is a
   row on the face next door and its chip moves the card there; a knowledge
   entry and a kept note are pages, so those are links. What has nowhere to go
   is a word, and a task that has since been deleted collapses to "1 task
   removed", never a dead door (see `describeAppliedResolved`).

   THE COMPOSER IS THE SAME DOOR IT ALWAYS WAS. `NoteToken` owns it: typing
   opens the sheet, the mic is Talk in the same press, and the router decides
   whether the words are a note or a task, with the review before anything is
   saved. */

/* The chip's inside is the same two parts however it is pressed, so the glyph
   and the words are written once and the element around them changes. */
function DoorBody({ o }: { o: Outcome }) {
  return (
    <>
      <Icon name={o.kind === "todo" ? "check" : "note"} size={12} />
      {o.text}
    </>
  );
}

function OutcomeDoor({
  o,
  onOpenTask,
  onOpenIssue,
}: {
  o: Outcome;
  onOpenTask?: (id: string) => void;
  onOpenIssue?: (id: string) => void;
}) {
  /* A task is not a page — it is a row on the face next door — so its door
     is a button that moves the card, not a link that reloads the screen. An
     issue is the same kind of row, on the same face, since 2026-09-15. */
  if (o.go?.type === "task" && onOpenTask) {
    const id = o.go.id;
    return (
      <button type="button" className="hm-door" onClick={() => onOpenTask(id)}>
        <DoorBody o={o} />
      </button>
    );
  }
  if (o.go?.type === "issue" && onOpenIssue) {
    const id = o.go.id;
    return (
      <button type="button" className="hm-door" onClick={() => onOpenIssue(id)}>
        <span className="hm-idot" aria-hidden="true" />
        {o.text}
      </button>
    );
  }
  /* The two page destinations are asked for BY NAME rather than written out:
     the nav is where this app declares what a screen's route is, and a door
     that hard-codes the path keeps working until the day someone moves the
     screen. See `navHref`. */
  if (o.go?.type === "kb")
    return (
      <Link className="hm-door" href={`${navHref("tiffkb")}?doc=${encodeURIComponent(o.go.id)}`}>
        <DoorBody o={o} />
      </Link>
    );
  if (o.go?.type === "note")
    return (
      <Link className="hm-door" href={navHref("mynotes")}>
        <DoorBody o={o} />
      </Link>
    );
  return <span className="hm-word">{o.text}</span>;
}

export function HomeDiary({
  entries,
  today,
  selectedId,
  onSelect,
  onOpenTask,
  onOpenIssue,
}: {
  entries: JournalEntry[];
  today: string;
  /** Which entry the pane is reading; null reads the newest. Owned by Home,
      so a task's "Open in diary" can choose one from the face next door. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Given by Home: switches to the Tasks face and marks the row. */
  onOpenTask?: (id: string) => void;
  /** The same door for an issue, which lives on the same face. */
  onOpenIssue?: (id: string) => void;
}) {
  /* "Today" and "Yesterday" earn their names; older days say their date.
     The same labelling the debrief log uses, so one rule names a day. */
  const dayLabel = new Map(
    groupByDay(entries, today, fmtAuWeekdayDayMonth).map((d) => [d.day, d.label]),
  );
  const selected = entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;

  return (
    <>
      <div className="hm-list">
        <div className="hm-lhead">
          <div className="hm-lt">
            <h2>Diary</h2>
            <span className="hm-lc">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <NoteToken as="entry" />
        </div>

        {entries.length === 0 ? (
          <p className="hm-none">
            Nothing yet. Anything you tell Tiff — typed or spoken, here or from a job — lands
            here with what it turned into.
          </p>
        ) : (
          <ul className="hm-rows" aria-label="Entries">
            {entries.map((e) => {
              const on = selected?.id === e.id;
              const made = outcomeSummary(e.outcomes);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={"hm-row" + (on ? " on" : "")}
                    aria-current={on ? "true" : undefined}
                    onClick={() => onSelect(e.id)}
                  >
                    <span className="hm-rowm">
                      <span>{dayLabel.get(e.day)}</span>
                      <span>{e.at}</span>
                    </span>
                    <p className="hm-rowp">{e.said}</p>
                    {made && <span className="hm-rowo">{made}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <article className="hm-read" aria-label="The entry">
        {selected && (
          <>
            <p className="hm-said">{selected.said}</p>
            {/* UNDER THE WORDS, NOT OVER THEM. The date was a tracked label
                above the entry in the handoff; the eyebrow is retired (law
                10), so what it said sits under the text as a sentence with
                its figures. "Spoken" is a fact the entry carries. */}
            <p className="hm-when">
              {fmtAuWeekdayDateLong(selected.day)} at {selected.at}, {agoLabel(selected.day, today)}.{" "}
              {selected.spoken ? "Spoken" : "Typed"}.
            </p>
            {selected.outcomes.length > 0 && (
              <div className="hm-group">
                <span className="hm-gl">From this note</span>
                <div className="hm-doors">
                  {selected.outcomes.map((o, i) => (
                    // by index: two tasks may honestly carry the same title
                    <OutcomeDoor key={i} o={o} onOpenTask={onOpenTask} onOpenIssue={onOpenIssue} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </article>
    </>
  );
}
