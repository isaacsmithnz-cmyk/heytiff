"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { addCalendarEvent } from "@/app/actions/calendar";
import { Icon } from "@/components/shell/icon";
import { TiffBox, type BoxSaved } from "@/components/tiff/modal/tiff-box";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import type { CalCat, CompanyCalendar } from "@/lib/calendar/items";
import { landedEvent } from "@/lib/calendar/line";
import {
  addDayOf,
  agendaRows,
  chipCounts,
  choiceOf,
  dayDetail,
  fmtDay,
  isHome,
  monthWeeks,
  railLists,
  rangeTitle,
  revealDay,
  sameChoice,
  settleChoice,
  startNav,
  stepAnchor,
  switchView,
  viewRange,
  visibleItems,
  yearMonths,
  type CalNav,
  type CalOff,
  type CalSel,
  type CalView,
} from "@/lib/calendar/model";
import { motionAllowed } from "@/lib/dashboard/day-flip";
import { CalAgenda } from "./home-cal-agenda";
import { CalMonth } from "./home-cal-month";
import { CalDay, CalKey, CalPanel } from "./home-cal-panel";
import { CAL_FRESH_MS, CAL_RISE_PX, CalSwatch, fadeIn, fadeOut, growIn, revealIn, thingsOf } from "./home-cal-parts";
import { CalRail } from "./home-cal-rail";
import { CalYear } from "./home-cal-year";

/* THE CALENDAR — the new Home's third face (his handoff "Calendar",
   walked on the prototype to v33). It slides across the whole body, the
   diary column and the list together, and "Your day" steps aside for it.

   The company's twelve months from this one, and nothing personal: public
   and school holidays, the company's events and shutdowns, the
   noticeboard's events, and the renewals the viewer may see (the fleet's
   for Assets, the business's own cover for the owner). No job bookings,
   nobody's leave, nothing made up. The data is read by the new Home's
   loader (lib/calendar/query) and laid out by the model (lib/calendar/
   model); this page keeps the state and draws what the model returns.

   ITS OWN TOOLBAR, never the tabs' row (Isaac, 2026-09-25: the tabs
   "shouldn't move positions each time"), and one row: ‹ ›, what is in
   view and Today, then the filters, which are also the legend and count
   what is in view, then 4 weeks | Month | Year at its end.

   YOU CLICK A DAY AND ADD TO IT (Isaac, 2026-09-26, walking it: "if you
   type something in, it just adds it on to today. There's no way to select
   different days to add different things to them", and then, "simplify
   it. how does a calendar normally add things in?"). The choice is a thing
   or a day (lib/calendar/model `CalSel`), ONE
   across the three views: a press on a day — Month's cell, Year's day, 4
   weeks' row — picks the day, and Month and Year's panel shows it, with
   everything on it; a press on a thing picks the thing, as it always has.
   Before anything is picked the panel holds the first thing from today,
   and a filter that hides the thing chosen moves the choice to the first
   thing still shown; a day picked stays picked whatever the filters hide.
   Navigation stays inside the twelve months: past them there is nothing
   true to show, so the arrow rests.

   THE BOX IS TIFF'S (components/tiff/modal/tiff-box), in the calendar's
   room, at the top of the right-hand column in every view — over the rail
   beside 4 weeks, over the panel beside Month and Year — and it says the
   day it adds to (`addDayOf`): the day picked, else the first day of the
   thing picked, else today, the server's, as "Add to Thu 1 Oct…" or "Add
   to today…". Save, or Enter, puts the words on that day, all day, as
   typed (`addCalendarEvent`); Sort it out and the Tiff button ask Tiff,
   who reads the line for the calendar — "toolbox talk every first
   Thursday" goes on as eleven dates, and a line that names no day goes on
   the box's (`fileCalendarLine`). What was saved, or what Tiff put on, is
   brought into view and lit for his 2.4 s, and chosen — unless it landed
   on the day picked, which stays picked with the new thing lit in its
   list, so a day takes one thing after another. A pointer's press on a day
   puts the caret in the box; a key leaves focus where it is. The box, and
   Edit in the panel, are there for whoever may add to the calendar
   (`team`, as posting a notice).

   `today` is the server's — the workspace's day, the one "Your day" draws
   above — so nothing here reads a clock in render.

   HIS MOTION, for a pointer (./home-cal-parts; a named exemption from law
   18's tokens, docs/design.md). A view, a step or Today: the toolbar says
   where you are going at once, the body fades out, and the new one fades
   in rising into place (calSwap). A pick while the panel is up, a thing or
   a day: the panel fades out what it showed and fades the pick in
   (calPick), while the views show the pick at once. A filter turned off:
   its things fade out, then the view closes up; back on, they fade in
   where they belong (calChip). What Save lands grows in and is washed
   (calLand). From the keyboard, or under reduced motion, each is simply
   there (law 8), and anything pressed while a fade is on its way lands it
   at once first, so nothing is ever drawn from what was about to change. */

const VIEWS = [
  ["4w", "4 weeks"],
  ["month", "Month"],
  ["year", "Year"],
] as const satisfies ReadonlyArray<readonly [CalView, string]>;

/** A fade on its way: its animations, what it puts down when it ends, and
    the token a later change bumps to overtake it. */
type Run = { tok: number; anims: Animation[]; land: (() => void) | null };

const run0 = (): Run => ({ tok: 0, anims: [], land: null });

/** Lands a fade on its way at once: its animations come off and what it was
    bringing is put down now. */
function hurry(run: Run) {
  run.tok += 1;
  for (const a of run.anims) a.cancel();
  run.anims = [];
  const land = run.land;
  run.land = null;
  land?.();
}

/** When the fade out ends, unless something overtook it: what it brought is
    put down, and `then` starts what comes in. Its own animations stay on
    (they hold what left at nothing) until the fade in takes them off. */
function whenOut(run: Run, then: () => void) {
  const tok = run.tok;
  Promise.all(run.anims.map((a) => a.finished)).then(
    () => {
      if (run.tok !== tok) return;
      const land = run.land;
      run.land = null;
      land?.();
      then();
    },
    () => {},
  );
}

export function HomeCalendarPage({ cal }: { cal: CompanyCalendar }) {
  const tiff = useTiff();
  /** Where the body is. */
  const [nav, setNav] = useState<CalNav>(() => startNav(cal));
  /** Where a pointer's view, step or Today is going while the body fades
      out: the toolbar says it at once (his calChrome). */
  const [ahead, setAhead] = useState<CalNav | null>(null);
  /** What the filters say. */
  const [off, setOff] = useState<CalOff>({});
  /** What the body still draws while a filter's things fade out. */
  const [offHeld, setOffHeld] = useState<CalOff | null>(null);
  /** What was picked, a thing or a day; null until something is. */
  const [picked, setPicked] = useState<CalSel | null>(null);
  /** What the panel still shows while it fades out for a pointer's pick. */
  const [panelHeld, setPanelHeld] = useState<CalSel | null>(null);
  /** Just saved, or just put on by Tiff (every date of a repeat), lit
      until it settles. */
  const [fresh, setFresh] = useState<readonly string[] | null>(null);
  /** Each counts a fade in to start once the page has drawn what comes in:
      the body's, the panel's, and a filter's (its category, or null when
      only the faded things are to come off). */
  const [bodyIn, setBodyIn] = useState(0);
  const [panelIn, setPanelIn] = useState(0);
  const [filterIn, setFilterIn] = useState<{ n: number; cat: CalCat | null }>({ n: 0, cat: null });
  const body = useRef<HTMLDivElement>(null);
  const details = useRef<HTMLElement>(null);
  /** The box's own column, where a pointer's day puts the caret. */
  const add = useRef<HTMLDivElement>(null);
  const swapRun = useRef<Run>(run0());
  const panelRun = useRef<Run>(run0());
  const filterRun = useRef<Run>(run0());
  /** The choice a filter on its way will leave, once it lands. */
  const filterPick = useRef<{ sel: CalSel | null } | null>(null);
  /** How the box was last pressed: a Save from the keyboard lands still. */
  const press = useRef<"pointer" | "key">("key");
  /** Whether what Save lands grows in. */
  const landGrow = useRef(false);
  /** What the modal last said it filed, what of it the calendar is still
      waiting for, and a count of the landings that came while a fade was
      on its way. */
  const [landedSeen, setLandedSeen] = useState(tiff.landed);
  const [landing, setLanding] = useState<readonly string[] | null>(null);
  const [overtaken, setOvertaken] = useState(0);

  /** The toolbar's: where the page is, or is going. */
  const bar = ahead ?? nav;
  const vis = visibleItems(cal.items, offHeld ?? off);
  /* The choice as it is drawn: the day or the thing picked, or the first
     thing from today — which also stands in for something just saved until
     the page brings it back. */
  const chosen = choiceOf(picked, vis, cal);
  const selected = chosen && "id" in chosen ? chosen.id : null;
  const chosenDay = chosen && "day" in chosen ? chosen.day : null;
  /* The day the box adds to, and says it does. */
  const addTo = addDayOf(chosen, vis, cal);
  const range = viewRange(bar.view, bar.anchor, cal);
  const chips = chipCounts(cal.items, range, {
    admin: cal.items.some((x) => x.cat === "admin"),
    school: cal.hasSchool,
  });
  const earlier = stepAnchor(bar.view, bar.anchor, -1, cal);
  const later = stepAnchor(bar.view, bar.anchor, 1, cal);
  const home = isHome(bar.view, bar.anchor, cal);
  const shown = panelHeld ?? chosen;
  const shownDay = shown && "day" in shown ? dayDetail(vis, shown.day) : null;
  const item = shown && "id" in shown ? (cal.items.find((x) => x.id === shown.id) ?? null) : null;

  /* What comes in fades in once it is drawn, and takes off the fade out
     that held what left at nothing, in the same frame. */
  useLayoutEffect(() => {
    if (bodyIn === 0) return;
    const run = swapRun.current;
    for (const a of run.anims) a.cancel();
    run.anims = body.current ? [fadeIn(body.current, CAL_RISE_PX)] : [];
  }, [bodyIn]);

  useLayoutEffect(() => {
    if (panelIn === 0) return;
    const run = panelRun.current;
    for (const a of run.anims) a.cancel();
    const dx = body.current?.querySelector(".hd-cal-dx");
    run.anims = dx ? [fadeIn(dx, CAL_RISE_PX)] : [];
  }, [panelIn]);

  useLayoutEffect(() => {
    if (filterIn.n === 0) return;
    const run = filterRun.current;
    for (const a of run.anims) a.cancel();
    run.anims = filterIn.cat ? thingsOf(body.current, filterIn.cat).map((el) => fadeIn(el, 0)) : [];
  }, [filterIn]);

  /* Nothing on its way outlives the page. */
  useEffect(() => {
    const runs = [swapRun.current, panelRun.current, filterRun.current];
    return () => {
      for (const run of runs) {
        run.tok += 1;
        run.land = null;
        for (const a of run.anims) a.cancel();
        run.anims = [];
      }
    };
  }, []);

  /* A landing of Tiff's put down what was on its way as it was drawn (see
     below): its fades come off here, and nothing is left to put down after
     it. Before the landing is brought into sight, so nothing a Save still
     waiting armed grows it. */
  useLayoutEffect(() => {
    if (overtaken === 0) return;
    filterPick.current = null;
    landGrow.current = false;
    for (const run of [swapRun.current, panelRun.current, filterRun.current]) {
      run.tok += 1;
      run.land = null;
      for (const a of run.anims) a.cancel();
      run.anims = [];
    }
  }, [overtaken]);

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
    const t = setTimeout(() => setFresh(null), CAL_FRESH_MS);
    return () => clearTimeout(t);
  }, [fresh]);

  /* What was saved is brought into its view's sight once it is on the page
     (his calLand): the action's revalidation brings it a moment after Save,
     and a view scrolled down the weeks would otherwise light it out of
     sight. Once, so the view is the reader's again while it is still lit.
     Of a repeat's lit dates the first drawn is the earliest, the one
     chosen: every view draws its days in order, before the panel beside
     it, which lights it in a day's list where the view has no row for it
     (Year). A row saved with a pointer grows in as it lands. */
  const shownFresh = useRef<readonly string[] | null>(null);
  useLayoutEffect(() => {
    if (!fresh || shownFresh.current === fresh) return;
    const el = body.current?.querySelector<HTMLElement>("[data-fresh]");
    if (!el) return;
    shownFresh.current = fresh;
    revealIn(el);
    if (landGrow.current && el.matches(".hd-cal-it")) growIn(el);
    landGrow.current = false;
  }, [fresh, cal.items]);

  /** Lands a filter on its way now, and says the choice it leaves. */
  const hurryFilter = (): CalSel | null => {
    const left = filterPick.current ? filterPick.current.sel : chosen;
    filterPick.current = null;
    hurry(filterRun.current);
    return left;
  };

  /** The body goes to `next`: at once from a key or under reduced motion;
      for a pointer, his swap. */
  const go = (next: CalNav, pointer: boolean) => {
    const run = swapRun.current;
    hurry(run);
    hurry(panelRun.current);
    hurryFilter();
    const el = body.current;
    if (!pointer || !motionAllowed() || !el) {
      setAhead(null);
      setNav(next);
      return;
    }
    setAhead(next);
    run.anims = [fadeOut(el)];
    run.land = () => {
      setAhead(null);
      setNav(next);
    };
    whenOut(run, () => setBodyIn((n) => n + 1));
  };

  /** A thing or a day, chosen. */
  const pick = (next: CalSel, pointer: boolean) => {
    if (sameChoice(next, chosen)) {
      /* The page's own choice, pressed: it is yours now, and the box adds
         to its day. Nothing on screen moves. */
      if ("id" in next && chosen && "id" in chosen && chosen.settled) setPicked(next);
      return;
    }
    const run = panelRun.current;
    hurry(run);
    /* A filter on its way lands first; what the panel shows then is its
       choice, not this page's, so the pick is simply there. */
    const filtering = filterRun.current.land !== null;
    hurryFilter();
    setPicked(next);
    const dx = body.current?.querySelector(".hd-cal-dx");
    /* In 4 weeks there is no panel; while a view is on its way in, the
       panel goes with it. */
    if (!pointer || !motionAllowed() || !dx || swapRun.current.land || filtering) return;
    setPanelHeld(shown);
    run.anims = [fadeOut(dx)];
    run.land = () => setPanelHeld(null);
    whenOut(run, () => setPanelIn((n) => n + 1));
  };

  const pickThing = (id: string, pointer: boolean) => pick({ id }, pointer);

  /** A day: chosen, and, pressed with a pointer, the caret in the box, so
      what is typed next goes on it (a quick add). A key leaves focus where
      it is. */
  const pickDay = (day: string, pointer: boolean) => {
    pick({ day }, pointer);
    if (pointer) add.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  /** A thing picked from a day's list in the panel: the row pressed goes
      with the list, so the panel's own column takes focus. */
  const pickFromDay = (id: string, pointer: boolean) => {
    pick({ id }, pointer);
    details.current?.focus({ preventScroll: true });
  };

  const view = (to: CalView, pointer: boolean) => {
    if (to === bar.view) return;
    go(switchView(bar, to, cal), pointer);
  };

  const toEarlier = (e: MouseEvent<HTMLButtonElement>) => {
    if (earlier) go({ ...bar, anchor: earlier }, e.detail > 0);
  };
  const toLater = (e: MouseEvent<HTMLButtonElement>) => {
    if (later) go({ ...bar, anchor: later }, e.detail > 0);
  };

  const toToday = (e: MouseEvent<HTMLButtonElement>) => {
    if (home) return;
    go({ ...bar, anchor: cal.today }, e.detail > 0);
  };

  const filter = (cat: CalCat, pointer: boolean) => {
    const from = hurryFilter();
    hurry(panelRun.current);
    const next = { ...off, [cat]: !off[cat] };
    const settled = settleChoice(from, visibleItems(cal.items, next), cal);
    setOff(next);
    /* While a view is on its way in, it draws with the filter as it now
       stands (his calChip). */
    const moving = pointer && motionAllowed() && !swapRun.current.land;
    const leaving = moving && next[cat] ? thingsOf(body.current, cat) : [];
    if (leaving.length > 0) {
      const run = filterRun.current;
      setOffHeld(off);
      filterPick.current = { sel: settled };
      run.anims = leaving.map(fadeOut);
      run.land = () => {
        setOffHeld(null);
        setPicked(settled);
      };
      whenOut(run, () => {
        filterPick.current = null;
        setFilterIn((f) => ({ n: f.n + 1, cat: null }));
      });
      return;
    }
    setPicked(settled);
    if (moving && !next[cat]) setFilterIn((f) => ({ n: f.n + 1, cat }));
  };

  /** What landed is shown and lit — its filter back on, its day in view —
      and chosen, unless it landed on the day picked: the day stays picked,
      and the new thing is lit in its list, so the next thing typed goes on
      the same day. `lit` is everything that landed with it: every date of a
      repeat Tiff put on is lit, and only the first is chosen (his calLand).
      State only, so a landing found while drawing can call it. */
  const land = (id: string, day: string, lit: readonly string[] = [id]) => {
    setPicked((p) => (p && "day" in p && p.day === day ? p : { id }));
    setFresh(lit);
    setOff((o) => ({ ...o, event: false }));
    setNav((n) => revealDay(n, day, cal));
  };

  /* Save, or Enter: the words on the box's day, as typed. Anything on its
     way lands first. */
  const save = async (text: string): Promise<BoxSaved> => {
    const grow = press.current === "pointer" && motionAllowed();
    const res = await addCalendarEvent(text, addTo);
    if (!res.ok) return res;
    hurry(swapRun.current);
    hurry(panelRun.current);
    hurryFilter();
    landGrow.current = grow;
    land(`ev:${res.id}`, res.day);
    return { ok: true };
  };

  /* WHAT TIFF PUT ON LANDS HERE AS THE MODAL CLOSES (his calLand): the
     first of it is brought into view as a Save is, chosen unless it is on
     the day picked, and all of it is lit, so a weekly line lights every
     date 4 weeks shows. The modal says what it filed as it closes
     (`landed`, for two seconds), and the rows arrive with the refresh that
     follows, which may be slower than that: so what landed is held here
     until the calendar has it, then landed once. Anything else the modal
     filed (a task, from the top bar) is never on the calendar, and is let
     go by the next landing.

     It lands still: it comes with the modal closing, by × or Escape as
     often as by a pointer, not with a press on the calendar (law 8). And
     as a Save does, it lands anything on its way first, so a view a
     pointer chose a moment before is the one it is brought into. */
  if (tiff.landed !== landedSeen) {
    setLandedSeen(tiff.landed);
    if (tiff.landed?.ids.length) setLanding(tiff.landed.ids);
  }
  const arrived = landing ? landedEvent(cal.items, landing) : null;
  if (landing && arrived) {
    setLanding(null);
    /* Put down now, as a press would land them: the view a pointer chose,
       the filter as it now stands, the panel on what comes. */
    if (ahead) {
      setAhead(null);
      setNav(ahead);
    }
    setOffHeld(null);
    setPanelHeld(null);
    setOvertaken((n) => n + 1);
    land(arrived.id, arrived.start, landing.map((id) => `ev:${id}`));
  }

  return (
    <div className="hd-cal">
      <div className="hd-cal-tb">
        <div className="hd-cal-nav">
          <button type="button" className="hd-cal-nb" aria-label="Earlier" aria-disabled={!earlier} onClick={toEarlier}>
            <Icon name="chevL" size={16} />
          </button>
          <button type="button" className="hd-cal-nb" aria-label="Later" aria-disabled={!later} onClick={toLater}>
            <Icon name="chevR" size={16} />
          </button>
          <h2 className="hd-cal-rt" aria-live="polite">
            {rangeTitle(bar.view, bar.anchor, cal)}
          </h2>
          <button type="button" className="hd-cal-today" aria-disabled={home} onClick={toToday}>
            Today
          </button>
        </div>
        {/* The filters and the switch go together, so neither takes a line
            of its own when the row runs out of room. */}
        <div className="hd-cal-end">
          <div className="hd-cal-filters" role="group" aria-label="Show on the calendar">
            {chips.map((c) => (
              <button
                key={c.cat}
                type="button"
                className="hd-cal-filter"
                aria-pressed={!off[c.cat]}
                onClick={(e) => filter(c.cat, e.detail > 0)}
              >
                <CalSwatch cat={c.cat} />
                {c.label}
                {c.count !== null && <span className="hd-cal-n">{c.count}</span>}
              </button>
            ))}
          </div>
          <div className="hd-cal-vs" role="group" aria-label="View">
            {VIEWS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className="hd-cal-vb"
                aria-pressed={bar.view === v}
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
      </div>

      <div className="hd-cal-body" ref={body}>
        <div className="hd-cal-v" data-view={nav.view}>
          {nav.view === "4w" ? (
            <CalAgenda
              rows={agendaRows(vis, nav.anchor, cal)}
              selected={selected}
              day={chosenDay}
              fresh={fresh}
              onPick={pickThing}
              onPickDay={pickDay}
            />
          ) : nav.view === "month" ? (
            <CalMonth
              weeks={monthWeeks(vis, nav.anchor, cal)}
              anchor={nav.anchor}
              selected={selected}
              day={chosenDay}
              fresh={fresh}
              onPick={pickThing}
              onPickDay={pickDay}
            />
          ) : (
            <CalYear months={yearMonths(vis, nav.anchor, cal)} selected={selected} day={chosenDay} onPickDay={pickDay} />
          )}
          {/* THE RIGHT-HAND COLUMN, in every view: the box on top, over the
              day it adds to, and under it the rail beside 4 weeks or the
              panel beside Month and Year. It stays put as the views change,
              so the words in the box stay with it. */}
          <div className="hd-cal-side">
            {cal.canAdd && (
              <div
                className="hd-cal-add"
                ref={add}
                onPointerDownCapture={() => {
                  press.current = "pointer";
                }}
                onKeyDownCapture={() => {
                  press.current = "key";
                }}
              >
                <TiffBox
                  room="calendar"
                  placeholder={addTo === cal.today ? "Add to today…" : `Add to ${fmtDay(addTo)}…`}
                  save={save}
                  day={addTo}
                  enter="save"
                />
              </div>
            )}
            {nav.view === "4w" ? (
              <CalRail lists={railLists(vis, cal, cal.warnDays)} selected={selected} onPick={pickThing} />
            ) : (
              /* Where focus goes after a delete, and after a thing is picked
                 from a day's list: the form, or the list, and what opened it
                 are gone, and what the panel shows next comes with the
                 refresh or the fade, so the panel's own column holds it. */
              <aside
                ref={details}
                className="hd-cal-det"
                data-scroll=""
                aria-label="Details"
                aria-live="polite"
                tabIndex={-1}
              >
                {shownDay ? (
                  <CalDay day={shownDay} fresh={fresh} onPick={pickFromDay} />
                ) : (
                  <CalPanel
                    item={item}
                    items={cal.items}
                    frame={cal}
                    canEdit={cal.canAdd}
                    onDeleted={() => details.current?.focus({ preventScroll: true })}
                  />
                )}
                {nav.view === "year" && <CalKey />}
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
