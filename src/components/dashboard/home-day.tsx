"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeTask } from "@/app/actions/dashboard";
import { Icon } from "@/components/shell/icon";
import { useNowMin } from "@/components/workboard/board/use-now-min";
import { sheetRowOf } from "@/lib/workboard/all-jobs";
import { dayStateOfBlock } from "@/lib/workboard/focus";
import {
  dayCardPaint,
  dayItems,
  dayLiveKey,
  dayPanelFacts,
  dayProgress,
  dayState,
  dayStateWord,
  type DayItem,
} from "@/lib/dashboard/day-bar";
import {
  DAY_BODY_EASE,
  DAY_BODY_MOVE_MS,
  DAY_PANEL_FADE_MS,
  liftFrames,
  liftOf,
  motionAllowed,
  PANEL_IN,
} from "@/lib/dashboard/day-flip";
import { railMissing, railSaysEmpty } from "@/lib/dashboard/day-rail";
import { fmtAuWeekdayDateLong } from "@/lib/au-dates";
import type { HomeRail } from "@/lib/dashboard/page-data";
import { HomeDayBar, KEEPS_DAY, type DayBarHandle } from "./home-day-bar";
import { useDeskJobs } from "./home-job-sheet";

/* YOUR DAY (docs/design.md, "Home is the day, three tabs and the list"):
   the viewer's own bookings and the tasks that named an hour, as his
   slanted bar, with the card that is open summed up under it.

   WHAT IS ON IT is the loader's rail and nothing else — the bookings are
   narrowed to the viewer by the ServiceM8 link, a task earns a place by
   naming an hour — and what ServiceM8 could not add is said above the bar
   rather than instead of it (`railMissing`). A workspace with no ServiceM8
   has nothing missing: its bar is its timed tasks and there is no sentence
   about ServiceM8. The day is called clear only when the picture is
   complete (`railSaysEmpty`).

   ONE CARD OPEN, from the first paint: the job on now, read off the
   loader's own clock so the server and the browser open the same one. It
   stays open whatever face is up — this section is above the body that
   slides ("if the card is open, they can just close it if they want more
   space", Isaac, 2026-09-25). It closes on a second press of its card, on
   the cross, on Escape, and on a click anywhere else on the page but the
   places that keep it (`KEEPS_DAY`); the last also folds finished work
   back up. Closing by the cross or Escape puts focus back on the card.

   NOTHING ON TODAY: your next booked day in its place ("something to put
   there as a placeholder that brings in the color of what your day
   normally shows", Isaac, 2026-09-26). The loader finds it (lib/dashboard/
   next-day, `rail.next`); the line says it is today's nothing and which
   day this is, and the bar is that day's, every card still to come, each
   opening the same panel with Open job. Nothing booked for a fortnight is
   the plain line it always was.

   IT STEPS ASIDE FOR THE CALENDAR ("increase the space on the screen when
   the calendar view is in… the your day disappears temporarily", Isaac,
   2026-09-26): `away`, the desk's to say. Away, it is hidden and its card
   is left as it was — nothing on the page closes it, it has no Escape —
   and it comes back as it went. While it folds, the desk's body rises over
   it (./home-desk), so it stays drawn under the body, `lap` pixels of it
   overlapped, until the body has covered it.

   THE PANEL is his: the place, the number, the state, what the job is,
   Time / Where / With, and one thing to do — Open job, or a task's Mark
   done — beside the close cross. A booking the mirror could not name has
   nothing to open and says so by having no button. Open job is the desk's
   one card (./home-job-sheet), wearing the day-state the Schedule would.

   IN MOTION (lib/dashboard/day-flip): every change a pointer makes — a
   card pressed, the cross, a click elsewhere, the folded block — is
   braced first: the bar reads where its cards are drawn, and what stands
   under the day (the desk's body) is read where it is. Once the change is
   committed the cards grow from there, the panel fades in on `--t-fast`,
   and the body travels to its new place on `--t-move` instead of jumping
   by the panel's height. A change from the keyboard — Escape, a card or
   the cross pressed with a key — is simply there (law 8), as is every
   change under reduced motion. */

/** What stands under the day on its page — on the desk, the body with the
    tabs and faces — which the panel pushes down as it opens. */
function underDay(section: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let el = section?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
    if (el instanceof HTMLElement) out.push(el);
  }
  return out;
}

type Braced = { open: boolean; under: { el: HTMLElement; top: number }[] };

/** Before a change to the day: the bar reads its cards, and what stands
    under the day is read where it is drawn — a move in flight included.
    A change that will not move ("cut") stops what is in flight instead. */
function brace(bar: DayBarHandle | null, section: HTMLElement | null, open: boolean, pointer: boolean): Braced | "cut" {
  const move = pointer && motionAllowed();
  bar?.capture(move);
  if (!move) return "cut";
  return { open, under: underDay(section).map((el) => ({ el, top: el.getBoundingClientRect().top })) };
}

export function HomeDay({
  rail,
  away = false,
  lap = null,
}: {
  rail: HomeRail;
  /** The Calendar is up: the day has stepped aside (above). */
  away?: boolean;
  /** While it folds away: how far the body below overlaps it, so the body
      stands where it will stand once the day is gone. Null at rest. */
  lap?: number | null;
}) {
  const { openJob } = useDeskJobs();
  const router = useRouter();
  const [pending, start] = useTransition();
  /* The browser's clock once it has one, the loader's until then — so the
     first render is the server's, and the bar moves on by the minute. */
  const liveNow = useNowMin(rail.dayISO);
  const todayMin = liveNow ?? rail.nowMin;

  /* WHAT SERVICEM8 COULDN'T ADD. `null` is the complete day — including a
     workspace with no ServiceM8, which has nothing to be missing. */
  const todays = dayItems(rail);
  const missing = railMissing(rail);
  const saysEmpty = railSaysEmpty(todays.length, missing);
  /* Today's nothing, and the next day with your bookings drawn in its
     place: another day's clock is not today's, so all of it is to come. */
  const next = saysEmpty ? (rail.next ?? null) : null;
  const items = next
    ? dayItems({ blocks: next.blocks, tasks: [], jobs: next.jobs, where: next.where, crew: next.crew })
    : todays;
  const nowMin = next ? null : todayMin;
  const day = next
    ? { dayISO: next.dayISO, blocks: next.blocks, jobs: next.jobs }
    : { dayISO: rail.dayISO, blocks: rail.blocks, jobs: rail.jobs };
  const [selectedKey, setSelectedKey] = useState(() => dayLiveKey(dayItems(rail), rail.nowMin));
  /* The folded block was pressed: every finished card is drawn. */
  const [showFinished, setShowFinished] = useState(false);
  /* A card is open only while it is still on the bar — a task marked done
     leaves it, and its panel with it. */
  const selected = items.find((it) => it.key === selectedKey) ?? null;
  const openKey = selected?.key ?? null;

  const panelId = useId();
  const section = useRef<HTMLElement>(null);
  /* Every card's button by its key — and a folded block under each key it
     holds, so a card that folds away as it closes hands focus to its block. */
  const cards = useRef(new Map<string, HTMLButtonElement>());
  /* Where focus goes once the bar has been drawn again: the card that was
     closed (or the block it folded into), or the first card of a block that
     opened out. Taken after the commit, when that element exists. */
  const focusNext = useRef<string | null>(null);

  const hold = (key: string, el: HTMLButtonElement | null) => {
    if (el) cards.current.set(key, el);
    else cards.current.delete(key);
  };

  /* THE MOTION: the bar's own handle, what was read before a change, the
     moves in flight under the bar, and the panel that fades in. Read and
     written only in handlers and effects. */
  const bar = useRef<DayBarHandle>(null);
  const braced = useRef<Braced | "cut" | null>(null);
  const lifts = useRef<Animation[]>([]);
  const panelBox = useRef<HTMLDivElement>(null);
  const ready = (pointer: boolean) => {
    braced.current = brace(bar.current, section.current, openKey !== null, pointer);
  };

  const choose = (key: string, pointer: boolean) => {
    ready(pointer);
    setSelectedKey(openKey === key ? null : key);
  };

  const close = (pointer: boolean) => {
    ready(pointer);
    focusNext.current = openKey;
    setSelectedKey(null);
  };

  const unfold = (first: string, pointer: boolean) => {
    ready(pointer);
    focusNext.current = first;
    setShowFinished(true);
  };
  useLayoutEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    cards.current.get(key)?.focus();
  });

  /* After every commit: if the change was braced, what stands under the day
     travels from where it was to where the panel has put it, and a panel
     that was not there fades in. Whatever was in flight stops first, so
     the places read now are the layout's own. */
  useLayoutEffect(() => {
    const was = braced.current;
    braced.current = null;
    if (was === null) return;
    for (const a of lifts.current) a.cancel();
    lifts.current = [];
    if (was === "cut") return;
    const move = { duration: DAY_BODY_MOVE_MS, easing: DAY_BODY_EASE };
    for (const { el, top } of was.under) {
      const dy = liftOf(top, el.getBoundingClientRect().top);
      if (dy !== null) lifts.current.push(el.animate(liftFrames(dy), move));
    }
    const pan = panelBox.current?.firstElementChild;
    if (!was.open && pan) lifts.current.push(pan.animate(PANEL_IN, { duration: DAY_PANEL_FADE_MS, easing: DAY_BODY_EASE }));
  });

  /* ESCAPE closes the card when the key is pressed in the day, or with
     nothing focused (a pressed card is not focused in every browser). Not
     while a dialog is up — the job card and Tiff's answer their own Escape
     — and not from a face, whose box may want it. */
  useEffect(() => {
    if (openKey === null || away) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target;
      if (t !== document.body && !(t instanceof Node && section.current?.contains(t))) return;
      // a key: simply shut, and anything in flight stops (law 8)
      braced.current = brace(bar.current, section.current, true, false);
      focusNext.current = openKey;
      setSelectedKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openKey, away]);

  /* A CLICK ELSEWHERE closes the card and folds finished work up again —
     elsewhere ON THIS PAGE. The job card and Tiff are portalled to <body>,
     outside it, and a click in them is not a click on Home.

     ON THE CLICK, NEVER THE PRESS. The panel sits above the faces, so
     closing it lifts everything under it by its height. Closed on the
     press, that lift lands between the button going down and coming up,
     the release is over something else, and the browser gives the click to
     what the two have in common: the button pressed never hears it. On the
     click the target has its click; capturing it lets the page settle
     before the target's own handler runs, so anything it measures is where
     it now stands, and no face's stopPropagation can keep the card open.

     A CLICK FROM A POINTER. A button pressed from the keyboard, and the
     click Enter in a form's box makes on its submit button, carry no
     count (`detail` 0): the keyboard is in a face, where Escape is the
     face's too, and a card that closed under someone typing would pull
     the box they are typing in up the page. */
  useEffect(() => {
    if (away || (openKey === null && !showFinished)) return;
    const onClick = (e: MouseEvent) => {
      if (e.detail === 0) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      const page = section.current?.closest(".hd-page");
      if (!page || !page.contains(t) || t.closest("[data-day-keep]")) return;
      braced.current = brace(bar.current, section.current, openKey !== null, true);
      setSelectedKey(null);
      setShowFinished(false);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [openKey, showFinished, away]);

  /* The panel's one action. */
  let action: ReactNode = null;
  if (selected?.kind === "job") {
    const block = day.blocks.find((b) => `job:${b.key}` === selected.key);
    const job = day.jobs.find((j) => j.remoteId === selected.remoteId);
    const row = job ? sheetRowOf(job, day.dayISO) : null;
    if (block && row) {
      const clock = { dayISO: day.dayISO, today: rail.dayISO, nowMin: todayMin, tracksTime: rail.tracksTime };
      action = (
        <button
          type="button"
          className="hd-open"
          onClick={(e) => openJob(row, { state: dayStateOfBlock(block, clock), from: e.currentTarget })}
        >
          Open job
        </button>
      );
    }
  } else if (selected?.kind === "task" && selected.taskId) {
    const id = selected.taskId;
    action = (
      <button
        type="button"
        className="hd-open"
        disabled={pending}
        onClick={() =>
          start(async () => {
            // a person's tick: a task made from a mention answers it (PR C)
            await completeTask(id, { postDone: true });
            router.refresh();
          })
        }
      >
        Mark done
      </button>
    );
  }

  return (
    <section
      className="hd-day"
      aria-labelledby="hd-day-h"
      ref={section}
      hidden={away && lap === null}
      inert={away}
      style={lap === null ? undefined : { marginBottom: -lap }}
    >
      <h2 className="hd-dayh" id="hd-day-h">
        Your day
      </h2>

      {/* Not hint text: the difference between "nothing is on" and "we
          could not see what is on", which the bar cannot draw. Gone the
          moment the picture is complete. */}
      {missing === "workboard" && (
        <p className="hd-daynote">
          Bookings aren’t in this picture — they need the workboard. Your timed work is.
        </p>
      )}
      {missing === "link" && (
        <p className="hd-daynote">
          Bookings aren’t in this picture: nobody in ServiceM8 is linked to your account yet.{" "}
          {rail.linkHref ? <Link href={rail.linkHref}>Link yourself to the crew</Link> : "The owner can link you to it."}
        </p>
      )}

      {next && (
        <p className="hd-daynone">
          Nothing on today. Next, {fmtAuWeekdayDateLong(next.dayISO)}.
        </p>
      )}

      {items.length > 0 ? (
        <HomeDayBar
          ref={bar}
          items={items}
          nowMin={nowMin}
          selectedKey={openKey}
          showFinished={showFinished}
          panelId={panelId}
          onChoose={choose}
          onUnfold={unfold}
          hold={hold}
        />
      ) : (
        saysEmpty && <p className="hd-daynone">Nothing on your day.</p>
      )}

      <div id={panelId} className="hd-panw" ref={panelBox} {...KEEPS_DAY} hidden={!selected}>
        {selected && <DayPanel item={selected} nowMin={nowMin} action={action} onClose={close} />}
      </div>
    </section>
  );
}

/** The open card, summed up: his panel. A card still to come or on now is
    its own colour with white words; a finished one or a task sits on its
    tint with ink (`dayCardPaint`, every pair measured there). */
function DayPanel({
  item,
  nowMin,
  action,
  onClose,
}: {
  item: DayItem;
  nowMin: number | null;
  action: ReactNode;
  /** `pointer` is false for the cross pressed from the keyboard. */
  onClose: (pointer: boolean) => void;
}) {
  const facts = dayPanelFacts(item);
  const paint = dayCardPaint(item, dayProgress(item, nowMin), { selected: true });
  return (
    <div
      className="hd-pan"
      style={
        {
          "--hd-pbg": paint.bg,
          "--hd-ptitle": paint.title,
          "--hd-psub": paint.sub,
          "--hd-psw": paint.swatch,
        } as CSSProperties
      }
    >
      <span className="hd-sw" aria-hidden="true" />
      <div className="hd-pm">
        <div className="hd-pt">
          <h3 className="hd-pn">{facts.title}</h3>
          {facts.number && <span className="hd-pno">{facts.number}</span>}
          {/* His capsule round the state: a named exemption (law 26). */}
          <span className="hd-chip" data-state={dayState(item, nowMin)}>
            {dayStateWord(item, nowMin)}
          </span>
        </div>
        {facts.summary && <p className="hd-ps">{facts.summary}</p>}
        <dl className="hd-px">
          <div>
            <dt>Time</dt>
            <dd>{facts.time}</dd>
          </div>
          {facts.where && (
            <div>
              <dt>Where</dt>
              <dd>{facts.where}</dd>
            </div>
          )}
          {facts.with && (
            <div>
              <dt>With</dt>
              <dd>{facts.with}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="hd-pb">
        {action}
        <button type="button" className="hd-x" aria-label="Close" onClick={(e) => onClose(e.detail > 0)}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
