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
import { railMissing, railSaysEmpty } from "@/lib/dashboard/day-rail";
import type { HomeRail } from "@/lib/dashboard/page-data";
import { HomeDayBar, KEEPS_DAY } from "./home-day-bar";
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

   THE PANEL is his: the place, the number, the state, what the job is,
   Time / Where / With, and one thing to do — Open job, or a task's Mark
   done — beside the close cross. A booking the mirror could not name has
   nothing to open and says so by having no button. Open job is the desk's
   one card (./home-job-sheet), wearing the day-state the Schedule would. */

export function HomeDay({ rail }: { rail: HomeRail }) {
  const { openJob } = useDeskJobs();
  const router = useRouter();
  const [pending, start] = useTransition();
  /* The browser's clock once it has one, the loader's until then — so the
     first render is the server's, and the bar moves on by the minute. */
  const liveNow = useNowMin(rail.dayISO);
  const nowMin = liveNow ?? rail.nowMin;

  const items = dayItems(rail);
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

  const close = () => {
    focusNext.current = openKey;
    setSelectedKey(null);
  };

  const unfold = (first: string) => {
    focusNext.current = first;
    setShowFinished(true);
  };
  useLayoutEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    cards.current.get(key)?.focus();
  });

  /* ESCAPE closes the card when the key is pressed in the day, or with
     nothing focused (a pressed card is not focused in every browser). Not
     while a dialog is up — the job card and Tiff's answer their own Escape
     — and not from a face, whose box may want it. */
  useEffect(() => {
    if (openKey === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = e.target;
      if (t !== document.body && !(t instanceof Node && section.current?.contains(t))) return;
      focusNext.current = openKey;
      setSelectedKey(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openKey]);

  /* A CLICK ELSEWHERE closes the card and folds finished work up again —
     elsewhere ON THIS PAGE. The job card and Tiff are portalled to <body>,
     outside it, and a click in them is not a click on Home. */
  useEffect(() => {
    if (openKey === null && !showFinished) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const page = section.current?.closest(".hd-page");
      if (!page || !page.contains(t) || t.closest("[data-day-keep]")) return;
      setSelectedKey(null);
      setShowFinished(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openKey, showFinished]);

  /* WHAT SERVICEM8 COULDN'T ADD. `null` is the complete day — including a
     workspace with no ServiceM8, which has nothing to be missing. */
  const missing = railMissing(rail);
  const saysEmpty = railSaysEmpty(items.length, missing);

  /* The panel's one action. */
  let action: ReactNode = null;
  if (selected?.kind === "job") {
    const block = rail.blocks.find((b) => `job:${b.key}` === selected.key);
    const job = rail.jobs.find((j) => j.remoteId === selected.remoteId);
    const row = job ? sheetRowOf(job, rail.dayISO) : null;
    if (block && row) {
      const clock = { dayISO: rail.dayISO, today: rail.dayISO, nowMin, tracksTime: rail.tracksTime };
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
            await completeTask(id);
            router.refresh();
          })
        }
      >
        Mark done
      </button>
    );
  }

  return (
    <section className="hd-day" aria-labelledby="hd-day-h" ref={section}>
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

      {items.length > 0 ? (
        <HomeDayBar
          items={items}
          nowMin={nowMin}
          selectedKey={openKey}
          showFinished={showFinished}
          panelId={panelId}
          onChoose={(key) => setSelectedKey(openKey === key ? null : key)}
          onUnfold={unfold}
          hold={hold}
        />
      ) : (
        saysEmpty && <p className="hd-daynone">Nothing on your day.</p>
      )}

      <div id={panelId} className="hd-panw" {...KEEPS_DAY} hidden={!selected}>
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
  onClose: () => void;
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
        <button type="button" className="hd-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
