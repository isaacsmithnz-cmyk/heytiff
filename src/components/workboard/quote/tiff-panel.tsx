"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { Dot } from "@/components/parts/state";
import { Fade } from "@/components/parts/fade";
import { Tray } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { useNoteScope } from "@/components/notes/note-context";
import { CvBox } from "@/components/conversations/box";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { useReplyDraft } from "@/components/notes/use-reply-draft";
import { fmtAuTime } from "@/lib/au-dates";
import { planOf, type PlannedPart } from "@/lib/quotes/build-progress";
import { researchDetailOf } from "@/lib/quotes/research";
import { replyBlocks, type ReplySpan } from "@/lib/quotes/session/reply-blocks";
import { latestAsked } from "@/lib/quotes/session/answers";
import { buildingFirst, stepOf, timeLeft, turnStartOf, type Took } from "@/lib/quotes/session/time-left";
import { waitingIds } from "@/lib/quotes/session/queued";
import { writeUpOf } from "@/lib/quotes/write-up";
import { fmtAddition, fmtAud } from "@/lib/workboard/project-money";
import { QuoteScope, type QuoteScopeWords } from "./quote-scope";

/* TIFF ON THE QUOTE: the page's main column (the chat-first quote page,
   Isaac, 2026-10-13; it was a grey card in the rail, slice 5.1). The
   conversation reads down a column no wider than reading wants: your words
   in a light bubble on the right, hers under her name, what she did as she
   did it, and at the foot what's To confirm (her questions, each answer
   priced, then what the page has to confirm), down to the reply box (Isaac,
   2026-10-11), with the microphone and a blue Send that carries its word
   (layout C, Q6). Before the first message, her mark and a hello. What
   she has cost is the rail's to say now, to someone who sees money: the
   page is told it, and whether she's on, as she's read.

   While she works the page reads her saved thread every second and a half
   (slice 5.2), and the quote's lines with it, so they appear as she adds
   them, whichever tab is up: the column stays mounted under the line items.
   A reload or a closed tab loses nothing: the work is saved as it goes. Off
   until her model is chosen: then there's nothing here, and the page lays
   the line items out in her place.

   SCOPE (layout B, Isaac, 21 October 2026): a tray at the column's top,
   Conversation and Scope. Scope is her reading of the job, the write-up
   that headed the thread, with what her last one changed marked Changed;
   moved out of the thread, it is never scrolled away. The reply box stays
   under both. */

const ROUTE = "/api/workboard/quote-session";
/** How often the thread is read while she works, ms. */
const POLL_MS = 1500;

type Ev = { id: number; turnId: string | null; kind: string; author: string; body: Record<string, unknown>; at: string };
type QState = { deltas: (number | null)[]; answered: { index: number; label: string; by: string; typed?: true } | null };
type View = { ok: boolean; on?: boolean; working?: boolean; took?: Took; spentUsd?: number; events?: Ev[]; names?: Record<string, string>; me?: string; questions?: Record<number, QState> };
type Answer = { label: string };
type Source = { id: string; label: string; text: string };

/** What she's doing and about how long is left, while she works. Until the turn's first event is back, it counts from when this appeared. */
function TimeLeft({ since, first, step, took }: { since: number | null; first: boolean; step: string | null; took: readonly number[] | undefined }) {
  const [opened] = useState(() => Date.now());
  const [now, setNow] = useState(opened);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = timeLeft((now - (since ?? opened)) / 1000, first, took);
  const word = step ?? (first ? "Reading the job" : "Working on the quote");
  return (
    <div className="qt-est qc-in">
      <p className="qt-working">
        <TiffGlyph working size={20} />
        {word}
        {/* the chat's jumping dots after her words, the mark still turning (Isaac, 13 November 2026: "just adding the dots next to whatever the wording is") */}
        <span className="tc-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {left && <span className="qt-left">{left.words}</span>}
      </p>
      {left && (
        <div className="qb-bar" role="progressbar" aria-label={word} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(left.percent)} aria-valuetext={left.words}>
          <i style={{ width: `${left.percent}%` }} />
        </div>
      )}
    </div>
  );
}

/** The web's mark: on a price researched from it, and on the line that uses one (12.2). */
export function Globe({ size = 14 }: { size?: number }) {
  return (
    <svg className="qt-globe" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  );
}

/** A price difference as an answer shows it: nothing for none. */
const deltaWords = (c: number | null | undefined) => (c == null ? "" : fmtAddition(c));

/** Words as she or you wrote them: a blank line starts a paragraph. */
const paras = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => <p key={i}>{p}</p>);

const spans = (line: ReplySpan[]) => line.map((s, i) => (s.bold ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>));

/** Her reply as it's meant to read: her sentences, her points as a list, her
    questions numbered. The model writes "- **Labour:** 12 h", and it stood on
    the page with its asterisks (3423, Isaac, 30 October 2026: "The formatting
    of her messages needs to be much better"). */
const herWords = (text: string) =>
  replyBlocks(text).map((b, i) =>
    b.kind === "para" ? (
      <p key={i}>{spans(b.spans)}</p>
    ) : b.kind === "bullets" ? (
      <ul key={i} className="qc-list">
        {b.items.map((it, j) => (
          <li key={j}>{spans(it)}</li>
        ))}
      </ul>
    ) : (
      <ol key={i} className="qc-list" start={b.start}>
        {b.items.map((it, j) => (
          <li key={j}>{spans(it)}</li>
        ))}
      </ol>
    )
  );

export function TiffPanel({
  job,
  onChanged,
  onOpen,
  onPlan,
  onStatus,
  confirm,
  confirmTitle = "To confirm",
  hidden = false,
  start = false,
  words,
  say = null,
  onSaid,
}: {
  job: string;
  onChanged: () => void;
  /** how many of her questions are open, for the progress line's To confirm */
  onOpen?: (n: number) => void;
  /** the parts she said she'd build, while she builds them; null when she isn't (5.2) */
  onPlan?: (plan: { option: number; parts: PlannedPart[] } | null) => void;
  /** the proposal's words, which Scope opens with */
  words?: QuoteScopeWords;
  /** whether she's on for the business, once read, and what she has cost
      (sent only to someone who sees money): the page's layout, and its rail */
  onStatus?: (status: { on: boolean; spentUsd: number | null }) => void;
  /** what the page has to confirm, under her questions (lines it can't
      price, assumptions, a loading with no reason); null when nothing */
  confirm?: ReactNode;
  /** the list's name: on the proposal, "Before you approve" */
  confirmTitle?: string;
  /** the line items or the paper are up: kept mounted, so her work still lands */
  hidden?: boolean;
  /** opened from the job card to start the quote: the reply box takes the keys */
  start?: boolean;
  /** words the page says to her for the person (Price them), once each */
  say?: { id: number; text: string } | null;
  /** she has them */
  onSaid?: () => void;
}) {
  /* null until her thread is first read: the page lays out nothing of hers
     or the lines' until it knows which */
  const [on, setOn] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  /* how long her turns took here, from the thread's read */
  const [took, setTook] = useState<Took | null>(null);
  /* what she's cost: sent only to someone who sees money */
  const [spent, setSpent] = useState<number | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState("");
  const [questions, setQuestions] = useState<Record<number, QState>>({});
  /* whether her questions have been read with their answers: until then an
     answered one would show as open, its answers to tap */
  const [answersIn, setAnswersIn] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /* researched prices put on their lines this visit */
  const [used, setUsed] = useState<Set<number>>(new Set());
  /* the runs of her working opened to every step, by their first event */
  const [opened, setOpened] = useState<Set<number>>(new Set());
  /* Read the job: its sources, and which are ticked */
  const [sources, setSources] = useState<{ list: Source[]; left: number } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  /* the conversation, her reading of the job, or what's to confirm: her
     questions have their own tab so the conversation's foot stays its
     newest words (Isaac, 27 October 2026: "move all of the questions away
     from the bottom of the screen so they don't clog it up") */
  const [face, setFace] = useState<"talk" | "scope" | "confirm">("talk");
  /* the newest event when the page opened: what's there then is simply there
     (a page appears, law 8), and only what lands after it eases in (Isaac, 30
     October 2026: "Things should transition in smoothly... rather than just
     pop straight up") */
  const [before, setBefore] = useState<number | null>(null);
  const seen = useRef(0);
  const last = useRef(0);
  const busyNow = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  /** The thread is at its newest, unless you've scrolled back through it yourself. */
  const atEnd = useRef(true);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const started = useRef(false);

  const read = async (withQuestions: boolean): Promise<void> => {
    const r = await fetch(`${ROUTE}?job=${encodeURIComponent(job)}&since=${last.current}${withQuestions ? "&questions=1" : ""}`).catch(() => null);
    const v = r ? ((await r.json().catch(() => null)) as View | null) : null;
    /* a first read that fails reads as off, as it always has: the page's
       own list, never a column waiting on nothing */
    if (!v?.ok) return setOn((o) => o ?? false);
    setOn(!!v.on);
    setSpent(typeof v.spentUsd === "number" ? v.spentUsd : null);
    setMe(v.me ?? "");
    if (v.names) setNames((n) => ({ ...n, ...v.names }));
    const fresh = v.events ?? [];
    setBefore((b) => b ?? fresh.at(-1)?.id ?? 0);
    if (fresh.length) {
      last.current = Math.max(last.current, fresh[fresh.length - 1]!.id);
      /* two reads in flight from the same point (the poll, a read after an
         answer, coming back to the tab) both bring the same events: each
         goes in once (Isaac's production test, 2026-10-12: questions 4 and
         5 showed twice) */
      setEvents((e) => {
        const have = new Set(e.map((x) => x.id));
        const add = fresh.filter((x) => !have.has(x.id));
        return add.length ? [...e, ...add] : e;
      });
      /* her lines appear as she adds them */
      if (fresh.some((e) => e.kind === "tool")) onChanged();
    }
    if (v.questions) {
      setQuestions(v.questions);
      setAnswersIn(true);
    }
    const was = busyNow.current;
    busyNow.current = !!v.working;
    setWorking(!!v.working);
    if (v.took) setTook(v.took);
    /* she's done: the quote as she left it, her questions priced against it */
    if (was && !v.working) {
      onChanged();
      await read(true);
    }
  };
  const readNow = useEffectEvent((withQuestions: boolean) => void read(withQuestions));

  /* the first read lays the page out, so it's the quick one: pricing her
     questions reads the book, and the column (the line items too, where
     she's off) waited on it; her questions, priced, follow it */
  const firstRead = useEffectEvent(() => void read(false).then(() => read(true)));
  useEffect(() => {
    firstRead();
  }, [job]);

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => readNow(false), POLL_MS);
    return () => clearInterval(t);
  }, [working]);

  /* the newest at the foot, and again on coming back from the line items, and
     when she starts on what you sent: you're taken to where she's working */
  useEffect(() => {
    const grew = seen.current > 0 && events.length > seen.current;
    seen.current = events.length;
    if (hidden) return;
    atEnd.current = true;
    const el = threadRef.current;
    const still = !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: grew && !still ? "smooth" : "auto" });
  }, [events.length, hidden, on, face]);
  useEffect(() => {
    const el = threadRef.current;
    if (!working || hidden || !el) return;
    atEnd.current = true;
    el.scrollTop = el.scrollHeight;
  }, [working, hidden]);

  /* KEPT AT HER NEWEST AS THE THREAD CHANGES SIZE (Isaac, 11 November 2026:
     "Tiff doesn't automatically bring you to where she's working. Sometimes
     you have to scroll down"). What's under the last message grows without a
     new one: her working line and its step, her questions once priced, the
     box growing with what you say, which gives the thread less room. While
     the thread is at its newest it stays there; a scroll away from the end
     made by a wheel, a touch or a key is you reading back, and is left alone
     (as Tiff's window does, tiff-modal.tsx). */
  useEffect(() => {
    const el = threadRef.current;
    const col = colRef.current;
    if (!el || typeof ResizeObserver !== "function") return;
    let handAt = -Infinity;
    const reading = () => {
      handAt = performance.now();
    };
    const scrolled = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 4) atEnd.current = true;
      else if (performance.now() - handAt < 400) atEnd.current = false;
    };
    const ro = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    if (col) ro.observe(col);
    el.addEventListener("wheel", reading, { passive: true });
    el.addEventListener("touchstart", reading, { passive: true });
    el.addEventListener("keydown", reading);
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", reading);
      el.removeEventListener("touchstart", reading);
      el.removeEventListener("keydown", reading);
      el.removeEventListener("scroll", scrolled);
    };
    /* the thread is there only once she's on */
  }, [on]);

  const status = useEffectEvent((s: { on: boolean; spentUsd: number | null }) => onStatus?.(s));
  useEffect(() => {
    if (on !== null) status({ on, spentUsd: spent });
  }, [on, spent]);

  /* what you typed and haven't sent is kept, for you, on the next device
     too (Isaac, 2026-10-18); words already typed here are never replaced */
  useReplyDraft("quote", job, typed, (text) => setTyped((now) => now || text), on === true);

  /* the microphone (rule 27): what you say joins what's typed, to read
     before it's sent; where this deployment can hear (Isaac, 6 November 2026:
     the one box, the same everywhere) */
  const { voiceEnabled } = useNoteScope();
  const dict = useDictation({
    onTranscript: (said) => setTyped((now) => appendSpoken(now, said)),
    onError: setNote,
  });

  const send = async (readJob = false, words?: string): Promise<boolean> => {
    const message = (words ?? typed).trim();
    if ((!message && !readJob) || busy) return false;
    setBusy(true);
    setNote(null);
    const r = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, message, ...(readJob ? { sources: [...ticked] } : {}) }),
    }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    setBusy(false);
    if (!a?.ok) {
      setNote(a?.reason ?? "That didn't send. Try again.");
      return false;
    }
    if (words === undefined) setTyped("");
    busyNow.current = true;
    setWorking(true);
    void read(false);
    return true;
  };

  /* the page's words (Price them): what's in the box stays in the box */
  const saidLast = useRef(0);
  const sayNow = useEffectEvent((text: string) => {
    void send(false, text).then((sent) => {
      if (sent) onSaid?.();
    });
  });
  useEffect(() => {
    if (!say || !on || busy || saidLast.current === say.id) return;
    saidLast.current = say.id;
    const { text } = say;
    void Promise.resolve().then(() => sayNow(text));
  }, [say, on, busy]);

  /* from the job card's Create a quote: straight into the box, once */
  useEffect(() => {
    if (!on || !start || started.current || !box.current) return;
    started.current = true;
    box.current.focus();
  }, [on, start]);

  const openCount = answersIn ? events.filter((e) => e.kind === "question" && !questions[e.id]?.answered).length : 0;
  const tell = useEffectEvent((n: number) => onOpen?.(n));
  useEffect(() => {
    tell(on ? openCount : 0);
  }, [on, openCount]);

  /* her plan for this turn, while she works on it */
  const turn = events.at(-1)?.turnId ?? null;
  const planned = on && working ? events.findLast((e) => e.kind === "tool" && e.body.name === "plan_parts" && e.turnId === turn) : undefined;
  const planDetail = (planned?.body.detail ?? null) as { option?: unknown; parts?: unknown } | null;
  const planId = planned?.id ?? 0;
  const tellPlan = useEffectEvent(() => onPlan?.(planDetail ? { option: typeof planDetail.option === "number" ? planDetail.option : 0, parts: planOf(planDetail.parts) } : null));
  useEffect(() => {
    tellPlan();
  }, [planId]);

  if (!on) return null;

  const openSources = async () => {
    setBusy(true);
    const r = await fetch(`${ROUTE}?job=${encodeURIComponent(job)}&sources=1`).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; sources?: Source[]; left?: number } | null) : null;
    setBusy(false);
    if (!a?.ok) return setNote("The job couldn't be read just now. Try again.");
    setSources({ list: a.sources ?? [], left: a.left ?? 0 });
    setTicked(new Set((a.sources ?? []).map((s) => s.id)));
  };

  const answer = async (event: number, index: number) => {
    setBusy(true);
    setNote(null);
    const r = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, op: "answer", event, answer: index }) }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    setBusy(false);
    if (!a?.ok) setNote(a?.reason ?? "That didn't save. Try again.");
    onChanged();
    void read(true);
  };

  /* a researched price on its line: the route reads it back from the thread */
  const putOn = async (event: number) => {
    setBusy(true);
    setNote(null);
    const r = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job, op: "use", event }) }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    setBusy(false);
    if (!a?.ok) return setNote(a?.reason ?? "That didn't save. Try again.");
    setUsed((s) => new Set(s).add(event));
    onChanged();
  };

  const who = (author: string) => (author === me ? "You" : (names[author] ?? "Someone"));
  /* the job, written out: her newest write-up */
  const writeUps = events.filter((e) => e.kind === "tool" && e.body.name === "write_up" && e.body.ok !== false);
  const latest = writeUps.length ? writeUpOf((writeUps[writeUps.length - 1]!.body.detail as { writeUp?: unknown } | undefined)?.writeUp) : null;
  const open = answersIn ? events.filter((e) => e.kind === "question" && !questions[e.id]?.answered) : [];
  /* her questions numbered as her message numbers them: from 1 in each
     asking; the latest asking's answered ones stay, ticked (Isaac,
     2026-10-11: answered in his own words, as in the chat) */
  const numberOf = new Map<number, number>();
  let n = 0;
  for (const e of events) {
    if (e.kind === "message" && e.author !== "tiff" && typeof e.body.answered !== "number") n = 0;
    if (e.kind === "question") numberOf.set(e.id, ++n);
  }
  const asking = new Set(latestAsked(events));
  const settled = events.filter((e) => e.kind === "question" && asking.has(e.id) && questions[e.id]?.answered);

  /* her name over what she says, and when, once for a run of it, as a chat
     names a speaker; what she did stands as she did it, a run of steps together */
  const timeOf = (at: string) => {
    const d = at ? new Date(at) : null;
    return d && !Number.isNaN(d.getTime()) ? fmtAuTime(d) : "";
  };
  const landed = (id: number) => (before !== null && id > before ? " qc-in" : "");
  const her = (id: number, says: ReactNode, named: boolean, at = "") => (
    <div key={id} className={`qt-msg tf qc-her${landed(id)}`}>
      {named && (
        <span className="qc-who">
          <TiffGlyph quiet size={24} />
          <b>Tiff</b>
          {timeOf(at) && <time dateTime={at}>{timeOf(at)}</time>}
        </span>
      )}
      <div className="qc-says">{says}</div>
    </div>
  );
  const thread: ReactNode[] = [];
  /* sent while she worked, still waiting for her */
  const waiting = new Set(waitingIds(events));
  let steps: Ev[] = [];
  let hers = false;
  /* her working, folded to one line once she's done: every step she took and
     the notes she wrote on the way, under "Worked through it" (Isaac,
     2026-10-17, option A of the working-notes mocks). Open while she works. */
  const endSteps = () => {
    if (steps.length === 0) return;
    const run = steps;
    const key = run[0]!.id;
    const live = working && run.at(-1)!.turnId === turn;
    const open = live || opened.has(key);
    const n = run.filter((e) => e.kind === "tool").length;
    const flip = () =>
      setOpened((was) => {
        const next = new Set(was);
        if (!next.delete(key)) next.add(key);
        return next;
      });
    thread.push(
      <div key={`steps-${key}`} className={`qt-dids qt-fold${landed(key)}`}>
        {!live && (
          <button type="button" className="qt-foldbtn" aria-expanded={open} onClick={flip}>
            <Icon name="chevR" size={14} />
            <b>Worked through it</b>
            <span>{`${n} ${n === 1 ? "step" : "steps"}`}</span>
          </button>
        )}
        {open &&
          run.map((e) =>
            e.kind === "reply" ? (
              <p key={e.id} className={`qt-did note${landed(e.id)}`}>
                {String(e.body.text ?? "")}
              </p>
            ) : (
              <p key={e.id} className={`${e.body.ok === false ? "qt-did off" : "qt-did"}${landed(e.id)}`}>
                {`${String(e.body.label ?? "")}${e.body.said ? `: ${String(e.body.said)}` : ""}`}
              </p>
            )
          )}
      </div>
    );
    steps = [];
  };
  for (const e of events) {
    const research = e.kind === "tool" && e.body.ok !== false && e.body.name === "research_price" ? researchDetailOf((e.body.detail as { research?: unknown } | undefined)?.research) : null;
    /* a note she wrote on the way to her tools is part of her working */
    if ((e.kind === "tool" && !research) || (e.kind === "reply" && e.body.working === true)) {
      steps.push(e);
      hers = false;
      continue;
    }
    /* one fold a turn: only what shows in the thread ends her working, not a
       question she asked or an answer settled on the way, which split one
       turn into "45 steps, 1 step, 1 step, 1 step, 2 steps" (Isaac, 21
       October 2026: "there seems to be still quite a big list") */
    const shows = e.kind === "message" || e.kind === "reply" || !!research || e.kind === "milestone" || e.kind === "error";
    if (!shows) continue;
    endSteps();
    if (e.kind === "message") {
      const mine = e.author === me;
      const answered = typeof e.body.answered === "number";
      const text = answered ? `${String(e.body.question ?? "")} ${String(e.body.text ?? "")}` : String(e.body.text ?? "");
      thread.push(
        <div key={e.id} className={`${mine ? "qt-msg me" : "qt-msg"}${landed(e.id)}`}>
          <div className={mine ? "qt-bub me" : "qt-bub them"}>{paras(text)}</div>
          <span className="qt-meta">{who(e.author)}</span>
          {/* sent while she worked: she takes it up when she's free */}
          {waiting.has(e.id) && <span className="qt-meta">Next</span>}
        </div>
      );
      hers = false;
    } else if (e.kind === "reply") {
      thread.push(her(e.id, herWords(String(e.body.text ?? "")), !hers, e.at));
      hers = true;
    } else if (research) {
      thread.push(
        her(
          e.id,
          <div className="qt-bub tf">
            <span className="qt-web">
              <Globe /> Web search
            </span>
            {research.summary}
            <p className="qt-src">
              <a href={research.source.url} target="_blank" rel="noopener noreferrer">
                {research.source.title}
              </a>
            </p>
            <div className="qt-acts">
              {used.has(e.id) ? (
                <span className="qt-used">{`On the line at ${fmtAud(research.priceCents)} ${research.per}`}</span>
              ) : (
                <button type="button" className="pbtn ghost sm qp-go" disabled={busy || working} onClick={() => void putOn(e.id)}>
                  {`Use ${fmtAud(research.priceCents)}`}
                </button>
              )}
            </div>
          </div>,
          !hers,
          e.at
        )
      );
      hers = true;
    } else if (e.kind === "milestone") {
      thread.push(
        <p key={e.id} className={`qt-mile${landed(e.id)}`}>
          {`${String(e.body.text ?? "")} by ${e.author === me ? "you" : who(e.author)}`}
        </p>
      );
      hers = false;
    } else if (e.kind === "error") {
      thread.push(
        <p key={e.id} className="wb2-sherr">
          {String(e.body.message ?? "")}
        </p>
      );
      hers = false;
    }
  }
  endSteps();

  const scope = <QuoteScope words={words} writeUp={latest} />;

  return (
    <div className="qt" hidden={hidden}>
      <div className="qc-face">
        <div className="qc-col">
          <Tray
            ariaLabel="Conversation, scope or what's to confirm"
            value={face}
            onChange={setFace}
            options={[
              { value: "talk", label: "Conversation" },
              { value: "scope", label: "Scope" },
              { value: "confirm", label: confirmTitle, tone: open.length > 0 ? "look" : undefined },
            ]}
          />
        </div>
      </div>
      {face === "scope" && (
        <div className="qc-thread">
          <div className="qc-col">{scope}</div>
        </div>
      )}
      {face === "confirm" && (
        <div className="qc-thread">
          <div className="qc-col">
            {open.length > 0 || settled.length > 0 || confirm ? (
              <section aria-label={confirmTitle}>
                {open.map((q) => {
                  const answers = (Array.isArray(q.body.answers) ? q.body.answers : []) as Answer[];
                  const deltas = questions[q.id]?.deltas ?? [];
                  const put = typeof q.body.put === "string" ? q.body.put : "";
                  return (
                    <div key={q.id} className={`qt-qa${landed(q.id)}`}>
                      <p className="qt-q">
                        {/* an item to settle: an orange dot and its number (Q5) */}
                        <span className="qt-qn">
                          <Dot hue="orange" />
                          {numberOf.get(q.id)}
                        </span>
                        {String(q.body.question ?? "")}
                      </p>
                      {put && <p className="qt-put">{`I've put ${put}`}</p>}
                      {answers.length > 0 && (
                        <ul className="qt-ans">
                          {answers.map((a, i) => (
                            <li key={i}>
                              <button type="button" disabled={busy || deltas[i] === null} onClick={() => void answer(q.id, i)}>
                                <b>{a.label}</b>
                                {deltaWords(deltas[i]) && <em>{deltaWords(deltas[i])}</em>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {settled.length > 0 && (
                  <ul className="ql-checks qt-done" aria-label="Answered">
                    {settled.map((q) => {
                      const a = questions[q.id]!.answered!;
                      const topic = typeof q.body.topic === "string" && q.body.topic ? q.body.topic : String(q.body.question ?? "");
                      return (
                        <li key={q.id} className="ok">
                          <i aria-hidden="true" />
                          <span>
                            <b>{`${topic}: ${a.label}`}</b>
                            <small>{a.typed ? "From your message" : "Tapped"}</small>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {confirm}
              </section>
            ) : (
              <p className="qt-did">Nothing to confirm.</p>
            )}
          </div>
        </div>
      )}
      <div ref={threadRef} className="qc-thread" hidden={face !== "talk"}>
        <div ref={colRef} className="qc-col">
          {events.length === 0 && (
            <div className="qt-hello">
              <TiffGlyph size={48} />
              <b>{names[me] ? `Hi ${names[me]!.split(/\s+/)[0]}` : "Hi"}</b>
              <span>Ready when you are.</span>
              {!sources && (
                <button type="button" className="pbtn ghost sm" disabled={busy} onClick={() => void openSources()}>
                  Read the job
                </button>
              )}
            </div>
          )}
          {events.length === 0 && sources && (
            <section aria-label="Read the job">
              <h2 className="hd-ls-grp">Read the job</h2>
              {sources.list.length === 0 && <p className="qt-did">Nothing on the job to read yet.</p>}
              <ul className="qt-src">
                {sources.list.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={ticked.has(s.id)}
                        onChange={(e) =>
                          setTicked((t) => {
                            const n = new Set(t);
                            if (e.target.checked) n.add(s.id);
                            else n.delete(s.id);
                            return n;
                          })
                        }
                      />
                      <span>
                        <b>{s.label}</b>
                        <small><Fade lines={2}>{s.text}</Fade></small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {sources.left > 0 && <p className="qt-did">{`${sources.left} older ${sources.left === 1 ? "note" : "notes"} left out: the job's notes are longer than she reads.`}</p>}
              <div className="wb2-jqacts">
                <button type="button" className="pbtn ghost sm qp-go" disabled={busy || ticked.size === 0} onClick={() => void send(true)}>
                  Read it
                </button>
              </div>
            </section>
          )}
          {thread.length > 0 && <div className="qt-thread">{thread}</div>}
          {working && (
            <TimeLeft
              since={turnStartOf(events)}
              first={buildingFirst(events)}
              step={stepOf(events)}
              took={buildingFirst(events) ? took?.first : took?.later}
            />
          )}
        </div>
      </div>
      <div className="qc-comp">
        <div className="qc-col">
          {note && <p className="wb2-sherr">{note}</p>}
          {/* THE ONE BOX (Isaac, 6 November 2026: "every input box is the
              same"): Conversations' own, its words as you say them, Stop
              leaving them in it, and Tiff's button; Send pressed while you
              talk stops and sends (Isaac, 30 October 2026, on 3423: "the
              speech-to-text doesn't allow me to click send"). No Save here:
              talking to her is the point. */}
          <CvBox
            value={typed}
            onChange={setTyped}
            onSubmit={() => void send()}
            label="Message Tiff"
            placeholder={events.length === 0 ? "Tell Tiff about the job" : "Reply"}
            sendWord="Tiff"
            sendLabel="Send to Tiff"
            /* you can answer while she works: it waits its turn (Isaac, 13 November 2026, "Build E") */
            waiting={busy}
            dict={voiceEnabled ? dict : null}
            boxRef={box}
          />
        </div>
      </div>
    </div>
  );
}
