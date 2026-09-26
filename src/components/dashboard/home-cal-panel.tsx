"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import type { CalItem, CompanyCalendar } from "@/lib/calendar/items";
import { detail } from "@/lib/calendar/model";
import { actionLink, CAL_FADE_MS } from "./home-cal-parts";

/* THE PANEL, beside Month and Year (his handoff "Calendar"): the one thing
   chosen, whichever view chose it. Never empty — before anything is
   pressed it holds the first thing from today (`firstSelection`). Its
   kicker, its title, when, the status in his capsule (a named exemption,
   law 26), the sentence and the facts the calendar knows (`detail`,
   lib/calendar/model), and its action.

   A thing picked with a pointer while the panel is up fades in
   (`--t-fast`); one picked from the keyboard, or under reduced motion, is
   simply there (law 8). The panel coming up is not a pick: it opens with
   Month or Year, which fade in themselves for a pointer and not for a key,
   so the picks counted before it came up (in 4 weeks, which has no panel)
   are what it starts from, never a reason to fade. */

export function CalPanel({
  item,
  items,
  frame,
  fade,
}: {
  item: CalItem | null;
  items: readonly CalItem[];
  frame: CompanyCalendar;
  /** Counts up for every pick a pointer made: each one fades in. */
  fade: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  /** The count the panel has already shown. */
  const seen = useRef(fade);
  useLayoutEffect(() => {
    if (fade === seen.current) return;
    seen.current = fade;
    box.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: CAL_FADE_MS, easing: "ease-out" });
  }, [fade]);

  const d = item ? detail(item, items, frame) : null;
  if (!item || !d) return null;
  const go = actionLink(item);
  return (
    <div className="hd-cal-dx" ref={box} data-c={item.cat} data-late={item.overdue ? "" : undefined}>
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
