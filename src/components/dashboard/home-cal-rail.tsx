"use client";

import { useId } from "react";
import type { CalItem } from "@/lib/calendar/items";
import type { RailLists, RailRow } from "@/lib/calendar/model";
import { CalSwatch, type Pick } from "./home-cal-parts";
import { ListGroup, ListLine } from "./home-list";

/* THE RAIL, beside 4 weeks (his handoff "Calendar", and "Keep the Due",
   Isaac, 2026-09-25): Due — admin past its date first, then admin due
   inside the org's warning window, the same window the bell and the list
   warn in — and Holidays ahead, the next six public holidays and
   shutdowns (`railLists`, lib/calendar/model).

   Built from the list's own parts (./home-list: `ListGroup`, `ListLine`),
   so the rail and the list beside Diary and Tasks are one row in one
   dress. A row picks its thing: its title is pressed while that thing is
   the calendar's one choice, and the row is filled as a choice is. */

export function CalRail({
  lists,
  selected,
  onPick,
}: {
  lists: RailLists<CalItem>;
  selected: string | null;
  onPick: Pick;
}) {
  const id = useId();
  return (
    <aside className="hd-cal-rail" data-scroll="" aria-label="Due and holidays ahead">
      {lists.due.length > 0 && (
        <ListGroup id={`${id}-due`} title="Due" count={lists.due.length} tone="due">
          {lists.due.map((r) => (
            <Row key={r.item.id} row={r} round selected={selected} onPick={onPick} />
          ))}
        </ListGroup>
      )}
      {lists.holidays.length > 0 && (
        <ListGroup id={`${id}-hols`} title="Holidays ahead" tone="hol">
          {lists.holidays.map((r) => (
            <Row key={r.item.id} row={r} selected={selected} onPick={onPick} />
          ))}
        </ListGroup>
      )}
    </aside>
  );
}

function Row({
  row,
  round = false,
  selected,
  onPick,
}: {
  row: RailRow<CalItem>;
  /** Due is a dot, as the list's are; a holiday is his square. */
  round?: boolean;
  selected: string | null;
  onPick: Pick;
}) {
  const id = row.item.id;
  return (
    <ListLine
      lead={<CalSwatch cat={row.item.cat} late={row.late} round={round} />}
      title={row.title}
      open={{ onOpen: (pointer) => onPick(id, pointer), pressed: id === selected }}
      figure={row.away ? <span className="hd-cal-away">{row.away}</span> : null}
      sub={row.sub}
      subTone={row.late ? "late" : ""}
    />
  );
}
