"use client";

import Link from "next/link";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";
import { detail } from "@/lib/calendar/model";
import { actionLink } from "./home-cal-parts";

/* THE PANEL, beside Month and Year (his handoff "Calendar"): the one thing
   chosen, whichever view chose it. Never empty — before anything is
   pressed it holds the first thing from today (`firstSelection`). Its
   kicker in its category's ink, its title, when, the status in his capsule
   (a named exemption, law 26), which alone turns late for an admin date
   past its due, the sentence and the facts the calendar knows (`detail`,
   lib/calendar/model), and its action.

   It draws what the page hands it and nothing moves here: the page holds
   the thing shown while a pointer's pick fades it out, and fades the next
   one in (./home-cal-page, his calPick). */

export function CalPanel({
  item,
  items,
  frame,
}: {
  item: CalItem | null;
  items: readonly CalItem[];
  frame: CompanyCalendar;
}) {
  const d = item ? detail(item, items, frame) : null;
  if (!item || !d) return null;
  const go = actionLink(item);
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
