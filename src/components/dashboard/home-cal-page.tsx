"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { addCalendarEvent } from "@/app/actions/calendar";
import { Icon } from "@/components/shell/icon";
import { TiffBox, type BoxSaved } from "@/components/tiff/modal/tiff-box";
import type { CalCat, CompanyCalendar } from "@/lib/calendar/items";
import {
  agendaRows,
  chipCounts,
  firstSelection,
  isHome,
  monthWeeks,
  railLists,
  rangeTitle,
  revealDay,
  settleSelection,
  startNav,
  stepAnchor,
  switchView,
  viewRange,
  visibleItems,
  yearMonths,
  type CalNav,
  type CalOff,
  type CalView,
} from "@/lib/calendar/model";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import { CalAgenda } from "./home-cal-agenda";
import { CalMonth } from "./home-cal-month";
import { CalKey, CalPanel } from "./home-cal-panel";
import { CAL_FADE_MS, CalSwatch, revealIn } from "./home-cal-parts";
import { CalRail } from "./home-cal-rail";
import { CalYear } from "./home-cal-year";
import { FLASH_MS } from "./home-list";

/* THE CALENDAR — the new Home's third face (his handoff "Calendar",
   walked on the prototype to v33). It slides across the whole body, the
   diary column and the list together, and "Your day" stays above it.

   The company's twelve months from this one, and nothing personal: public
   and school holidays, the company's events and shutdowns, the
   noticeboard's events, and the renewals the viewer may see (the fleet's
   for Assets, the business's own cover for the owner). No job bookings,
   nobody's leave, nothing made up. The data is read by the new Home's
   loader (lib/calendar/query) and laid out by the model (lib/calendar/
   model); this page keeps the state and draws what the model returns.

   ITS OWN TOOLBAR, never the tabs' row (Isaac, 2026-09-25: the tabs
   "shouldn't move positions each time"): the box and the 4 weeks | Month |
   Year switch on the first row, then ‹ ›, what is in view, Today and the
   filters, which are also the legend and count what is in view.

   ONE SELECTION AND ONE SET OF FILTERS across the three views: a thing
   picked in 4 weeks is the one Month's panel shows. Before anything is
   picked the panel holds the first thing from today, and a filter that
   hides the chosen thing moves the choice to the first thing still shown.
   Navigation stays inside the twelve months: past them there is nothing
   true to show, so the arrow rests.

   THE BOX IS TIFF'S (components/tiff/modal/tiff-box), in the calendar's
   room: Save puts the words on today, all day, as typed
   (`addCalendarEvent`); Sort it out and the Tiff button ask Tiff. What was
   saved is chosen, brought into view and lit for a moment. The box is
   there for whoever may add to the calendar (`team`, as posting a notice).

   `today` is the server's — the workspace's day, the one "Your day" draws
   above — so nothing here reads a clock in render. A view, a step or a
   pick made with a pointer fades in on `--t-fast`; from the keyboard, or
   under reduced motion, it is simply there (law 8). */

const VIEWS = [
  ["4w", "4 weeks"],
  ["month", "Month"],
  ["year", "Year"],
] as const satisfies ReadonlyArray<readonly [CalView, string]>;

export function HomeCalendarPage({ cal }: { cal: CompanyCalendar }) {
  const [nav, setNav] = useState<CalNav>(() => startNav(cal));
  const [off, setOff] = useState<CalOff>({});
  /** What was picked; null until something is. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Just saved, lit until it settles. */
  const [fresh, setFresh] = useState<string | null>(null);
  /** Each counts the pointer's changes, so each one fades in. */
  const [bodyFade, setBodyFade] = useState(0);
  const [panelFade, setPanelFade] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  const vis = visibleItems(cal.items, off);
  /* The choice, while it is on the calendar and shown; otherwise the first
     thing from today — which also stands in for something just saved until
     the page brings it back. */
  const selected = picked && vis.some((x) => x.id === picked) ? picked : firstSelection(vis, cal);
  const range = viewRange(nav.view, nav.anchor, cal);
  const chips = chipCounts(cal.items, range, {
    admin: cal.items.some((x) => x.cat === "admin"),
    school: cal.hasSchool,
  });
  const earlier = stepAnchor(nav.view, nav.anchor, -1, cal);
  const later = stepAnchor(nav.view, nav.anchor, 1, cal);
  const home = isHome(nav.view, nav.anchor, cal);
  const item = selected ? (cal.items.find((x) => x.id === selected) ?? null) : null;

  const fadeBody = (pointer: boolean) => {
    if (pointer && motionAllowed()) setBodyFade((n) => n + 1);
  };

  useLayoutEffect(() => {
    if (bodyFade === 0) return;
    body.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: CAL_FADE_MS, easing: "ease-out" });
  }, [bodyFade]);

  /* A view you switch to keeps the choice in sight — Month opens on today's
     week instead (./home-cal-month). The page itself opens on today. */
  const shownView = useRef(nav.view);
  useLayoutEffect(() => {
    if (shownView.current === nav.view) return;
    shownView.current = nav.view;
    if (nav.view !== "month") revealIn(body.current?.querySelector('[aria-pressed="true"]'));
  }, [nav.view]);

  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  /* What was saved is brought into its view's sight once it is on the page
     (his calLand): the action's revalidation brings it a moment after Save,
     and a view scrolled down the weeks would otherwise light it out of
     sight. Once, so the view is the reader's again while it is still lit. */
  const shownFresh = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!fresh || shownFresh.current === fresh) return;
    const el = body.current?.querySelector("[data-fresh]");
    if (!el) return;
    shownFresh.current = fresh;
    revealIn(el);
  }, [fresh, cal.items]);

  const pick = (id: string, pointer: boolean) => {
    if (id === selected) return;
    setPicked(id);
    if (pointer && motionAllowed()) setPanelFade((n) => n + 1);
  };

  const view = (to: CalView, pointer: boolean) => {
    if (to === nav.view) return;
    setNav(switchView(nav, to, cal));
    fadeBody(pointer);
  };

  const step = (dir: -1 | 1) => (e: MouseEvent<HTMLButtonElement>) => {
    const anchor = dir < 0 ? earlier : later;
    if (!anchor) return;
    setNav({ ...nav, anchor });
    fadeBody(e.detail > 0);
  };
  const toEarlier = step(-1);
  const toLater = step(1);

  const toToday = (e: MouseEvent<HTMLButtonElement>) => {
    if (home) return;
    setNav({ ...nav, anchor: cal.today });
    fadeBody(e.detail > 0);
  };

  const filter = (cat: CalCat) => {
    const next = { ...off, [cat]: !off[cat] };
    setOff(next);
    setPicked(settleSelection(selected, visibleItems(cal.items, next), cal));
  };

  /* Save: the words on today, as typed. What landed is chosen, shown and lit
     — its filter back on, its day in view. */
  const save = async (text: string): Promise<BoxSaved> => {
    const res = await addCalendarEvent(text);
    if (!res.ok) return res;
    const id = `ev:${res.id}`;
    setPicked(id);
    setFresh(id);
    setOff((o) => ({ ...o, event: false }));
    setNav((n) => revealDay(n, res.day, cal));
    return { ok: true };
  };

  return (
    <div className="hd-cal">
      <div className="hd-cal-hd">
        {cal.canAdd && (
          <div className="hd-cal-add">
            <TiffBox room="calendar" placeholder="Add to the calendar…" save={save} />
          </div>
        )}
        <div className="hd-cal-vs" role="group" aria-label="View">
          {VIEWS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className="hd-cal-vb"
              aria-pressed={nav.view === v}
              onClick={(e) => view(v, e.detail > 0)}
            >
              {label}
              <span className="hd-cal-vbw" aria-hidden="true">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="hd-cal-tb">
        <div className="hd-cal-nav">
          <button type="button" className="hd-cal-nb" aria-label="Earlier" aria-disabled={!earlier} onClick={toEarlier}>
            <Icon name="chevL" size={16} />
          </button>
          <button type="button" className="hd-cal-nb" aria-label="Later" aria-disabled={!later} onClick={toLater}>
            <Icon name="chevR" size={16} />
          </button>
          <h2 className="hd-cal-rt" aria-live="polite">
            {rangeTitle(nav.view, nav.anchor, cal)}
          </h2>
          <button type="button" className="hd-cal-today" aria-disabled={home} onClick={toToday}>
            Today
          </button>
        </div>
        <div className="hd-cal-filters" role="group" aria-label="Show on the calendar">
          {chips.map((c) => (
            <button
              key={c.cat}
              type="button"
              className="hd-cal-filter"
              aria-pressed={!off[c.cat]}
              onClick={() => filter(c.cat)}
            >
              <CalSwatch cat={c.cat} />
              {c.label}
              {c.count !== null && <span className="hd-cal-n">{c.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="hd-cal-body" ref={body}>
        {nav.view === "4w" ? (
          <div className="hd-cal-v" data-view="4w">
            <CalAgenda rows={agendaRows(vis, nav.anchor, cal)} selected={selected} fresh={fresh} onPick={pick} />
            <CalRail lists={railLists(vis, cal, cal.warnDays)} selected={selected} onPick={pick} />
          </div>
        ) : (
          <div className="hd-cal-v" data-view={nav.view}>
            {nav.view === "month" ? (
              <CalMonth
                weeks={monthWeeks(vis, nav.anchor, cal)}
                anchor={nav.anchor}
                selected={selected}
                fresh={fresh}
                onPick={pick}
              />
            ) : (
              <CalYear months={yearMonths(vis, nav.anchor, cal)} selected={selected} onPick={pick} />
            )}
            <aside className="hd-cal-det" data-scroll="" aria-label="Details" aria-live="polite">
              <CalPanel item={item} items={cal.items} frame={cal} fade={panelFade} />
              {nav.view === "year" && <CalKey />}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
