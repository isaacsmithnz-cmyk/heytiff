"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";
import { detail } from "@/lib/calendar/model";
import { CalEdit } from "./home-cal-edit";
import { actionLink } from "./home-cal-parts";

/* THE PANEL, beside Month and Year (his handoff "Calendar"): the one thing
   chosen, whichever view chose it. Never empty — before anything is
   pressed it holds the first thing from today (`firstSelection`). Its
   kicker in its category's ink, its title, when, the status in his capsule
   (a named exemption, law 26), which alone turns late for an admin date
   past its due, the sentence and the facts the calendar knows (`detail`,
   lib/calendar/model), and its action: a link for what lives elsewhere, or
   Edit for the company's own events, to whoever may add to the calendar.

   It draws what the page hands it and nothing moves here: the page holds
   the thing shown while a pointer's pick fades it out, and fades the next
   one in (./home-cal-page, his calPick). */

export function CalPanel({
  item,
  items,
  frame,
  canEdit = false,
  onDeleted,
}: {
  item: CalItem | null;
  items: readonly CalItem[];
  frame: CompanyCalendar;
  /** Whoever may add to the calendar may change what the company put on it. */
  canEdit?: boolean;
  /** A delete went in: the form, and the Edit that opened it, are gone, so
      the page says where focus goes. */
  onDeleted?: () => void;
}) {
  /* EDIT OPENS THE FORM IN PLACE (./home-cal-edit), for the one thing it
     was pressed on, and choosing something else closes it: the form is let
     go as the panel moves on, so choosing that thing again shows it, never
     the form it had (nor the form's pull on focus). Closed by Save or
     Cancel, focus goes back to Edit; after a delete there is no Edit left,
     and the page takes it. */
  const [editing, setEditing] = useState<string | null>(null);
  if (editing !== null && item?.id !== editing) setEditing(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const backToEdit = useRef(false);
  useLayoutEffect(() => {
    if (editing !== null || !backToEdit.current) return;
    backToEdit.current = false;
    editButton.current?.focus({ preventScroll: true });
  }, [editing]);

  const d = item ? detail(item, items, frame) : null;
  if (!item || !d) return null;
  const go = actionLink(item);
  const editable = canEdit && item.action === "edit";
  if (editable && editing === item.id) {
    return (
      <div className="hd-cal-dx" data-c={item.cat}>
        <CalEdit
          item={item}
          items={items}
          frame={frame}
          kicker={d.kicker}
          onDone={(how) => {
            backToEdit.current = how !== "deleted";
            if (how === "deleted") onDeleted?.();
            setEditing(null);
          }}
        />
      </div>
    );
  }
  return (
    <div className="hd-cal-dx" data-c={item.cat}>
      <div className="hd-cal-dxh">
        <span className="hd-cal-k">{d.kicker}</span>
        <h3 className="hd-cal-dxt">{item.title}</h3>
        <div className="hd-cal-w">{d.when}</div>
        <span className="hd-cal-chip" data-tone={d.status.tone} data-c={item.cat}>
          {d.status.text}
        </span>
      </div>
      {d.description && <p className="hd-cal-desc">{d.description}</p>}
      {d.facts.length > 0 && (
        <dl className="hd-cal-facts">
          {d.facts.map(([k, v], i) => (
            <div key={`${i}:${k}`}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {go && (
        <div className="hd-cal-acts">
          <Link className="hd-cal-go" href={go.href}>
            {go.label}
          </Link>
        </div>
      )}
      {editable && (
        <div className="hd-cal-acts">
          <button type="button" className="hd-cal-go" ref={editButton} onClick={() => setEditing(item.id)}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

/* THE KEY, at the foot of Year's panel: what each fill and dot means. His
   swatches, sharp (a key on a drawing has corners). */
const KEY = [
  ["hol", "Public holiday"],
  ["shutdown", "Shutdown"],
  ["school", "School holidays"],
  ["event", "Event"],
  ["admin", "Admin due"],
  ["late", "Admin overdue"],
] as const;

export function CalKey() {
  return (
    <ul className="hd-cal-key" aria-label="Key">
      {KEY.map(([k, label]) => (
        <li key={k} className="hd-cal-ki">
          <span className="hd-cal-ks" data-k={k} aria-hidden="true">
            {(k === "event" || k === "admin" || k === "late") && <i />}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}
