"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DateField } from "@/components/ui/date-field";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { bookJobIn, readBookInContext, type BookInContext, type VerbView } from "@/app/actions/booking-sm8";
import {
  BOOKING_LENGTHS_MIN,
  BOOKING_STEP_MIN,
  BOOKING_WORDS,
  BOOKINGS_PER_PRESS,
  bookingActWord,
  fmtLength,
  fmtRange,
  fmtTime,
  localNow,
  placeName,
  rangeParts,
  slotOf,
  type BookingAct,
  type BookingState,
} from "@/lib/integrations/sm8-booking-plan";
import { fillWords } from "@/lib/integrations/sm8-note-words";
import { mintPressId } from "@/lib/workboard/press-id";
import { thrownWords } from "@/lib/stale-deploy";
import { StateLine } from "./state-line";

/* BOOK IN, ON THE JOB CARD'S VISITS FACE (two-way phase 3, PR D).

   One panel drawn in place at the top of the face, not a modal over the
   card: who, day, start and how long, a row per booking, up to eight. It
   asks ServiceM8 itself before it offers Book in (readBookInContext: the job,
   its bookings and each row's day, for everyone), and says what it found as
   facts in sentences — who else is on that day, and what a row overlaps,
   which warns and never blocks (DECISIONS 6). Nothing here decides whether a
   booking may go: Book in (bookJobIn) refuses in its own words, which sit
   above the buttons, and the panel keeps its rows.

   ONE PRESS PER OPENING. The press id is minted once, when the panel opens,
   and a second press of the same Book in (a double click, or a retry after
   an answer that was lost) sends the same id and the same rows, which the
   server answers with the first press's lines and queues nothing more.

   TIME IS THE ACCOUNT'S WALL CLOCK, as text: a day and "HH:MM", never a
   Date. The browser's clock is read only when the panel opens (for the day
   to ask about first) and its zone only when ServiceM8 answers (to say whose
   time the times are): never in a render.

   Every word is BOOKING_WORDS'. */

/** A row of the panel: one booking. */
type Row = { id: number; staffUuid: string; day: string; start: string; minutes: number };

/** A booking to fill a fresh panel from — Look again and Book again on a
    line open the panel with its person, day, start and length. */
export type BookInSeed = { staffUuid: string | null; start: string | null; end: string | null };

type Ctx = Extract<BookInContext, { ok: true }> & { browserZone: string | null };

const DEFAULT_START = "07:00";
const DEFAULT_MINUTES = 120;

/** Every start on the grid, 12:00 am to 11:45 pm, as "HH:MM". */
const STARTS: readonly string[] = Array.from({ length: (24 * 60) / BOOKING_STEP_MIN }, (_, i) => {
  const m = i * BOOKING_STEP_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/** A row from a booking a line names: its person, day, start and length, or
    the defaults where it has none that the panel offers. */
function seededRow(id: number, seed: BookInSeed | null | undefined): Row {
  const start = seed?.start ?? "";
  const hhmm = start.length >= 16 ? start.slice(11, 16) : "";
  const a = clockMin(start);
  const b = seed?.end ? clockMin(seed.end) : null;
  const span = a !== null && b !== null && seed?.end?.slice(0, 10) === start.slice(0, 10) ? b - a : null;
  return {
    id,
    staffUuid: seed?.staffUuid ?? "",
    day: DAY.test(start.slice(0, 10)) ? start.slice(0, 10) : "",
    start: STARTS.includes(hhmm) ? hhmm : DEFAULT_START,
    minutes: span !== null && (BOOKING_LENGTHS_MIN as readonly number[]).includes(span) ? span : DEFAULT_MINUTES,
  };
}

/** A row whose booking would end past midnight: no slot of that day holds
    it (a booking ends on the day it starts). */
const crossesMidnight = (r: Row) => DAY.test(r.day) && !slotOf(r.day, r.start, r.minutes);

/** The browser's own zone, or null where it can't say. */
function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function BookInPanel({
  jobUuid,
  number,
  zone,
  seed,
  onDone,
  onCancel,
}: {
  jobUuid: string;
  /** The job's number, for the panel's title. */
  number: string | null;
  /** The account's zone as the card last read it: which day to ask about
      first. ServiceM8's answer is what the panel then goes by. */
  zone: string | null;
  seed?: BookInSeed | null;
  /** Book in went: the press's lines, and the rows it queued (what the card
      polls for, whatever the lines could say yet). */
  onDone: (verb: VerbView, rowIds: string[]) => void;
  onCancel: () => void;
}) {
  const [pressId] = useState(mintPressId);
  const [rows, setRows] = useState<Row[]>(() => [seededRow(1, seed)]);
  const [nextId, setNextId] = useState(2);
  const [ctx, setCtx] = useState<Ctx | null>(null);
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
      }
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

  const setRow = (id: number, patch: Partial<Row>) => {
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
      }
    );
  };

  const title = number ?? ctx?.job.number ?? null;

  return (
    <div className="wb2-jcsec" role="group" aria-label={title ? fillWords(BOOKING_WORDS.panel.title, { number: title }) : BOOKING_WORDS.panel.book}>
      <div className="wb2-jcdhead">
        <b>{title ? fillWords(BOOKING_WORDS.panel.title, { number: title }) : BOOKING_WORDS.panel.book}</b>
      </div>

      {rows.map((r, i) => (
        <div className="wb2-jcattform" key={r.id}>
          <label className="wb2-jcattfield short">
            <span>{BOOKING_WORDS.panel.who}</span>
            <select
              className="wb2-sel"
              aria-label={BOOKING_WORDS.panel.who}
              value={r.staffUuid}
              onChange={(e) => setRow(r.id, { staffUuid: e.target.value })}
            >
              <option value="">{BOOKING_WORDS.panel.pickWho}</option>
              {(ctx?.staff ?? []).map((s) => (
                <option key={s.uuid} value={s.uuid}>
                  {s.you ? BOOKING_WORDS.panel.you : s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="wb2-jcattfield short">
            <span>{BOOKING_WORDS.panel.day}</span>
            <DateField
              value={r.day || null}
              onChange={(iso) => setRow(r.id, { day: iso ?? "" })}
              today={ctx?.today}
              aria-label={BOOKING_WORDS.panel.day}
            />
          </div>
          <label className="wb2-jcattfield short">
            <span>{BOOKING_WORDS.panel.start}</span>
            <select
              className="wb2-sel"
              aria-label={BOOKING_WORDS.panel.start}
              value={r.start}
              onChange={(e) => setRow(r.id, { start: e.target.value })}
            >
              {STARTS.map((s) => (
                <option key={s} value={s}>
                  {fmtTime(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="wb2-jcattfield short">
            <span>{BOOKING_WORDS.panel.length}</span>
            <select
              className="wb2-sel"
              aria-label={BOOKING_WORDS.panel.length}
              value={String(r.minutes)}
              onChange={(e) => setRow(r.id, { minutes: Number(e.target.value) })}
            >
              {BOOKING_LENGTHS_MIN.map((m) => (
                <option key={m} value={String(m)}>
                  {fmtLength(m)}
                </option>
              ))}
            </select>
          </label>
          {i > 0 && (
            <button type="button" className="wb2-evdoor" onClick={() => removeRow(r.id)}>
              {BOOKING_WORDS.panel.remove}
            </button>
          )}
          {/* a row that runs past midnight is refused here, before anything
              is pressed: Book in stays off until it ends on its own day */}
          {crossesMidnight(r) && (
            <p className="wb2-jcattgap">
              <StateLine as="span" line={{ word: BOOKING_WORDS.press.crossesMidnight, tone: "bad" }} />
            </p>
          )}
        </div>
      ))}
      {rows.length < BOOKINGS_PER_PRESS && (
        <div className="wb2-jcattsave">
          <button type="button" className="wb2-evdoor" onClick={addRow}>
            {BOOKING_WORDS.panel.addAnother}
          </button>
        </div>
      )}

      {!ctx && !readErr && <div className="wb2-evmeta">{BOOKING_WORDS.panel.checking}</div>}
      {readErr && (
        <div className="wb2-jcattsave">
          <span className="wb2-evmeta">
            <StateLine as="span" line={{ word: readErr, tone: "bad" }} />
          </span>
          <button type="button" className="wb2-evdoor" onClick={tryReadAgain}>
            {BOOKING_WORDS.door.tryAgain}
          </button>
        </div>
      )}

      {ctx && <Facts ctx={ctx} jobUuid={jobUuid} rows={rows} staffName={staffName} />}

      {ctx && quote && (
        <>
          <label className="wb2-flcheck">
            <input type="checkbox" checked={makeWorkOrder} onChange={(e) => setMakeWorkOrder(e.target.checked)} />
            {BOOKING_WORDS.panel.makeWorkOrder}
          </label>
          <div className="wb2-evmeta">{makeWorkOrder ? BOOKING_WORDS.panel.quoteBecomes : BOOKING_WORDS.panel.quoteStays}</div>
        </>
      )}

      {ctx && complete && <Confirm rows={rows} staffName={staffName} />}
      {ctx?.trial && <div className="wb2-evmeta">{BOOKING_WORDS.panel.trial}</div>}
      {ctx?.hold === "paused" && <div className="wb2-evmeta">{BOOKING_WORDS.panel.heldPaused}</div>}
      {ctx?.hold === "reconnect" && <div className="wb2-evmeta">{BOOKING_WORDS.panel.heldReconnect}</div>}

      {err && (
        <div className="wb2-jcattsave">
          <span className="wb2-evmeta">
            <StateLine as="span" line={{ word: err.text, tone: "bad" }} />
          </span>
          {err.lookAgain && (
            <button type="button" className="wb2-evdoor" onClick={lookAgain}>
              {BOOKING_WORDS.door.lookAgain}
            </button>
          )}
        </div>
      )}

      <div className="wb2-jcattsave">
        <button type="button" className="pbtn" disabled={!complete || busy} onClick={book}>
          {rows.length > 1 ? fillWords(BOOKING_WORDS.panel.bookMany, { n: rows.length }) : BOOKING_WORDS.panel.book}
        </button>
        <button type="button" className="pbtn ghost" disabled={busy} onClick={onCancel}>
          {BOOKING_WORDS.panel.cancel}
        </button>
      </div>
    </div>
  );
}

/** The days not read yet, marked unread: a re-read that failed. */
function unreadDays(c: Ctx, days: readonly string[]): Ctx {
  const next = { ...c.days };
  for (const d of days) if (!(d in next)) next[d] = null;
  return { ...c, days: next };
}

type LiveAct = Ctx["bookings"][number];

/** What ServiceM8 said, as sentences: the job's bookings, each chosen
    person's day and what a row overlaps, and whose time the times are. */
function Facts({
  ctx,
  jobUuid,
  rows,
  staffName,
}: {
  ctx: Ctx;
  jobUuid: string;
  rows: readonly Row[];
  staffName: (uuid: string) => string | null;
}) {
  const already = ctx.bookings
    .filter((a) => a.scheduled === 1 && !!a.start && a.start.slice(0, 10) >= ctx.today)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))
    .map((a) =>
      [fmtAuWeekdayDayMonth(a.start), fmtTime(a.start ?? ""), a.staffUuid ? staffName(a.staffUuid) : null].filter(Boolean).join(", ")
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

  const place = ctx.browserZone && ctx.browserZone !== ctx.zone ? placeName(ctx.zone) : null;

  return (
    <>
      {already.length > 0 && <div className="wb2-evmeta">{fillWords(BOOKING_WORDS.panel.already, { list: already.join("; ") })}</div>}
      {people.map((p) => {
        const name = staffName(p.staffUuid) ?? BOOKING_WORDS.fill.person;
        const others = elsewhere(p.staffUuid, p.day);
        if (others === undefined) return null;
        const text =
          others === null
            ? fillWords(BOOKING_WORDS.panel.dayUnread, { name })
            : others.length === 0
              ? fillWords(BOOKING_WORDS.panel.dayFree, { name })
              : fillWords(BOOKING_WORDS.panel.dayOf, { name, list: others.map(said).join("; ") });
        return (
          <div className="wb2-evmeta" key={`${p.staffUuid}|${p.day}`}>
            {text}
          </div>
        );
      })}
      {clashes.map((c) => (
        <div className="wb2-evmeta" key={c}>
          <StateLine as="span" line={{ word: c, tone: "warn" }} />
        </div>
      ))}
      {place && <div className="wb2-evmeta">{fillWords(BOOKING_WORDS.panel.zone, { place })}</div>}
    </>
  );
}

/** What Book in will book, said before it is pressed. */
function Confirm({ rows, staffName }: { rows: readonly Row[]; staffName: (uuid: string) => string | null }) {
  const said = rows.map((r) => {
    const slot = slotOf(r.day, r.start, r.minutes);
    const parts = slot ? rangeParts(slot.start, slot.end) : { start: fmtTime(r.start), end: "" };
    return { name: staffName(r.staffUuid) ?? BOOKING_WORDS.fill.person, day: fmtAuWeekdayDayMonth(r.day), ...parts };
  });
  if (said.length === 1) return <div className="wb2-evmeta">{fillWords(BOOKING_WORDS.panel.confirmOne, said[0])}</div>;
  return (
    <div className="wb2-evmeta">
      {fillWords(BOOKING_WORDS.panel.confirmMany, { n: said.length })}
      {said.map((s, i) => (
        <div key={i}>{fillWords(BOOKING_WORDS.panel.confirmRow, s)}</div>
      ))}
    </div>
  );
}

/* ── a booking's line on the Visits face ── */

/** Whether any line on the card is on its way: the card polls while one is. */
const WAITING: ReadonlySet<string> = new Set([
  "line.sending",
  "line.waitingWhy",
  "line.takingOut",
  "line.statusSending",
  "line.clearing",
  "line.clearWaiting",
]);

export function bookingsWaiting(verbs: readonly VerbView[] | null, lines: Record<string, BookingState>): boolean {
  const on = (s: BookingState | null | undefined) => !!s?.key && WAITING.has(s.key);
  if (Object.values(lines).some(on)) return true;
  return (verbs ?? []).some((v) => on(v.status?.state) || v.bookings.some((b) => on(b.state)));
}

/** One booking as a line of the list: its day and time, and who. */
export function BookingEntryLine({
  start,
  end,
  name,
  title,
  startOnly = false,
}: {
  start: string;
  end: string | null;
  name: string | null;
  title?: string | null;
  /** A leftover says its start alone ("Tue 6 Oct, 9:00 am"). */
  startOnly?: boolean;
}) {
  const when = !startOnly && end ? fmtRange(start, end) : fmtTime(start);
  return (
    <div className="wb2-mline">
      <b>{`${fmtAuWeekdayDayMonth(start)}, ${when}`}</b>
      <em>
        {name ?? BOOKING_WORDS.fill.person}
        {name && title && <i className="wb2-jcrole">{`, ${title}`}</i>}
      </em>
    </div>
  );
}

/** A line's state in its colour and its doors, each a word (law 25).
    Open in ServiceM8 is a link; Look again and Book again open the panel,
    and are left off where the panel can't open. */
export function BookingStateLine({
  state,
  sm8Url,
  busy,
  canPanel,
  onAct,
}: {
  state: BookingState;
  sm8Url: string | null;
  busy: boolean;
  canPanel: boolean;
  onAct: (act: BookingAct) => void;
}) {
  const acts = state.acts.filter(
    (a) => (a !== "open_in_sm8" || !!sm8Url) && ((a !== "look_again" && a !== "book_again") || canPanel)
  );
  if (!state.text && acts.length === 0) return null;
  return (
    <div className="wb2-jcattsave">
      {state.text && (
        <span className="wb2-evmeta">
          <StateLine as="span" line={{ word: state.text, tone: state.tone }} />
        </span>
      )}
      {acts.map((a) =>
        a === "open_in_sm8" ? (
          <a key={a} className="wb2-evdoor" href={sm8Url ?? undefined} target="_blank" rel="noreferrer">
            {bookingActWord(a)}
          </a>
        ) : (
          <button key={a} type="button" className="wb2-evdoor" disabled={busy} onClick={() => onAct(a)}>
            {bookingActWord(a)}
          </button>
        )
      )}
    </div>
  );
}

/** Clearing a leftover, asked in place: the booking, the job and that it
    can't be put back (DECISIONS 4), with the focus on Keep, so a second
    Enter backs out. */
export function ClearConfirm({
  name,
  start,
  number,
  status,
  busy,
  onClear,
  onKeep,
}: {
  name: string | null;
  start: string;
  number: string | null;
  status: string | null;
  busy: boolean;
  onClear: () => void;
  onKeep: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  const question = fillWords(BOOKING_WORDS.home.clearConfirm, {
    name: name ?? BOOKING_WORDS.fill.person,
    day: fmtAuWeekdayDayMonth(start),
    start: fmtTime(start),
    number,
    status: status ?? BOOKING_WORDS.fill.status,
  });
  /* phrasing all through: it stands in a crew row's line on the Schedule as
     well as on the card. The question is a <small>, not a span, so the
     crew list's own rule for its spans (the time, 14px in ink) never
     reaches it: it keeps the quiet line's dress in both places */
  return (
    <span role="group" aria-label={question}>
      <small className="wb2-evmeta">{question}</small>
      <span className="wb2-jcattsave">
        <button type="button" className="pbtn ghost sm dan" disabled={busy} onClick={onClear}>
          {BOOKING_WORDS.door.clearBooking}
        </button>
        <button type="button" className="pbtn ghost sm" ref={keep} disabled={busy} onClick={onKeep}>
          {BOOKING_WORDS.door.keep}
        </button>
      </span>
    </span>
  );
}

/** A leftover's words: the job is finished in ServiceM8, and the booking is
    still there. */
export function leftoverWords(jobStatus: string | null): string {
  return jobStatus === "Unsuccessful" ? BOOKING_WORDS.line.leftoverUnsuccessful : BOOKING_WORDS.line.leftover;
}
