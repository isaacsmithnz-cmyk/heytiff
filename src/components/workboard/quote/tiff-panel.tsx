"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { planOf, type PlannedPart } from "@/lib/quotes/build-progress";
import { researchDetailOf } from "@/lib/quotes/research";
import { latestAsked } from "@/lib/quotes/session/answers";
import { WRITE_UP_KEYS, WRITE_UP_SECTIONS, writeUpAgainst, writeUpOf } from "@/lib/quotes/write-up";
import { fmtAud } from "@/lib/workboard/project-money";

/* TIFF'S PANEL ON THE QUOTE (slice 5.1, mock-up screens 1 and 3): a rounded
   grey card on the white page. Its header is her still mark, her name, what
   the quote has cost and whether she's working. Its body is what's To
   confirm (her questions, each answer priced, then what the page has to
   confirm), then the page's own (what goes to ServiceM8, the changes),
   then the conversation, down to the message box at the bottom (Isaac,
   2026-10-11). Before the first message, her moving mark and a hello.

   While she works the page reads her saved thread every second and a half
   (slice 5.2), and the quote's lines with it, so they appear as she adds
   them. A reload or a closed tab loses nothing: the work is saved as it
   goes. Off until her model is chosen: then the rail is only what the page
   gives it. */

const ROUTE = "/api/workboard/quote-session";
/** How often the thread is read while she works, ms. */
const POLL_MS = 1500;

type Ev = { id: number; turnId: string | null; kind: string; author: string; body: Record<string, unknown>; at: string };
type QState = { deltas: (number | null)[]; answered: { index: number; label: string; by: string; typed?: true } | null };
type View = { ok: boolean; on?: boolean; working?: boolean; spentUsd?: number; events?: Ev[]; names?: Record<string, string>; me?: string; questions?: Record<number, QState> };
type Answer = { label: string };
type Source = { id: string; label: string; text: string };

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
const deltaWords = (c: number | null | undefined) => (c == null || Math.round(c) === 0 ? "" : `${c > 0 ? "+" : "−"}${fmtAud(Math.abs(Math.round(c)))}`);

export function TiffPanel({
  job,
  onChanged,
  onOpen,
  onPlan,
  confirm,
  confirmTitle = "To confirm",
  children,
}: {
  job: string;
  onChanged: () => void;
  /** how many of her questions are open, for the progress line's To confirm */
  onOpen?: (n: number) => void;
  /** the parts she said she'd build, while she builds them; null when she isn't (5.2) */
  onPlan?: (plan: { option: number; parts: PlannedPart[] } | null) => void;
  /** what the page has to confirm, under her questions (lines it can't
      price, assumptions, a loading with no reason); null when nothing */
  confirm?: ReactNode;
  /** the list's name: on the proposal, "Before you approve" */
  confirmTitle?: string;
  /** the page's own (what goes to ServiceM8, the changes), above the conversation */
  children: ReactNode;
}) {
  const [on, setOn] = useState(false);
  const [working, setWorking] = useState(false);
  const [spent, setSpent] = useState(0);
  const [events, setEvents] = useState<Ev[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState("");
  const [questions, setQuestions] = useState<Record<number, QState>>({});
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /* researched prices put on their lines this visit */
  const [used, setUsed] = useState<Set<number>>(new Set());
  /* Read the job: its sources, and which are ticked */
  const [sources, setSources] = useState<{ list: Source[]; left: number } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const last = useRef(0);
  const busyNow = useRef(false);
  const bottom = useRef<HTMLDivElement | null>(null);

  const read = async (withQuestions: boolean): Promise<void> => {
    const r = await fetch(`${ROUTE}?job=${encodeURIComponent(job)}&since=${last.current}${withQuestions ? "&questions=1" : ""}`).catch(() => null);
    const v = r ? ((await r.json().catch(() => null)) as View | null) : null;
    if (!v?.ok) return;
    setOn(!!v.on);
    setSpent(v.spentUsd ?? 0);
    setMe(v.me ?? "");
    if (v.names) setNames((n) => ({ ...n, ...v.names }));
    const fresh = v.events ?? [];
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
    if (v.questions) setQuestions(v.questions);
    const was = busyNow.current;
    busyNow.current = !!v.working;
    setWorking(!!v.working);
    /* she's done: the quote as she left it, her questions priced against it */
    if (was && !v.working) {
      onChanged();
      await read(true);
    }
  };
  const readNow = useEffectEvent((withQuestions: boolean) => void read(withQuestions));

  useEffect(() => {
    readNow(true);
  }, [job]);

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => readNow(false), POLL_MS);
    return () => clearInterval(t);
  }, [working]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [events.length]);

  const openCount = events.filter((e) => e.kind === "question" && !questions[e.id]?.answered).length;
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

  if (!on)
    return (
      <>
        {confirm && (
          <section aria-label={confirmTitle}>
            <h2 className="hd-ls-grp">{confirmTitle}</h2>
            {confirm}
          </section>
        )}
        {children}
      </>
    );

  const openSources = async () => {
    setBusy(true);
    const r = await fetch(`${ROUTE}?job=${encodeURIComponent(job)}&sources=1`).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; sources?: Source[]; left?: number } | null) : null;
    setBusy(false);
    if (!a?.ok) return setNote("The job couldn't be read just now. Try again.");
    setSources({ list: a.sources ?? [], left: a.left ?? 0 });
    setTicked(new Set((a.sources ?? []).map((s) => s.id)));
  };

  const send = async (readJob = false) => {
    const message = typed.trim();
    if ((!message && !readJob) || busy) return;
    setBusy(true);
    setNote(null);
    const r = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, message, ...(readJob ? { sources: [...ticked] } : {}) }),
    }).catch(() => null);
    const a = r ? ((await r.json().catch(() => null)) as { ok: boolean; reason?: string } | null) : null;
    setBusy(false);
    if (!a?.ok) return setNote(a?.reason ?? "That didn't send. Try again.");
    setTyped("");
    busyNow.current = true;
    setWorking(true);
    void read(false);
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
  /* the job, written out: her newest write-up, against the one before it */
  const writeUps = events.filter((e) => e.kind === "tool" && e.body.name === "write_up" && e.body.ok !== false);
  const latest = writeUps.length ? writeUpOf((writeUps[writeUps.length - 1]!.body.detail as { writeUp?: unknown } | undefined)?.writeUp) : null;
  const prior = writeUps.length > 1 ? writeUpOf((writeUps[writeUps.length - 2]!.body.detail as { writeUp?: unknown } | undefined)?.writeUp) : null;
  const written = latest ? writeUpAgainst(latest, prior) : null;
  const open = events.filter((e) => e.kind === "question" && !questions[e.id]?.answered);
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

  return (
    <div className="qt">
      <header className="qt-h">
        <TiffGlyph quiet size={32} />
        <div className="qt-t">
          <b>Tiff</b>
          <span>{`${fmtAud(Math.round(spent * 100))} on this quote`}</span>
        </div>
        <span className={working ? "qt-state work" : "qt-state"}>
          <i aria-hidden="true" />
          {working ? "Working" : "Ready"}
        </span>
      </header>
      <div className="qt-b">
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
                      <small>{s.text.length > 140 ? `${s.text.slice(0, 140)}…` : s.text}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {sources.left > 0 && <p className="qt-did">{`${sources.left} older ${sources.left === 1 ? "note" : "notes"} left out: the job's notes are longer than she reads.`}</p>}
            <div className="wb2-jqacts">
              <button type="button" className="pbtn primary sm" disabled={busy || ticked.size === 0} onClick={() => void send(true)}>
                Read it
              </button>
            </div>
          </section>
        )}
        {written && (
          <section className="qt-job" aria-label="The job">
            <header>
              <b>The job</b>
              <em>{prior ? "Changed" : "Written"}</em>
            </header>
            {WRITE_UP_KEYS.filter((k) => written[k].length > 0).map((k) => (
              <section key={k}>
                <h4>{WRITE_UP_SECTIONS[k]}</h4>
                <ul>
                  {written[k].map((item, i) => (
                    <li key={i} className={item.state === "same" ? undefined : item.state}>
                      {item.text}
                      {item.state === "changed" && <em> Changed</em>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </section>
        )}
        {(open.length > 0 || settled.length > 0 || confirm) && (
          <section aria-label={confirmTitle}>
            <h2 className="hd-ls-grp">{confirmTitle}</h2>
            {open.map((q) => {
              const answers = (Array.isArray(q.body.answers) ? q.body.answers : []) as Answer[];
              const deltas = questions[q.id]?.deltas ?? [];
              const put = typeof q.body.put === "string" ? q.body.put : "";
              return (
                <div key={q.id} className="qt-qa">
                  <p className="qt-q">
                    <span className="qt-qn">{numberOf.get(q.id)}</span>
                    {String(q.body.question ?? "")}
                  </p>
                  {put && <p className="qt-put">{`I've put ${put}`}</p>}
                  {answers.length > 0 && (
                    <ul className="qt-ans">
                      {answers.map((a, i) => (
                        <li key={i}>
                          <button type="button" disabled={busy || working || deltas[i] === null} onClick={() => void answer(q.id, i)}>
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
        )}
        {children}
        <div className="qt-thread">
          {events.map((e) => {
            if (e.kind === "message") {
              const mine = e.author === me;
              const answered = typeof e.body.answered === "number";
              return (
                <div key={e.id} className={mine ? "qt-msg me" : "qt-msg"}>
                  <div className={mine ? "qt-bub me" : "qt-bub them"}>{answered ? `${String(e.body.question ?? "")} ${String(e.body.text ?? "")}` : String(e.body.text ?? "")}</div>
                  <span className="qt-meta">{who(e.author)}</span>
                </div>
              );
            }
            if (e.kind === "reply")
              return (
                <div key={e.id} className="qt-msg tf">
                  <div className="qt-bub tf">{String(e.body.text ?? "")}</div>
                </div>
              );
            const research = e.kind === "tool" && e.body.ok !== false && e.body.name === "research_price" ? researchDetailOf((e.body.detail as { research?: unknown } | undefined)?.research) : null;
            if (research)
              return (
                <div key={e.id} className="qt-msg tf">
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
                        <button type="button" className="pbtn primary sm" disabled={busy || working} onClick={() => void putOn(e.id)}>
                          {`Use ${fmtAud(research.priceCents)}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            if (e.kind === "tool")
              return (
                <p key={e.id} className={e.body.ok === false ? "qt-did off" : "qt-did"}>
                  {`${String(e.body.label ?? "")}${e.body.said ? `: ${String(e.body.said)}` : ""}`}
                </p>
              );
            if (e.kind === "milestone")
              return (
                <p key={e.id} className="qt-mile">
                  {`${String(e.body.text ?? "")} by ${e.author === me ? "you" : who(e.author)}`}
                </p>
              );
            if (e.kind === "error")
              return (
                <p key={e.id} className="wb2-sherr">
                  {String(e.body.message ?? "")}
                </p>
              );
            return null;
          })}
          {working && <p className="qt-working">Working on the quote</p>}
          <div ref={bottom} />
        </div>
      </div>
      <div className="qt-c">
        {note && <p className="wb2-sherr">{note}</p>}
        <div className="qt-box">
          <textarea
            className="qt-in"
            rows={1}
            value={typed}
            placeholder={events.length === 0 ? "Tell Tiff about the job" : "Message Tiff"}
            aria-label="Message Tiff"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" className="pbtn primary sm" disabled={busy || working || !typed.trim()} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
