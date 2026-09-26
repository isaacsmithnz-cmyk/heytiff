"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { NAV, isActive } from "@/components/shell/nav";
import { DictClock, LiveWords } from "@/components/notes/dictation";
import { useNoteScope } from "@/components/notes/note-context";
import { MARK_MASK, TiffGlyph, TiffMark } from "@/components/notes/tiff-mark";
import { DotField, useDotFieldExit } from "@/components/ui/dot-field";
import type { EarlierTurn, TiffRoom } from "@/lib/workboard/note-turns";
import { EASE, MOVE_MS, canAnimate, prefersStill, tokenMs, useBoxMotion, useGrow } from "./box-motion";
import type { PlanRowView } from "./plan-view";
import {
  useConversation,
  type Closed,
  type Conversation,
  type Face as FaceState,
  type ModalTurn,
  type Point,
  type QuickAnswer,
} from "./use-conversation";

/* THE TIFF MODAL — where you talk to Tiff, on every screen.

   Light, 600px, paper on the one overlay shadow over the scrim, 104px from
   the top. THREE ZONES THAT STAY WHERE THEY ARE:

     the face           the mark as dots. It gathers from the button you
                        pressed, swells while you talk, becomes a cloud while
                        Tiff thinks and falls when she answers; then the zone
                        closes and the still mark sits in the header.
     the conversation   "You" and "Tiff", turn by turn; earlier turns go
                        quiet. Your words arrive free and large while you say
                        them and settle to the turn's size on Done. Tiff's
                        plan is a list inside her turn.
     the dock           the only buttons. Listening: the clock, clear, Done.
                        Otherwise the reply box, with the Tiff button on its
                        end until you type. It folds away while Tiff thinks.

   IT BLOSSOMS FROM THE BUTTON: it fades in where it sits and grows the last
   6% toward the button's side, over `--t-move`, so it is solid within a
   blink and its words are never seen shrunk; the dots are what travel. It
   folds back toward the button on close. × or Escape closes it. Opened from
   the keyboard, or under reduced motion, it only fades.

   A SCREEN READER HEARS TIFF. The status line says she is sorting it out
   while she thinks, and then says what she said; and while the dock is
   folded away the dialog itself holds focus, so it never falls out of the
   modal onto the page underneath. */

export type TiffSession = {
  n: number;
  from: HTMLElement;
  /** Where focus goes back to when `from` will be gone (./tiff-context). */
  back?: HTMLElement;
  origin: Point;
  words?: string;
  /** A conversation already had, opened again (./tiff-context). */
  conversation?: readonly EarlierTurn[];
  room?: TiffRoom;
  openerId: string | null;
  /** Reduced motion: nothing travels and no wait is held. */
  still: boolean;
  /** Opened from the keyboard: nothing flies from the button (law 8). */
  keyboard: boolean;
  at: number;
};

export type TiffClosed = Closed & {
  from: HTMLElement;
  back?: HTMLElement;
  /** The room it was had in, as it opened. */
  room?: TiffRoom;
  /** Opened or closed from the keyboard. */
  keyboard: boolean;
};

const ROOM: Record<TiffRoom, string> = { home: "Home", diary: "Diary", tasks: "Tasks", calendar: "Calendar" };

/** The screen's own name, off the nav, when the words have no room. */
function screenWord(pathname: string): string {
  let best: { label: string; href: string } | null = null;
  for (const n of NAV) {
    if (!isActive({ ...n, subItems: undefined }, pathname)) continue;
    if (!best || n.href.length > best.href.length) best = n;
  }
  return best?.label ?? "";
}

export function TiffModal({
  session,
  onClosed,
}: {
  session: TiffSession;
  onClosed: (c: TiffClosed) => void;
}) {
  const scope = useNoteScope();
  const pathname = usePathname();
  const c = useConversation({
    opening: {
      words: session.words,
      conversation: session.conversation,
      room: session.room,
      origin: session.keyboard ? null : session.origin,
      still: session.still,
      at: session.at,
    },
    voiceEnabled: scope.voiceEnabled,
    target: scope.target,
    targetLabel: scope.targetLabel,
  });

  const dialog = useRef<HTMLElement | null>(null);
  const scrim = useRef<HTMLDivElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  /** Only a fade: reduced motion, or a keyboard press (law 8). */
  const fadeOnly = session.still || session.keyboard;

  /* THE ENTRANCE, on the resting box: the origin is where the button is,
     relative to where the modal will sit, measured before anything moves. */
  useLayoutEffect(() => {
    const m = dialog.current;
    if (!canAnimate(m)) return;
    const r = m.getBoundingClientRect();
    m.style.transformOrigin = `${(session.origin.x - r.left).toFixed(1)}px ${(session.origin.y - r.top).toFixed(1)}px`;
    const timing: KeyframeAnimationOptions = { duration: tokenMs("--t-move", MOVE_MS), easing: EASE, fill: "backwards" };
    m.animate(
      fadeOnly
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, offset: 0.4 }, { opacity: 1, transform: "none" }],
      timing
    );
    if (canAnimate(scrim.current)) scrim.current.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  }, [session, fadeOnly]);

  /** Close: the conversation lets go of everything, then the modal folds
      back toward the button and the host takes it away. `byKey`: closed
      with a key (Escape, or × or Done pressed from the keyboard), which the
      host tells whatever lands, so it moves nothing either (law 8). */
  const close = (byKey: boolean) => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    const result: TiffClosed = {
      ...c.close(),
      from: session.from,
      back: session.back,
      room: session.room,
      keyboard: session.keyboard || byKey,
    };
    const finish = () => onClosed(result);
    const m = dialog.current;
    if (!canAnimate(m)) return finish();
    const timing: KeyframeAnimationOptions = { duration: tokenMs("--t-move", MOVE_MS), easing: EASE, fill: "forwards" };
    if (canAnimate(scrim.current)) scrim.current.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    m.animate(
      fadeOnly
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.97)" }],
      timing
    ).finished.then(finish, finish);
  };

  /* ESCAPE CLOSES THIS AND ONLY THIS. Caught on the way down, before a sheet
     underneath hears it and closes itself too. Tab stays inside. */
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "Tab") return;
    const m = dialog.current;
    if (!m) return;
    const stops = [...m.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea, [tabindex='0']")];
    if (!stops.length) return;
    const at = stops.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === -1 || at === stops.length - 1 ? 0 : at + 1;
    e.preventDefault();
    stops[next]!.focus();
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, []);

  const context = c.targetLabel ?? (session.room ? ROOM[session.room] : screenWord(pathname));

  /* WHILE THE DOCK IS FOLDED AWAY, THE DIALOG HOLDS FOCUS. Whatever sent the
     words — Done, Send, a quick answer, Enter in your words — is leaving,
     and focus left on it would fall to the page under the modal. The dock
     takes it back when it returns. */
  const folded = c.stage === "thinking" || c.stage === "answering";
  useEffect(() => {
    if (folded) dialog.current?.focus({ preventScroll: true });
  }, [folded]);

  /* What a screen reader hears: that Tiff is working, then what she said —
     her question, her answer, what she filed — once it has all arrived. */
  const newest = c.turns.at(-1);
  const heard =
    c.stage === "thinking"
      ? "Tiff is sorting it out"
      : newest?.who === "tiff" && !newest.streaming
        ? newest.text
        : "";

  /* The live turn rides at the end of the list under its own key, so when it
     becomes a turn it is the SAME element: the words settle where they are. */
  const all: ModalTurn[] = c.live
    ? [...c.turns, { key: c.live.key, who: "you", text: c.live.said ?? c.draft, enter: c.live.enter }]
    : c.turns;
  let lastYou = -1;
  all.forEach((t, i) => {
    if (t.who === "you") lastYou = i;
  });

  const turnsRef = useRef<HTMLDivElement | null>(null);
  const tail = all.length ? `${all.length}:${all.at(-1)!.text.length}:${c.interim.length}` : "";
  /* A conversation opened again is at its newest turn as the modal appears,
     not scrolled there in front of you; only what arrives after is. */
  const openedOn = useRef(tail);
  useLayoutEffect(() => {
    const el = turnsRef.current;
    const first = tail === openedOn.current;
    if (el && typeof el.scrollTo === "function")
      el.scrollTo({ top: el.scrollHeight, behavior: session.still || first ? "auto" : "smooth" });
  }, [tail, session.still]);

  return (
    <>
      <div className="tm-scrim" ref={scrim} aria-hidden="true" />
      <section
        ref={dialog}
        className={"tm" + (c.faceOpen ? "" : " speaking")}
        role="dialog"
        aria-modal="true"
        aria-label="Tiff"
        tabIndex={-1}
        inert={leaving}
      >
        <header className="tm-head">
          <span className="tm-who">
            <span className="tm-hmark" aria-hidden="true">
              <TiffGlyph ground="paper" quiet size={20} />
            </span>
            {context && <span className="tm-ctx">{context}</span>}
            {c.aimed && c.targetLabel && (
              <button
                type="button"
                className="tm-aimx"
                aria-label={`Clear the tag — not about ${c.targetLabel}`}
                onClick={c.dropAim}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
          <button type="button" className="tm-x" aria-label="Close" onClick={(e) => close(e.detail === 0)}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <Face face={c.face} open={c.faceOpen} />

        <div className="tm-turns" ref={turnsRef}>
          {all.map((t, i) => (
            <TurnView
              key={t.key}
              turn={t}
              past={i < lastYou}
              live={c.live?.key === t.key && c.live.said === null ? (c.fixing ? "fix" : "words") : null}
              active={i === all.length - 1}
              c={c}
            />
          ))}
        </div>
        <p className="sr-only" role="status">
          {heard}
        </p>

        <Dock c={c} onEmpty={close} />
      </section>
    </>
  );
}

/* ── the face ── */

function Face({ face, open }: { face: FaceState; open: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shown = useBoxMotion(ref, open);
  const field = useDotFieldExit(face.stage);
  if (!shown) return null;
  return (
    <div className="tm-face" ref={ref} aria-hidden="true">
      <div className="tm-field">
        {field && <DotField key={face.key} stage={field} size={252} origin={face.origin} />}
      </div>
    </div>
  );
}

/* ── a turn ── */

function TurnView({
  turn,
  past,
  live,
  active,
  c,
}: {
  turn: ModalTurn;
  past: boolean;
  live: "words" | "fix" | null;
  active: boolean;
  c: Conversation;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useBoxMotion(ref, true, turn.enter);

  /* DONE SETTLES YOUR WORDS WHERE THEY ARE: 20px down to the turn's 16, over
     `--t-move`. What they were set at is read while they are live, because
     by the time they settle the element that had it has gone. */
  const text = useRef<HTMLElement | null>(null);
  const liveType = useRef<{ fontSize: string; lineHeight: string } | null>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el) return;
    if (live) {
      const cs = getComputedStyle(el);
      liveType.current = { fontSize: cs.fontSize, lineHeight: cs.lineHeight };
      return;
    }
    const from = liveType.current;
    liveType.current = null;
    if (!from || !canAnimate(el) || prefersStill()) return;
    const cs = getComputedStyle(el);
    el.animate([from, { fontSize: cs.fontSize, lineHeight: cs.lineHeight }], {
      duration: tokenMs("--t-move", MOVE_MS),
      easing: EASE,
    });
  }, [live]);

  /* A line gained while you talk is grown into, never jumped to — and the
     line your words lose as they settle. */
  useGrow(ref, live ? `${turn.text} ${c.interim}` : "");

  const fixBox = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (live === "fix") fixBox.current?.focus({ preventScroll: true });
  }, [live]);
  /* The box grows with what is typed into it, measured after it renders. */
  useLayoutEffect(() => {
    const el = fixBox.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [live, c.draft, c.reading]);

  const asking = active && c.stage === "asking";
  const rows = turn.rows ?? [];

  return (
    <div
      ref={ref}
      className={"tm-turn" + (past ? " past" : "") + (live ? " live" : "")}
    >
      <div className="tm-label">{turn.who === "you" ? "You" : "Tiff"}</div>
      {live === "words" ? (
        <div
          className="tm-words"
          ref={(el) => {
            text.current = el;
          }}
          /* Clicking into your words stops the mic and keeps them for typing. */
          onClick={c.fix}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              c.fix();
            }
          }}
          tabIndex={0}
        >
          <LiveWords className="tm-tt" free said={c.draft} text={c.interim} />
        </div>
      ) : live === "fix" ? (
        <textarea
          ref={(el) => {
            fixBox.current = el;
            text.current = el;
          }}
          className="tm-tt tm-fix"
          rows={1}
          /* The words you clicked into stay, as they were, until their
             read-back lands; nothing is typed in front of them meanwhile. */
          value={c.reading ?? c.draft}
          readOnly={c.reading !== null}
          aria-busy={c.reading !== null}
          aria-label="What you said"
          onChange={(e) => c.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              c.send();
            }
          }}
        />
      ) : (
        <p
          className="tm-tt"
          ref={(el) => {
            text.current = el;
          }}
        >
          {turn.text}
          {turn.streaming && <span className="wb2-anscursor" aria-hidden="true" />}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="tm-plan">
          {rows.map((row) => (
            <PlanRow
              key={row.key}
              row={row}
              clearable={asking && !row.needs}
              onClear={() => c.clearRow(turn.key, row.key)}
              onLibrary={
                turn.filed && turn.noteId ? () => void c.publishKb(turn.key, turn.noteId!, row.index) : undefined
              }
            />
          ))}
        </ul>
      )}

      <Quick answers={asking ? (turn.quick ?? []) : []} onAnswer={c.answer} />

      {((turn.doors?.length ?? 0) > 0 || turn.undo) && (
        <div className="tm-doors">
          {turn.doors?.map((d) => (
            <span key={d.kind}>{d.label}</span>
          ))}
          {turn.undo && (turn.noteId || turn.events) && (
            <button
              type="button"
              className="tm-undo"
              disabled={turn.undo === "busy"}
              /* A note's Undo takes back what it filed; a calendar line's
                 takes its events off. */
              onClick={() => void (turn.events ? c.undoEvents(turn.key, turn.events) : c.undo(turn.key, turn.noteId!))}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PlanRow({
  row,
  clearable,
  onClear,
  onLibrary,
}: {
  row: PlanRowView;
  clearable: boolean;
  onClear: () => void;
  onLibrary?: () => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  const shown = useBoxMotion(ref, !row.off);
  if (!shown) return null;
  return (
    <li ref={ref} className="tm-row-plan">
      {row.needs ? (
        <span className="tm-qm" aria-hidden="true">
          ?
        </span>
      ) : (
        <span className="tm-ok" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      )}
      <span>
        <b>{row.lead}</b>
        {row.join}
        {row.text}
      </span>
      {row.needs ? (
        <span className="tm-needs">Needs an answer</span>
      ) : row.kb && onLibrary ? (
        row.kb === "added" ? (
          <span className="tm-added">In the Library</span>
        ) : (
          <button type="button" className="pbtn ghost" disabled={row.kb === "busy"} onClick={onLibrary}>
            Add to the Library
          </button>
        )
      ) : clearable ? (
        <button type="button" className="tm-rm" aria-label={`Clear ${row.text} from the plan`} onClick={onClear}>
          <Icon name="x" size={12} />
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

/** Her quick answers, under her question. They leave by their own box once
    one is tapped or the question is answered. */
function Quick({ answers, onAnswer }: { answers: QuickAnswer[]; onAnswer: (q: QuickAnswer) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [held, setHeld] = useState(answers);
  if (answers.length && answers !== held) setHeld(answers);
  const shown = useBoxMotion(ref, answers.length > 0);
  if (!shown || !held.length) return null;
  return (
    <div className="tm-quick" ref={ref}>
      {held.map((q) => (
        <button key={q.label} type="button" className="pbtn ghost" disabled={!answers.length} onClick={() => onAnswer(q)}>
          {q.label}
        </button>
      ))}
    </div>
  );
}

/* ── the dock ── */

type DockMode = "listen" | "fix" | "reply";

function Dock({ c, onEmpty }: { c: Conversation; onEmpty: (byKey: boolean) => void }) {
  const mode: DockMode | null =
    c.stage === "listening" ? "listen" : c.stage === "thinking" || c.stage === "answering" ? null : c.fixing ? "fix" : "reply";
  /* While it folds away it keeps showing what it was. */
  const [held, setHeld] = useState<DockMode>(mode ?? "reply");
  if (mode && mode !== held) setHeld(mode);
  const ref = useRef<HTMLElement | null>(null);
  const shown = useBoxMotion(ref, mode !== null);

  const first = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (mode) first.current?.focus({ preventScroll: true });
  }, [mode]);

  if (!shown) return null;
  const typed = c.draft.trim() !== "";

  /* FOLDING AWAY, IT CAN'T BE PRESSED. It stays on the page for the fold and
     keeps showing what it was, but a second Done or Send on it would send
     twice, or close the modal on words still being read back. */
  return (
    <footer className="tm-dock" ref={ref} inert={mode === null}>
      {held === "listen" && (
        <div className="tm-bar">
          <span className="tm-rec">
            <span className="wb2-recdot" aria-hidden="true" />
            <DictClock seconds={c.seconds} />
          </span>
          <span className="tm-sp" />
          <button type="button" className="tm-clear" aria-label="Clear what you said" onClick={c.clear}>
            <Icon name="x" size={16} />
          </button>
          <button
            type="button"
            className="pbtn primary"
            ref={(el) => {
              first.current = el;
            }}
            onClick={(e) => {
              if (!c.done()) onEmpty(e.detail === 0);
            }}
          >
            Done
          </button>
        </div>
      )}
      {held === "fix" && (
        <div className="tm-bar">
          <span className="tm-sp" />
          <button type="button" className="tm-clear" aria-label="Clear what you said" onClick={c.clear}>
            <Icon name="x" size={16} />
          </button>
          <button type="button" className="pbtn primary" disabled={!typed} onClick={c.send}>
            Send
          </button>
        </div>
      )}
      {held === "reply" && (
        <form
          className="tm-box"
          onSubmit={(e) => {
            e.preventDefault();
            c.send();
          }}
        >
          <input
            className="tm-in"
            ref={(el) => {
              first.current = el;
            }}
            value={c.draft}
            onChange={(e) => c.setDraft(e.target.value)}
            placeholder="Reply to Tiff…"
            aria-label="Reply to Tiff"
            autoComplete="off"
          />
          {typed ? (
            <button type="submit" className="pbtn primary">
              Send
            </button>
          ) : c.voiceEnabled ? (
            <button
              type="button"
              className="tiffbtn tiffbtn-box"
              aria-label="Talk to Tiff"
              style={{ "--tiffbtn-mask": MARK_MASK } as CSSProperties}
              onClick={(e) => c.talk(e.currentTarget, e.detail === 0)}
            >
              <span className="tiffbtn-burst" aria-hidden="true" />
              <TiffMark ground="paper" />
            </button>
          ) : null}
        </form>
      )}
      {c.error && (
        <p className="tm-err" role="alert">
          {c.error}
        </p>
      )}
    </footer>
  );
}
