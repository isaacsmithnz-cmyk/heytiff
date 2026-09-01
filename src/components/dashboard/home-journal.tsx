"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { NoteToken } from "@/components/notes/note-token";
import { navHref } from "@/components/shell/nav";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { groupByDay, topDayAt, type JournalEntry, type Outcome } from "@/lib/dashboard/journal";

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
   already is and the day you are adding to is the day on top.

   AND YOU MOVE THROUGH IT BY DAYS (Isaac, 2026-09-01: "you need to be able to
   scroll through the days like a real diary"). It was one long column with
   day headings buried in it, so a scroll of three months told you what was
   said and not when — the heading you needed had gone off the top four
   entries ago.

   Two halves, and they are the same idea:
   - the day heading STICKS to the top of the scroller, so the day you are
     reading is always named on screen rather than remembered;
   - a stepper moves a whole day at a time, which is what turning a page in a
     paper diary does.

   The stepper's label is not a guess. It is measured from the scroll position
   every frame it changes, so free-scrolling and stepping can never disagree
   about which day you are on — the failure a stored "current day" would have
   had the moment somebody used the scrollbar. */

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
  /* The two page destinations are asked for BY NAME rather than written out:
     the nav is where this app declares what a screen's route is, and a chip
     that hard-codes the path keeps working until the day someone moves the
     screen — then it 404s while the rail beside it goes to the right place.
     See `navHref`. */
  if (o.go?.type === "kb")
    return (
      <Link href={`${navHref("tiffkb")}?doc=${encodeURIComponent(o.go.id)}`}>
        <ChipBody o={o} />
      </Link>
    );
  if (o.go?.type === "note")
    return (
      <Link href={navHref("mynotes")}>
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

  const scroller = useRef<HTMLDivElement | null>(null);
  /* One node per day, keyed by its ISO day, populated by the ref callback
     below. A map rather than an array because `days` re-derives on every
     render and index identity would drift under it. */
  const dayNodes = useRef(new Map<string, HTMLDivElement>());
  const [atDay, setAtDay] = useState<string | null>(null);

  const holdDay = useCallback((day: string) => (el: HTMLDivElement | null) => {
    if (el) dayNodes.current.set(day, el);
    else dayNodes.current.delete(day);
  }, []);

  /* WHICH DAY IS AT THE TOP, measured rather than observed.

     THE FIRST VERSION USED AN IntersectionObserver AND WAS WRONG, in a way
     only real data showed. Its rule was "the newest day with any
     intersection" — which is correct exactly while the list is long enough
     that one day fills the viewport. Isaac's diary is three days in 433px of
     a 361px scroller: every day intersects at once, so the newest always won
     and the label never moved off the top day even scrolled to the bottom.

     Geometry has no such failure mode. The day at the top is the LAST one
     whose block has already reached the fold — one comparison per day, on a
     list that is short by definition because it is one person's record.

     rAF-throttled: a scroll handler that measures on every event forces a
     reflow per frame, and the answer cannot change faster than a frame
     anyway. In a hidden tab rAF does not run at all, so the label simply
     holds until the tab is looked at again — which is the correct amount of
     work to do for a label nobody can see, and it re-measures on the first
     scroll after. */
  const dayKeys = days.map((d) => d.day).join("|");
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const order = dayKeys ? dayKeys.split("|") : [];
      /* The RULE is in lib/dashboard/journal — pure, and tested against the
         short-list case that broke the version this replaced. All that
         happens here is reading the geometry to feed it. */
      const offsets = new Map<string, number>();
      for (const day of order) {
        const el = dayNodes.current.get(day);
        if (el) offsets.set(day, el.offsetTop);
      }
      setAtDay(topDayAt(order, offsets, root.scrollTop));
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    /* The day list as a STRING, not the array: `days` is rebuilt every render,
       so depending on it would tear down and re-attach the listener on every
       keystroke elsewhere in the card. */
  }, [dayKeys]);

  /* A WHOLE DAY AT A TIME. `-1` is up the page, which is towards TODAY
     because the record runs newest-first — so the arrow that points up moves
     you forward in time, and both are labelled in words for that reason. */
  const step = (dir: -1 | 1) => {
    const order = days.map((d) => d.day);
    const from = atDay ? order.indexOf(atDay) : 0;
    const next = order[Math.min(order.length - 1, Math.max(0, from + dir))];
    const el = next ? dayNodes.current.get(next) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const order = days.map((d) => d.day);
  const at = atDay ? order.indexOf(atDay) : 0;
  const label = days[at < 0 ? 0 : at]?.label ?? "";

  return (
    <>
      {/* THE HEADER IS THE CONTROL. Five shapes now: "Say the day" over a
          coaching line, then the day and date (which went up to the page
          head, where the screen's context belongs), then a lone glass
          capsule, then the dark debrief bar wearing the global Tiff mark
          (Isaac, 2026-08-12) — and now a dashed field with a microphone on
          it (Isaac, 2026-08-30).

          The bar left because the card went light and it was the one dark
          thing on it, and because the debrief has its own face now: this
          record is where a day's words LAND, and what it was missing was a
          way to add one from where you read them. Same flow either way —
          `NoteToken` owns both doors, and this one drops the debrief flag so
          a single thought is read as a single note. */}
      <div className="hm-head">
        <NoteToken as="entry" />
      </div>

      {/* THE PAGE TURNER. Absent below two days, because a control that can
          only ever be disabled is furniture — with one day of record there is
          nowhere to step to and the sticky heading already says the day. */}
      {days.length > 1 && (
        <div className="hm-jnav">
          {/* LEFT IS EARLIER, matching the Calendar's stepper one tab across —
              which is worth more than matching the scroll direction. The
              record runs newest-first, so earlier is DOWN the column and a
              down-arrow would have been honest about the movement and
              backwards about the time. The two steppers on one card have to
              mean the same thing by their arrows. */}
          <button
            type="button"
            className="wb2-mcarrow"
            aria-label="The day before"
            disabled={at >= days.length - 1}
            onClick={() => step(1)}
          >
            <Icon name="chevL" size={15} />
          </button>
          <b className="hm-jnavd">{label}</b>
          <button
            type="button"
            className="wb2-mcarrow"
            aria-label="The day after"
            disabled={at <= 0}
            onClick={() => step(-1)}
          >
            <Icon name="chevR" size={15} />
          </button>
        </div>
      )}

      {days.length === 0 ? (
        <p className="hm-none">
          Nothing yet. Anything you tell Tiff — typed or spoken, here or from a job — lands
          here with what it turned into.
        </p>
      ) : (
        <div className="hm-jscroll" ref={scroller}>
          {days.map((d, i) => (
            <div
              className={"hm-jd" + (i === 0 ? " first" : "")}
              key={d.day}
              data-day={d.day}
              ref={holdDay(d.day)}
            >
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
