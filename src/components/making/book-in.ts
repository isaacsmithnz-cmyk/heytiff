"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { bookJobIn, readBookInContext, type BookInContext, type VerbView } from "@/app/actions/booking-sm8";
import {
  BOOKING_LENGTHS_MIN,
  BOOKING_STEP_MIN,
  BOOKING_WORDS,
  BOOKINGS_PER_PRESS,
  fmtRange,
  fmtTime,
  localNow,
  placeName,
  rangeParts,
  slotOf,
} from "@/lib/integrations/sm8-booking-plan";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { mintPressId } from "@/lib/workboard/press-id";
import { thrownWords } from "@/lib/stale-deploy";
import { awayInSlot, closedInSlot } from "@/lib/workboard/away";

/* BOOK IN'S ENGINE (two-way phase 3, PR D), lifted out of the job card's
   Book in panel so the Visit form (./visit-form) draws it, unchanged: who,
   day, start and how long, a row per booking, up to eight. It asks
   ServiceM8 itself before it offers Book (readBookInContext: the job, its
   bookings and each row's day, for everyone), and says what it found as
   facts in sentences, who else is on that day and what a row overlaps,
   which warns and never blocks (DECISIONS 6). Nothing here decides whether
   a booking may go: Book (bookJobIn) refuses in its own words, which the
   form says above its buttons, and the rows stay.

   ONE PRESS PER OPENING. The press id is minted once, when the form opens,
   and a second press of the same Book (a double click, or a retry after an
   answer that was lost) sends the same id and the same rows, which the
   server answers with the first press's lines and queues nothing more.

   TIME IS THE ACCOUNT'S WALL CLOCK, as text: a day and "HH:MM", never a
   Date. The browser's clock is read only when the form opens (for the day
   to ask about first) and its zone only when ServiceM8 answers (to say
   whose time the times are): never in a render.

   Every word is BOOKING_WORDS'. */

/** A row of the form: one booking. */
export type BookInRow = { id: number; staffUuid: string; day: string; start: string; minutes: number };

/** A booking to fill a fresh form from: Look again and Book again on a
    line open the form with its person, day, start and length. */
export type BookInSeed = { staffUuid: string | null; start: string | null; end: string | null };

export type BookInCtx = Extract<BookInContext, { ok: true }> & { browserZone: string | null };

const DEFAULT_START = "07:00";
const DEFAULT_MINUTES = 120;

/** Every start on the grid, 12:00 am to 11:45 pm, as "HH:MM". */
export const BOOKING_STARTS: readonly string[] = Array.from({ length: (24 * 60) / BOOKING_STEP_MIN }, (_, i) => {
  const m = i * BOOKING_STEP_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const isDay = (d: string) => DAY.test(d);

/** The next Monday-to-Friday after `day`, as text (DECISIONS 13). */
export function nextWeekday(day: string): string {
  const m = DAY.exec(day);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

const clockMin = (stamp: string) => {
  const hit = /(\d{2}):(\d{2})(?::\d{2})?$/.exec(stamp.trim());
  return hit ? Number(hit[1]) * 60 + Number(hit[2]) : null;
};

const low = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** A time-off sentence with the business's own word, or without its
    ": {word}" where it typed none. */
function withWord(text: string, word: string | null, fill: Record<string, string>): string {
  return fillWords(word ? text : text.replace(/: \{word\}/, ""), { ...fill, word: word ?? "" });
}

/** A row from a booking a line names: its person, day, start and length, or
    the defaults where it has none that the form offers. */
function seededRow(id: number, seed: BookInSeed | null | undefined): BookInRow {
  const start = seed?.start ?? "";
  const hhmm = start.length >= 16 ? start.slice(11, 16) : "";
  const a = clockMin(start);
  const b = seed?.end ? clockMin(seed.end) : null;
  const span = a !== null && b !== null && seed?.end?.slice(0, 10) === start.slice(0, 10) ? b - a : null;
  return {
    id,
    staffUuid: seed?.staffUuid ?? "",
    day: DAY.test(start.slice(0, 10)) ? start.slice(0, 10) : "",
    start: BOOKING_STARTS.includes(hhmm) ? hhmm : DEFAULT_START,
    minutes: span !== null && (BOOKING_LENGTHS_MIN as readonly number[]).includes(span) ? span : DEFAULT_MINUTES,
  };
}

/** A row whose booking would end past midnight: no slot of that day holds
    it (a booking ends on the day it starts). */
export const crossesMidnight = (r: BookInRow) => DAY.test(r.day) && !slotOf(r.day, r.start, r.minutes);

/** The browser's own zone, or null where it can't say. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The days not read yet, marked unread: a re-read that failed. */
function unreadDays(c: BookInCtx, days: readonly string[]): BookInCtx {
  const next = { ...c.days };
  for (const d of days) if (!(d in next)) next[d] = null;
  return { ...c, days: next };
}

export function useBookIn({
  jobUuid,
  zone,
  seed,
  onDone,
}: {
  jobUuid: string;
  /** The account's zone as the card last read it: which day to ask about
      first. ServiceM8's answer is what the form then goes by. */
  zone: string | null;
  seed?: BookInSeed | null;
  /** Book went: the press's lines, and the rows it queued. */
  onDone: (verb: VerbView, rowIds: string[]) => void;
}) {
  const [pressId] = useState(mintPressId);
  const [rows, setRows] = useState<BookInRow[]>(() => [seededRow(1, seed)]);
  const [nextId, setNextId] = useState(2);
  const [ctx, setCtx] = useState<BookInCtx | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [makeWorkOrder, setMakeWorkOrder] = useState(true);
  const [err, setErr] = useState<{ text: string; lookAgain: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const alive = useRef(true);
  const reading = useRef(false);
  const hasCtx = useRef(false);
  const askedFor = useRef("");
  const pressing = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Read ServiceM8 for these days: the job, its bookings and each day. A
      read that fails before anything was read says so, with Try again; one
      that fails after only leaves the new days unread (advice, U12). */
  const load = (days: readonly string[]) => {
    if (reading.current) return;
    reading.current = true;
    askedFor.current = days.join(",");
    void readBookInContext({ jobUuid, days: [...days] }).then(
      (r) => {
        reading.current = false;
        if (!alive.current) return;
        if (r.ok) {
          hasCtx.current = true;
          setCtx({ ...r, browserZone: browserZone() });
          setReadErr(null);
          setRows((cur) => cur.map((x) => (x.day ? x : { ...x, day: nextWeekday(r.today) })));
          return;
        }
        if (hasCtx.current) setCtx((c) => (c ? unreadDays(c, days) : c));
        else setReadErr(r.error);
      },
      () => {
        reading.current = false;
        if (!alive.current) return;
        if (hasCtx.current) setCtx((c) => (c ? unreadDays(c, days) : c));
        else setReadErr(BOOKING_WORDS.panel.readFailed);
      },
    );
  };

  const wanted = [...new Set(rows.map((r) => r.day).filter((d) => DAY.test(d)))].slice(0, BOOKINGS_PER_PRESS);
  const wantedKey = wanted.join(",");

  /* opening: the day asked about first is the row's own, or the next
     weekday on the account's clock as the card last knew it */
  const open = useEffectEvent(() => {
    const today = zone ? localNow(zone, Date.now())?.slice(0, 10) : null;
    const first = wanted.length > 0 ? wanted : today ? [nextWeekday(today)] : [];
    load(first);
  });
  useEffect(() => {
    open();
  }, []);

  /* a row on a day not read yet: read again, with every row's day */
  const readNewDays = useEffectEvent(() => {
    if (!ctx || reading.current || askedFor.current === wantedKey) return;
    if (wanted.some((d) => !(d in ctx.days))) load(wanted);
  });
  useEffect(() => {
    readNewDays();
  }, [ctx, wantedKey]);

  const lookAgain = () => {
    setErr(null);
    setCtx(null);
    hasCtx.current = false;
    load(wanted);
  };
  const tryReadAgain = () => {
    setReadErr(null);
    load(wanted);
  };

  const setRow = (id: number, patch: Partial<BookInRow>) => {
    setErr(null);
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    if (rows.length >= BOOKINGS_PER_PRESS) return;
    const last = rows[rows.length - 1];
    setRows([...rows, { id: nextId, staffUuid: "", day: last.day, start: last.start, minutes: last.minutes }]);
    setNextId(nextId + 1);
  };
  const removeRow = (id: number) => {
    setErr(null);
    setRows(rows.filter((r) => r.id !== id));
  };

  const staffName = (uuid: string) => ctx?.staff.find((s) => low(s.uuid) === low(uuid))?.name ?? null;
  const complete = !!ctx && rows.every((r) => !!r.staffUuid && DAY.test(r.day) && !crossesMidnight(r));
  const quote = ctx?.job.status === "Quote";

  const book = () => {
    if (pressing.current || !ctx || !complete) return;
    pressing.current = true;
    setBusy(true);
    setErr(null);
    void bookJobIn({
      jobUuid,
      pressId,
      seen: { jobEditDate: ctx.job.editDate, readAt: ctx.readAt },
      makeWorkOrder: quote && makeWorkOrder,
      bookings: rows.map((r) => ({ staffUuid: r.staffUuid, day: r.day, start: r.start, minutes: r.minutes })),
    }).then(
      (r) => {
        pressing.current = false;
        if (!alive.current) return;
        setBusy(false);
        if (r.ok) onDone(r.verb, r.rowIds);
        else setErr({ text: r.error, lookAgain: r.lookAgain === true });
      },
      (e: unknown) => {
        pressing.current = false;
        if (!alive.current) return;
        setBusy(false);
        setErr({ text: thrownWords(e, BOOKING_WORDS.press.unqueued), lookAgain: false });
      },
    );
  };

  return {
    rows,
    ctx,
    readErr,
    err,
    busy,
    makeWorkOrder,
    setMakeWorkOrder,
    complete,
    quote,
    staffName,
    setRow,
    addRow,
    removeRow,
    lookAgain,
    tryReadAgain,
    book,
  };
}

type LiveAct = BookInCtx["bookings"][number];

/** What ServiceM8 said, as sentences: the job's bookings, each chosen
    person's day, what a row overlaps (a warning, never a refusal), and
    whose time the times are. */
export function bookInFacts(
  ctx: BookInCtx,
  jobUuid: string,
  rows: readonly BookInRow[],
  staffName: (uuid: string) => string | null,
): { already: string | null; days: { key: string; text: string }[]; clashes: string[]; zone: string | null } {
  const booked = ctx.bookings
    .filter((a) => a.scheduled === 1 && !!a.start && a.start.slice(0, 10) >= ctx.today)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
    .map((a) =>
      [fmtAuWeekdayDayMonth(a.start), fmtTime(a.start ?? ""), a.staffUuid ? staffName(a.staffUuid) : null].filter(Boolean).join(", "),
    );

  /* one line per person and day chosen, in the rows' order */
  const people: { staffUuid: string; day: string }[] = [];
  for (const r of rows) {
    if (!r.staffUuid || !DAY.test(r.day)) continue;
    if (!people.some((p) => low(p.staffUuid) === low(r.staffUuid) && p.day === r.day)) people.push({ staffUuid: r.staffUuid, day: r.day });
  }
  /** Their other bookings that day: on other jobs, booked, in start order. */
  const elsewhere = (staffUuid: string, day: string): LiveAct[] | null | undefined => {
    const acts = ctx.days[day];
    if (acts === undefined || acts === null) return acts;
    return acts
      .filter((a) => a.scheduled === 1 && low(a.staffUuid) === low(staffUuid) && low(a.jobUuid) !== low(jobUuid) && !!a.start && !!a.end)
      .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  };
  const said = (a: LiveAct) => {
    const number = ctx.jobNumbers[low(a.jobUuid)];
    const parts = rangeParts(a.start ?? "", a.end ?? "");
    return number ? fillWords(BOOKING_WORDS.panel.dayJob, { number, start: parts.start, end: parts.end }) : fmtRange(a.start ?? "", a.end ?? "");
  };

  const days: { key: string; text: string }[] = [];
  for (const p of people) {
    const name = staffName(p.staffUuid) ?? BOOKING_WORDS.fill.person;
    const others = elsewhere(p.staffUuid, p.day);
    if (others === undefined) continue;
    const text =
      others === null
        ? fillWords(BOOKING_WORDS.panel.dayUnread, { name })
        : others.length === 0
          ? fillWords(BOOKING_WORDS.panel.dayFree, { name })
          : fillWords(BOOKING_WORDS.panel.dayOf, { name, list: others.map(said).join("; ") });
    days.push({ key: `${p.staffUuid}|${p.day}`, text });
  }

  /* what each row overlaps: a warning, never a refusal (DECISIONS 6) */
  const clashes: string[] = [];
  for (const r of rows) {
    const slot = r.staffUuid && DAY.test(r.day) ? slotOf(r.day, r.start, r.minutes) : null;
    if (!slot) continue;
    for (const a of elsewhere(r.staffUuid, r.day) ?? []) {
      if ((a.start ?? "") >= slot.end || (a.end ?? "") <= slot.start) continue;
      const number = ctx.jobNumbers[low(a.jobUuid)];
      const parts = rangeParts(a.start ?? "", a.end ?? "");
      /* a job the mirror can't number yet still warns, as another job */
      const text = number
        ? fillWords(BOOKING_WORDS.panel.clash, { number, start: parts.start, end: parts.end })
        : fillWords(BOOKING_WORDS.panel.clashUnnumbered, { start: parts.start, end: parts.end });
      if (!clashes.includes(text)) clashes.push(text);
    }
  }

  /* TIME OFF UNDER A ROW, from the mirror (leave to ServiceM8, part two):
     the person's own, and the business shut. A warning in the clash's
     colour and never a refusal: the office may know the golf is off. A day
     the mirror couldn't answer for says nothing. */
  for (const r of rows) {
    const slot = r.staffUuid && DAY.test(r.day) ? slotOf(r.day, r.start, r.minutes) : null;
    const off = slot ? ctx.off?.[r.day] : undefined;
    if (!slot || !off) continue;
    for (const c of closedInSlot(off.closed, slot)) {
      const text =
        c.kind === "holiday"
          ? withWord(BOOKING_WORDS.panel.holiday, c.name, { day: fmtAuWeekdayDayMonth(r.day) })
          : withWord(BOOKING_WORDS.panel.closed, c.name, {});
      if (!clashes.includes(text)) clashes.push(text);
    }
    const name = staffName(r.staffUuid) ?? BOOKING_WORDS.fill.person;
    for (const a of awayInSlot(off.away, r.staffUuid, slot)) {
      const whole = a.start <= `${r.day} 00:00:00` && a.end >= `${r.day} 23:59:00`;
      /* said on this day's clock: time off from yesterday starts at
         midnight, and time off into tomorrow ends at the day's end */
      const parts = rangeParts(
        a.start < `${r.day} 00:00:00` ? `${r.day} 00:00:00` : a.start,
        a.end > `${r.day} 23:59:59` ? `${r.day} 23:59:00` : a.end,
      );
      const text = whole
        ? withWord(BOOKING_WORDS.panel.awayDay, a.name, { name })
        : withWord(BOOKING_WORDS.panel.awayPart, a.name, { name, start: parts.start, end: parts.end });
      if (!clashes.includes(text)) clashes.push(text);
    }
  }

  const place = ctx.browserZone && ctx.browserZone !== ctx.zone ? placeName(ctx.zone) : null;
  return {
    already: booked.length > 0 ? fillWords(BOOKING_WORDS.panel.already, { list: booked.join("; ") }) : null,
    days,
    clashes,
    zone: place ? fillWords(BOOKING_WORDS.panel.zone, { place }) : null,
  };
}

/** What Book will book, said before it is pressed: one sentence, or "Books
    2:" and a sentence a booking. */
export function bookInConfirm(rows: readonly BookInRow[], staffName: (uuid: string) => string | null): string {
  const said = rows.map((r) => {
    const slot = slotOf(r.day, r.start, r.minutes);
    const parts = slot ? rangeParts(slot.start, slot.end) : { start: fmtTime(r.start), end: "" };
    return { name: staffName(r.staffUuid) ?? BOOKING_WORDS.fill.person, day: fmtAuWeekdayDayMonth(r.day), ...parts };
  });
  if (said.length === 1) return fillWords(BOOKING_WORDS.panel.confirmOne, said[0]);
  return [fillWords(BOOKING_WORDS.panel.confirmMany, { n: said.length }), ...said.map((s) => fillWords(BOOKING_WORDS.panel.confirmRow, s))].join(" ");
}
