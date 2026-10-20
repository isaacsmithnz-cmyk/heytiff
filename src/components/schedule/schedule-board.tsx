"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useContext, useEffect, useMemo, useState, useTransition, type DragEvent, type MouseEvent } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { Tray } from "@/components/parts/tabs";
import { TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Initials } from "@/components/parts/initials";
import { Dot, StateWord } from "@/components/parts/state";
import { Fade } from "@/components/parts/fade";
import { Icon } from "@/components/shell/icon";
import { WindowsContext } from "@/components/records/records-context";
import { jobPageHref } from "@/lib/shell/links";
import { mintPressId } from "@/lib/workboard/press-id";
import { bookJobIn, readBookInContext, takeBackBooking } from "@/app/actions/booking-sm8";
import { BOOKING_LENGTHS_MIN } from "@/lib/integrations/sm8-booking-plan";
import { thrownWords } from "@/lib/stale-deploy";
import type { PanelJob, SchedulePage } from "@/lib/schedule/schedule-page-query";
import { RegularDaysOffForm } from "@/components/making/regular-days-off-form";
import {
  DAY_JOB_MINUTES,
  MAX_DAYS,
  WORK_END,
  WORK_START,
  boardOf,
  clockWord,
  dayHead,
  dayLine,
  daysFit,
  fitOf,
  fitWord,
  lengthWord,
  listDays,
  snap,
  spanWord,
  stepDay,
  toHHMM,
  weekLine,
  weekdayWord,
  fillWord,
  hoursWord,
  workingDaysFrom,
  type DayBlock,
  type Fit,
  type PersonRow,
  type ScheduleView,
} from "@/lib/schedule/board";

/* THE SCHEDULE (v2, step 5; 6-revisions.md, 18 October). A row per person,
   time across, for a day or a working week; Jobs on the right, as
   ServiceM8's dispatch board keeps them. You pick up a JOB (drag it, or
   click it) and its hours light up in each free person's row; dropping it
   on a row books that person through Book in's own engine, read first
   (readBookInContext), then booked (bookJobIn), with Undo on the toast
   (takeBackBooking). A clash or time off warns and never refuses, as Book
   in's does. */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (day: string) => MONTHS[Number(day.slice(5, 7)) - 1];
const dayNum = (day: string) => Number(day.slice(8, 10));
const longDay = (day: string) => `${weekdayWord(day)} ${dayNum(day)} ${monthOf(day)}`;
function weekLabel(days: readonly string[]): string {
  const a = days[0];
  const b = days[days.length - 1];
  return monthOf(a) === monthOf(b) ? `${dayNum(a)} to ${dayNum(b)} ${monthOf(b)}` : `${dayNum(a)} ${monthOf(a)} to ${dayNum(b)} ${monthOf(b)}`;
}

const jobName = (j: Pick<PanelJob, "number" | "client">) => (j.number ? `${j.number} ${j.client}` : j.client);
const blockName = (b: DayBlock) => [b.number, b.client].filter(Boolean).join(" ") || "A job";

type Held = { job: PanelJob; minutes: number; days: number };
type Slot = { day: string; start: number; minutes: number };

/** Book in's engine, as the Visit form drives it: read ServiceM8 for the
    days first, then book. A Quote booked stays a Quote: a quote visit. */
async function bookOnce(jobUuid: string, staffUuid: string, slots: readonly Slot[]): Promise<{ ok: true; rowIds: string[] } | { ok: false; error: string }> {
  try {
    const ctx = await readBookInContext({ jobUuid, days: [...new Set(slots.map((s) => s.day))] });
    if (!ctx.ok) return ctx;
    const r = await bookJobIn({
      jobUuid,
      pressId: mintPressId(),
      seen: { jobEditDate: ctx.job.editDate, readAt: ctx.readAt },
      makeWorkOrder: false,
      bookings: slots.map((s) => ({ staffUuid, day: s.day, start: toHHMM(s.start), minutes: s.minutes })),
    });
    return r.ok ? { ok: true, rowIds: r.rowIds } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: thrownWords(e, "That didn't book. Try again.") };
  }
}
type Ask = { row: PersonRow; days: string[]; free: string[]; not: { day: string; why: string }[] };

const LENGTHS = BOOKING_LENGTHS_MIN.map((m) => ({ value: String(m), label: lengthWord(m) }));
const DAY_COUNTS = Array.from({ length: MAX_DAYS }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1 day" : `${i + 1} days` }));

export function ScheduleBoard({ data }: { data: SchedulePage }) {
  const router = useRouter();
  const host = useContext(WindowsContext);
  /* the shell's own toast, as the forms raise theirs (rule 37) */
  const toast = ({ text, undo }: { text: string; undo?: () => void }) => host?.toast(text, undo);
  const board = useMemo(() => boardOf(data.payloads), [data.payloads]);
  const [held, setHeld] = useState<Held | null>(null);
  /** where the held job would start: a minute on the day, or a day in the week */
  const [at, setAt] = useState<{ staff: string; min: number; day: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [daysOff, setDaysOff] = useState<{ profile: string; name: string } | null>(null);
  /** a person's name opens their regular days off, where they're linked and you look after the team */
  const openDaysOff = (row: PersonRow) => {
    const profile = data.canTeam ? data.profiles[row.staffUuid.toLowerCase()] : undefined;
    return profile ? () => setDaysOff({ profile, name: row.name }) : undefined;
  };

  /* DISPLAY: the Workboard's display mode, on the Schedule (overview-screen
     says why it is the document that goes fullscreen, the frame hidden by an
     attribute on <html>): for the wall, refreshed every minute, left with
     Close display or the browser's own Esc. */
  const [display, setDisplay] = useState(false);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setDisplay(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!display) return;
    const root = document.documentElement;
    root.setAttribute("data-wb-display", "on");
    const t = setInterval(() => router.refresh(), 60_000);
    return () => {
      clearInterval(t);
      root.removeAttribute("data-wb-display");
      if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {});
    };
  }, [display, router]);
  const toDisplay = () => {
    setDisplay(true);
    /* a refused request backs the mode out: chromeless in a window is a trap */
    void document.documentElement.requestFullscreen?.()?.catch(() => setDisplay(false));
  };

  /* SWITCHING SAYS SO AT ONCE (Isaac, 20 October: "The week switcher is very
     slow. Month switcher, that takes quite a while"): the tray takes the
     press now and the board fades while the next one is read, and the
     periods either side, and the other views, are fetched ahead. */
  const [switching, startSwitch] = useTransition();
  const [aim, setAim] = useState<ScheduleView | null>(null);
  const hrefOf = (view: ScheduleView, day: string) => `/dashboard/schedule?view=${view}&day=${day}`;
  const go = (view: ScheduleView, day: string) => {
    setAim(view);
    startSwitch(() => router.push(hrefOf(view, day)));
  };
  useEffect(() => {
    const ahead = [
      hrefOf(data.view, stepDay(data.view, data.day, -1)),
      hrefOf(data.view, stepDay(data.view, data.day, 1)),
      ...(["day", "week", "weeks", "month"] as const).filter((v) => v !== data.view).map((v) => hrefOf(v, data.day)),
    ];
    for (const href of ahead) router.prefetch(href);
  }, [router, data.view, data.day]);
  const week = data.view === "week";
  const month = data.view === "month";
  const weeks = data.view === "weeks" || month;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHeld(null);
        setAt(null);
        setAsk(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (job: PanelJob) => {
    setAsk(null);
    setHeld((h) => (h?.job.uuid === job.uuid ? null : { job, minutes: h?.minutes ?? 120, days: h?.days ?? 1 }));
  };

  /** Book one person on the held job, and say so with Undo. */
  const book = (row: PersonRow, slots: Slot[]) => {
    if (!held || busy) return;
    /* picking up and dropping still show who's free; only the booking is off */
    if (!data.canBook) {
      toast({ text: "Booking from here is off for you." });
      return;
    }
    const job = held.job;
    setBusy(row.staffUuid);
    setAsk(null);
    void bookOnce(job.uuid, row.staffUuid, slots).then((r) => {
      setBusy(null);
      if (!r.ok) {
        toast({ text: r.error });
        return;
      }
      const when =
        slots.length === 1
          ? `${weekdayWord(slots[0].day)}, ${spanWord(slots[0].start, slots[0].start + slots[0].minutes)}`
          : listDays(slots.map((s) => s.day));
      toast({
        text: `${row.name} booked on ${jobName(job)}, ${when}`,
        undo: () => {
          void Promise.all(r.rowIds.map((rowId) => takeBackBooking({ jobUuid: job.uuid, rowId }))).then(() => router.refresh());
        },
      });
      setHeld(null);
      setAt(null);
      router.refresh();
    });
  };

  /** A drop (or a click) on a person's row. */
  const dropOn = (row: PersonRow, place: { min: number; day: string }) => {
    if (!held) return;
    if (!week) {
      const start = Math.min(place.min, board.stripEnd - held.minutes);
      book(row, [{ day: place.day, start, minutes: held.minutes }]);
      return;
    }
    const days = workingDaysFrom(place.day, held.days);
    const fit = daysFit(row, days);
    if (fit.not.length === 0) {
      book(row, days.map((day) => ({ day, start: WORK_START, minutes: DAY_JOB_MINUTES })));
      return;
    }
    setAsk({ row, days, ...fit });
  };

  const booked = data.capacity.reduce((n, d) => n + d.bookedMinutes, 0);
  const crew = data.capacity.reduce((n, d) => n + d.capacityMinutes, 0);
  const fact = month
    ? `${monthOf(data.days[0])} ${data.days[0].slice(0, 4)}${crew > 0 ? `, ${Math.round((booked / crew) * 100)}% booked` : ""}`
    : weeks
    ? `4 weeks from ${dayNum(board.days[0] ?? data.days[0])} ${monthOf(data.days[0])}${crew > 0 ? `, ${Math.round((booked / crew) * 100)}% booked` : ""}`
    : week ? `Week of ${dayNum(board.days[0])} ${monthOf(board.days[0])}` : longDay(data.day);

  return (
    <div className="wrap sc">
      <header className="sc-head">
        <h1 className="sc-h1">Schedule</h1>
        <span className="sc-fact">{fact}</span>
        <span className="sc-headacts">
          {display ? (
            <Button kind="second" size={36} icon="x" onClick={() => setDisplay(false)}>
              Close display
            </Button>
          ) : (
            <Button kind="second" size={36} icon="maximize" onClick={toDisplay}>
              Open display
            </Button>
          )}
        </span>
      </header>
      <div className="sc-bar">
        <Tray
          ariaLabel="View"
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "weeks", label: "4 weeks" },
            { value: "month", label: "Month" },
          ]}
          value={switching && aim ? aim : data.view}
          onChange={(v) => go(v, data.day)}
        />
        <div className="sc-pager">
          <IconButton glyph="earlier" label="Earlier" size={32} onClick={() => go(data.view, stepDay(data.view, data.day, -1))} />
          <b>{month ? `${monthOf(data.days[0])} ${data.days[0].slice(0, 4)}` : weeks ? weekLabel(data.days) : week ? weekLabel(board.days) : longDay(data.day)}</b>
          <IconButton glyph="later" label="Later" size={32} onClick={() => go(data.view, stepDay(data.view, data.day, 1))} />
        </div>
        <Button kind="second" size={32} onClick={() => go(data.view, data.today)}>
          Today
        </Button>
      </div>

      <div className="sc-body">
        <div className={`sc-board${held ? " sc-holding" : ""}${switching ? " sc-switching" : ""}`} aria-busy={switching || undefined}>
          {weeks ? (
            <WeeksGrid data={data} open={(d) => go("day", d)} />
          ) : week ? (
            <WeekRows board={board} held={held} at={at} busy={busy} setAt={setAt} dropOn={dropOn} nameDoor={openDaysOff} />
          ) : (
            <DayRows board={board} held={held} at={at} busy={busy} setAt={setAt} dropOn={dropOn} nameDoor={openDaysOff} />
          )}
          {ask ? (
            <div className="sc-ask" role="alertdialog" aria-label="Some of those days">
              <p>
                <b>
                  {ask.row.name} is {ask.not.map((n) => `${n.why} on ${weekdayWord(n.day)}`).join(", ")}.
                </b>{" "}
                {ask.free.length > 0 ? `Book ${listDays(ask.free)}?` : "Book them anyway?"}
              </p>
              <div className="sc-askacts">
                <Button kind="second" size={32} onClick={() => setAsk(null)}>
                  Cancel
                </Button>
                {ask.free.length > 0 ? (
                  <Button kind="second" size={32} onClick={() => book(ask.row, ask.days.map((day) => ({ day, start: WORK_START, minutes: DAY_JOB_MINUTES })))}>
                    All {ask.days.length} days
                  </Button>
                ) : null}
                <Button
                  kind="main"
                  size={32}
                  onClick={() =>
                    book(
                      ask.row,
                      (ask.free.length > 0 ? ask.free : ask.days).map((day) => ({ day, start: WORK_START, minutes: DAY_JOB_MINUTES })),
                    )
                  }
                >
                  {ask.free.length > 0 ? (ask.free.length === 1 ? `Just ${weekdayWord(ask.free[0])}` : `${ask.free.length} days`) : "Book anyway"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {weeks ? null : <JobsPanel jobs={data.jobs} canBook={data.canBook} held={held} week={week} pick={pick} setHeld={setHeld} />}
      </div>
      {daysOff ? <RegularDaysOffForm staffProfileId={daysOff.profile} name={daysOff.name} today={data.today} onClose={() => setDaysOff(null)} /> : null}
    </div>
  );
}

/* ── the rows ── */

/** A person's name: a door to their regular days off where there is one. */
function Who({ row, line, door }: { row: PersonRow; line: string; door?: () => void }) {
  const body = (
    <>
      <Initials name={row.name} beside size={32} />
      <span className="sc-pn">
        <Fade className="sc-name">{row.name}</Fade>
        <em>{line}</em>
      </span>
    </>
  );
  return door ? (
    <button type="button" className="sc-who sc-whob" onClick={door} aria-label={`${row.name}, regular days off`}>
      {body}
    </button>
  ) : (
    <div className="sc-who">{body}</div>
  );
}

type RowsProps = {
  board: ReturnType<typeof boardOf>;
  held: Held | null;
  at: { staff: string; min: number; day: string } | null;
  busy: string | null;
  setAt: (a: { staff: string; min: number; day: string } | null) => void;
  dropOn: (row: PersonRow, place: { min: number; day: string }) => void;
  nameDoor: (row: PersonRow) => (() => void) | undefined;
};

const pct = (min: number, a: number, b: number) => ((min - a) / (b - a)) * 100;

function DayRows({ board, held, at, busy, setAt, dropOn, nameDoor }: RowsProps) {
  const { stripStart: a, stripEnd: b } = board;
  const day = board.days[0];
  const hours: number[] = [];
  for (let h = a; h < b; h += 60) hours.push(h);
  const start = held ? Math.min(at?.min ?? WORK_START, b - held.minutes) : 0;
  const end = held ? start + held.minutes : 0;

  const minuteAt = (e: DragEvent<HTMLElement> | MouseEvent<HTMLElement>, track: HTMLElement) => {
    const r = track.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return Math.max(a, snap(a + (x / r.width) * (b - a)));
  };

  return (
    <div className="sc-day">
      <div className="sc-axis" aria-hidden="true">
        {hours.map((h) => (
          <span key={h} style={{ left: `${pct(h, a, b)}%` }}>
            {clockWord(h, h === a)}
          </span>
        ))}
      </div>
      {board.people.map((row) => {
        const d = row.days[0];
        const fit: Fit | null = held ? fitOf(d, start, end) : null;
        const hot = !!held && at?.staff === row.staffUuid;
        const dim = !!fit && (fit.kind === "busy" || fit.kind === "away");
        return (
          <div key={row.staffUuid} className={`sc-row${dim ? " sc-dim" : ""}${hot ? " sc-hot" : ""}`}>
            <Who row={row} line={busy === row.staffUuid ? "Booking" : dayLine(d)} door={nameDoor(row)} />
            <div
              className="sc-track"
              onDragOver={(e) => {
                if (!held) return;
                e.preventDefault();
                setAt({ staff: row.staffUuid, min: minuteAt(e, e.currentTarget), day });
              }}
              onDrop={(e) => {
                if (!held) return;
                e.preventDefault();
                dropOn(row, { min: minuteAt(e, e.currentTarget), day });
              }}
              onMouseMove={(e) => {
                if (held) setAt({ staff: row.staffUuid, min: minuteAt(e, e.currentTarget), day });
              }}
              onClick={(e) => {
                if (held) dropOn(row, { min: minuteAt(e, e.currentTarget), day });
              }}
            >
              {hours.slice(1).map((h) => (
                <i key={h} className="sc-vl" style={{ left: `${pct(h, a, b)}%` }} />
              ))}
              <i className="sc-after" style={{ left: `${pct(WORK_END, a, b)}%` }} />
              {d.away.map((x) => (
                <div key={x.key} className="sc-away" style={{ left: `${pct(Math.max(x.startMin, a), a, b)}%`, width: `${pct(Math.min(x.endMin, b), a, b) - pct(Math.max(x.startMin, a), a, b)}%` }}>
                  {x.word}
                </div>
              ))}
              {d.blocks.map((blk) => (
                <Link
                  key={blk.key}
                  href={jobPageHref(blk.jobUuid)}
                  className={`sc-blk sc-blk--${blk.hue}`}
                  style={{ left: `${pct(blk.startMin, a, b)}%`, width: `${pct(blk.endMin, a, b) - pct(blk.startMin, a, b)}%` }}
                >
                  <Fade className="sc-bn">{blockName(blk)}</Fade>
                  <Fade className="sc-bl">
                    {[blk.suburb, spanWord(blk.startMin, blk.endMin), blk.with.length ? `with ${blk.with.join(", ")}` : null].filter(Boolean).join(", ")}
                  </Fade>
                </Link>
              ))}
              {fit && (fit.kind === "free" || fit.kind === "part") ? (
                <div
                  className={`sc-fit${fit.kind === "free" ? " sc-ok" : " sc-part"}`}
                  style={{
                    left: `${pct(fit.kind === "free" ? start : fit.from, a, b)}%`,
                    width: `${pct(fit.kind === "free" ? end : fit.to, a, b) - pct(fit.kind === "free" ? start : fit.from, a, b)}%`,
                  }}
                >
                  <Fade>{hot && fit.kind === "free" ? `Drop to book ${row.name.split(" ")[0]}, ${spanWord(start, end)}` : fitWord(fit, start, end)}</Fade>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A person's week as bars: the same job on days side by side is one bar. */
function weekBars(row: PersonRow): { key: string; first: number; last: number; blk: DayBlock }[] {
  const out: { key: string; first: number; last: number; blk: DayBlock }[] = [];
  row.days.forEach((d, i) => {
    for (const blk of d.blocks) {
      const prev = out.find((o) => o.blk.jobUuid === blk.jobUuid && o.last === i - 1);
      if (prev) prev.last = i;
      else out.push({ key: blk.key, first: i, last: i, blk });
    }
  });
  return out;
}

function WeekRows({ board, held, at, busy, setAt, dropOn, nameDoor }: RowsProps) {
  const days = board.days;
  const col = at && held ? days.indexOf(at.day) : -1;
  const span = held && col >= 0 ? workingDaysFrom(days[col], held.days) : [];
  const shown = span.filter((d) => days.includes(d));
  return (
    <div className="sc-week">
      <div className="sc-wh">
        <div />
        {days.map((d) => (
          <b key={d}>{dayHead(d)}</b>
        ))}
      </div>
      {board.people.map((row) => {
        const fit = held && span.length ? daysFit(row, span) : null;
        const hot = !!held && at?.staff === row.staffUuid;
        const dim = !!fit && fit.free.length === 0;
        return (
          <div key={row.staffUuid} className={`sc-wrow${dim ? " sc-dim" : ""}${hot ? " sc-hot" : ""}`}>
            <Who row={row} line={busy === row.staffUuid ? "Booking" : weekLine(row)} door={nameDoor(row)} />
            <div className="sc-cells">
              {days.map((d, i) => (
                <div
                  key={d}
                  className="sc-cell"
                  style={{ gridColumn: `${i + 1}`, gridRow: "1 / -1" }}
                  onDragOver={(e) => {
                    if (!held) return;
                    e.preventDefault();
                    setAt({ staff: row.staffUuid, min: WORK_START, day: d });
                  }}
                  onDrop={(e) => {
                    if (!held) return;
                    e.preventDefault();
                    dropOn(row, { min: WORK_START, day: d });
                  }}
                  onMouseEnter={() => held && setAt({ staff: row.staffUuid, min: WORK_START, day: d })}
                  onClick={() => held && dropOn(row, { min: WORK_START, day: d })}
                />
              ))}
              {weekBars(row).map((w) => (
                <Link
                  key={w.key}
                  href={jobPageHref(w.blk.jobUuid)}
                  className={`sc-wbar sc-blk--${w.blk.hue}`}
                  style={{ gridColumn: `${w.first + 1} / ${w.last + 2}` }}
                >
                  <Fade className="sc-bn">{blockName(w.blk)}</Fade>
                  <Fade className="sc-bl">
                    {w.last > w.first ? `${w.last - w.first + 1} days, ` : ""}
                    {spanWord(w.blk.startMin, w.blk.endMin)}
                  </Fade>
                </Link>
              ))}
              {row.days.map((d, i) =>
                d.away.map((x) => (
                  <div key={x.key} className="sc-wbar sc-awayb" style={{ gridColumn: `${i + 1}` }}>
                    {x.word}
                  </div>
                )),
              )}
              {fit && fit.free.length > 0 && shown.length > 0 ? (
                <div
                  className={`sc-wbar sc-fitw${fit.not.length === 0 ? " sc-ok" : " sc-part"}`}
                  style={{ gridColumn: `${days.indexOf(shown[0]) + 1} / ${days.indexOf(shown[shown.length - 1]) + 2}` }}
                >
                  <Fade>
                    {fit.not.length === 0
                      ? hot
                        ? `Drop to book ${row.name.split(" ")[0]}, ${listDays(fit.free)}`
                        : `Free ${listDays(fit.free)}`
                      : `Free ${listDays(fit.free)}`}
                  </Fade>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── 4 weeks: how full each weekday is ── */

const FILL_TONE = { Room: "good", Full: "look", Over: "wrong" } as const;

function WeeksGrid({ data, open }: { data: SchedulePage; open: (day: string) => void }) {
  const byDay = new Map(data.capacity.map((d) => [d.dayISO, d]));
  return (
    <div className="sc-weeks">
      <div className="sc-wkh">
        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((w) => (
          <b key={w}>{w}</b>
        ))}
      </div>
      <div className="sc-wkgrid">
        {/* a month starts on its first weekday's column */}
        {Array.from({ length: (new Date(`${data.days[0]}T00:00:00Z`).getUTCDay() + 6) % 7 }, (_, i) => (
          <span key={`lead${i}`} aria-hidden="true" />
        ))}
        {data.days.map((d, i) => {
          const c = byDay.get(d);
          const newMonth = i === 0 || monthOf(d) !== monthOf(data.days[i - 1]);
          const word = c ? fillWord(c.fillPct, c.over) : null;
          const pctFull = c && c.fillPct !== null ? Math.min(c.fillPct, 100) : 0;
          return (
            <button key={d} type="button" className={`sc-wk${d === data.today ? " sc-wktoday" : ""}`} onClick={() => open(d)} aria-label={`${longDay(d)}, open the day`}>
              <span className="sc-wkd">
                {dayNum(d)}
                {newMonth ? ` ${monthOf(d).slice(0, 3)}` : ""}
              </span>
              {c && c.capacityMinutes > 0 ? (
                <>
                  <span className="sc-wkh2">
                    {hoursWord(c.bookedMinutes)} of {hoursWord(c.capacityMinutes)}
                  </span>
                  <span className="sc-wkbar" aria-hidden="true">
                    <i className={`sc-wkfill${word ? ` sc-wk--${word.toLowerCase()}` : ""}`} style={{ width: `${pctFull}%` }} />
                  </span>
                  {word ? <StateWord tone={FILL_TONE[word]}>{word}</StateWord> : null}
                  <span className="sc-wkj">{c.jobs === 1 ? "1 job" : `${c.jobs} jobs`}</span>
                </>
              ) : (
                <span className="sc-wkj">No crew hours</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Jobs, on the right ── */

type Tab = "book" | "recent" | "all";
const SHOWN = 40;

function JobsPanel({
  jobs,
  canBook,
  held,
  week,
  pick,
  setHeld,
}: {
  jobs: PanelJob[];
  canBook: boolean;
  held: Held | null;
  week: boolean;
  pick: (j: PanelJob) => void;
  setHeld: (h: Held | null) => void;
}) {
  const host = useContext(WindowsContext);
  const [tab, setTab] = useState<Tab>("book");
  const [q, setQ] = useState("");

  const byUuid = useMemo(() => new Map(jobs.map((j) => [j.uuid.toLowerCase(), j])), [jobs]);
  const list = useMemo(() => {
    const words = q.trim().toLowerCase();
    let base: PanelJob[];
    if (tab === "recent") {
      base = (host?.recent ?? [])
        .filter((r) => r.ref.kind === "job")
        .map((r) => byUuid.get(r.ref.id.toLowerCase()))
        .filter((j): j is PanelJob => !!j);
    } else base = tab === "book" ? jobs.filter((j) => j.toBook) : jobs;
    return (words ? base.filter((j) => j.words.toLowerCase().includes(words)) : base).slice(0, SHOWN);
  }, [tab, q, jobs, host?.recent, byUuid]);

  return (
    <aside className="sc-panel" aria-label="Jobs">
      <h2 className="sc-h2">Jobs</h2>
      <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a job, client or site" aria-label="Find a job, client or site" />
      <Tray
        ariaLabel="Which jobs"
        options={[
          { value: "book", label: "To book" },
          { value: "recent", label: "Recent" },
          { value: "all", label: "All" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {held ? (
        <div className="sc-held">
          <span className="sc-heldn">
            <Dot hue={held.job.hue} />
            <Fade>{jobName(held.job)}</Fade>
          </span>
          {week ? (
            <Chooser aria-label="How many days" size={32} options={DAY_COUNTS} value={String(held.days)} onChange={(v) => setHeld({ ...held, days: Number(v) })} />
          ) : (
            <Chooser aria-label="How long" size={32} options={LENGTHS} value={String(held.minutes)} onChange={(v) => setHeld({ ...held, minutes: Number(v) })} />
          )}
          <Button kind="quiet" size={32} onClick={() => setHeld(null)}>
            Put it down
          </Button>
        </div>
      ) : null}
      {!canBook ? <p className="sc-off">Booking from here is off for you.</p> : null}
      {list.length === 0 ? (
        <p className="sc-off">{tab === "recent" ? "No jobs opened lately." : q ? "No job matches that." : "Nothing to book."}</p>
      ) : (
        <ul className="sc-jobs">
          {list.map((j) => (
            <li key={j.uuid}>
              <button
                type="button"
                className={`sc-job${held?.job.uuid === j.uuid ? " sc-picked" : ""}`}
                draggable
                aria-pressed={held?.job.uuid === j.uuid}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", j.uuid);
                  e.dataTransfer.effectAllowed = "copy";
                  if (held?.job.uuid !== j.uuid) pick(j);
                }}
                onClick={() => pick(j)}
              >
                {/* the grip says it can be dragged (Isaac, 20 October) */}
                <span className="sc-grip" aria-hidden="true">
                  <Icon name="grip" size={16} />
                </span>
                <Dot hue={j.hue} />
                <span className="sc-jt">
                  <Fade className="sc-jn">{jobName(j)}</Fade>
                  <Fade className="sc-jl">{[j.site, j.kind].filter(Boolean).join(", ")}</Fade>
                  {j.state ? <StateWord tone={j.tone}>{j.state}</StateWord> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
