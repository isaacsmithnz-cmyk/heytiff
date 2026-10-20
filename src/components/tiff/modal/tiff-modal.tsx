"use client";

import { Fade } from "@/components/parts/fade";
import { Button, IconButton } from "@/components/parts/button";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { screenLabelFor } from "@/components/shell/nav";
import { DictClock, LiveWords } from "@/components/notes/dictation";
import { useNoteScope } from "@/components/notes/note-context";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import type { EarlierTurn, TiffRoom } from "@/lib/workboard/note-turns";
import { EASE, MOVE_MS, canAnimate, prefersStill, tokenMs, useBoxMotion, useGrow } from "./box-motion";
import type { PlanRowView } from "./plan-view";
import { keepChat } from "./keep-chat";
import {
  useConversation,
  type Closed,
  type Conversation,
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

/** How long her line stays up after she moves you, before the modal closes. */
export const HOLD_MS = 900;

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
  /** The day a line that names none goes on (./tiff-context). */
  day?: string;
  openerId: string | null;
  /** Reduced motion: nothing travels and no wait is held. */
  still: boolean;
  /** Opened from the keyboard: nothing flies from the button (law 8). */
  keyboard: boolean;
  at: number;
  /** Carrying on the conversation she moved you from (./use-conversation). */
  carryOn?: boolean;
};

export type TiffClosed = Closed & {
  from: HTMLElement;
  back?: HTMLElement;
  /** The room it was had in, as it opened. */
  room?: TiffRoom;
  /** Opened or closed from the keyboard. */
  keyboard: boolean;
  /** Tiff moved the screen: the host goes here once the modal is gone, so a
      sheet the page opens never lands under a modal still folding away. */
  moveTo?: string;
};

const ROOM: Record<TiffRoom, string> = { home: "Home", diary: "Diary", tasks: "Tasks", calendar: "Calendar" };

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
      day: session.day,
      /* the rings travel from the button now (./rings); the dots appear in place */
      origin: null,
      still: session.still,
      at: session.at,
      carryOn: session.carryOn,
    },
    voiceEnabled: scope.voiceEnabled,
    target: scope.target,
    targetLabel: scope.targetLabel,
    screen: screenLabelFor(pathname),
    screenDetail: scope.screenDetail,
    designOpen: !!scope.screenDetail?.startsWith("the design"),
    onLeave: (href) => leave.current(href),
  });

  /* A MOVE CLOSES THE MODAL, THEN THE PAGE MOVES. `leave` is set once
     `close` exists (below); the conversation calls it after her line shows. */
  const moveTo = useRef<string | null>(null);
  const leave = useRef<(href: string) => void>(() => {});

  const dialog = useRef<HTMLElement | null>(null);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);
  /* DOCKED (Isaac, 20 October 2026: a small chat you can minimise and open
     up, not the old modal): it is simply there, and simply gone; the rings
     no longer fly out of the button to become its edge. */
  /* minimised to the "Ask Tiff" pill, the conversation kept */
  const [small, setSmall] = useState(false);
  /* THE CHAT IS KEPT (./keep-chat): once her answer has landed, this chat
     is a conversation in Conversations. One opened on a job's conversation
     is those people's notes, not a chat with her, so it isn't. */
  const [chatId] = useState(() => `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const landed = c.stage !== "thinking" && c.stage !== "answering" && !c.turns.some((t) => t.streaming);
  const ownChat = !session.conversation?.length;
  useEffect(() => {
    if (landed && ownChat) keepChat(chatId, c.turns);
  }, [landed, ownChat, chatId, c.turns]);



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
      ...(moveTo.current ? { moveTo: moveTo.current } : {}),
    };
    onClosed(result);
  };

  /* THE HOLD (universal Tiff 1F, interim until Isaac designs the panel or
     bar): her line stays up for HOLD_MS, then the modal closes and the page
     moves. Not motion, so it holds under reduced motion and from the keyboard
     too. Any key or press in the modal during it cancels the move and keeps
     the conversation open. */
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    leave.current = (href: string) => {
      moveTo.current = href;
      holding.current = setTimeout(() => {
        holding.current = null;
        close(false);
      }, HOLD_MS);
    };
  });
  useEffect(() => {
    const m = dialog.current;
    if (!m) return;
    const stay = () => {
      if (!holding.current) return;
      clearTimeout(holding.current);
      holding.current = null;
      moveTo.current = null;
    };
    m.addEventListener("keydown", stay);
    m.addEventListener("pointerdown", stay);
    return () => {
      m.removeEventListener("keydown", stay);
      m.removeEventListener("pointerdown", stay);
      if (holding.current) clearTimeout(holding.current);
    };
  }, []);

  /* ESCAPE CLOSES THIS AND ONLY THIS. Caught on the way down, before a sheet
     underneath hears it and closes itself too. Tab is free: docked, the page
     is still yours. */
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    /* docked, the page around it is yours: only keys pressed in it are its own */
    if (!dialog.current?.contains(document.activeElement)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
  });
  useEffect(() => {
    const listen = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listen, true);
    return () => window.removeEventListener("keydown", listen, true);
  }, []);

  const context = c.targetLabel ?? (session.room ? ROOM[session.room] : screenLabelFor(pathname));

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
    /* while she thinks the Thinking line is the status, so nothing is said twice */
    newest?.who === "tiff" && !newest.streaming
        ? newest.text
        : "";

  /* The live turn rides at the end of the list under its own key, so when it
     becomes a turn it is the SAME element: the words settle where they are. */
  const all: ModalTurn[] = c.live
    ? [...c.turns, { key: c.live.key, who: "you", text: c.live.said ?? c.draft, enter: c.live.enter }]
    : c.turns;
  let lastYou = -1;
  let lastTiff = -1;
  all.forEach((t, i) => {
    if (t.who === "you") lastYou = i;
    else lastTiff = i;
  });

  const turnsRef = useRef<HTMLDivElement | null>(null);
  const tail = all.length ? `${all.length}:${all.at(-1)!.text.length}:${c.interim.length}` : "";
  /* A conversation opened again is at its newest turn as the modal appears,
     not scrolled there in front of you; only what arrives after is. */
  const openedOn = useRef(tail);
  /** The list is at its newest, unless you have scrolled back through it yourself. */
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = turnsRef.current;
    const first = tail === openedOn.current;
    atEnd.current = true;
    if (el && typeof el.scrollTo === "function")
      el.scrollTo({ top: el.scrollHeight, behavior: session.still || first ? "auto" : "smooth" });
  }, [tail, session.still]);
  /* KEPT AT THE NEWEST AS THE LIST ITSELF CHANGES SIZE. Talking again opens
     the face above the list, which gives the list less room; a list kept
     where it was then showed an earlier part of the conversation, not the
     words you were saying (Isaac, live: it "goes back to the top of the
     chat"). While it is at its newest it stays there, frame by frame. A
     scroll away from the end that a wheel, a touch or a key made is you
     reading back, and it is left alone; the list's own smooth scroll to a
     new turn passes through the middle too, and is not. */
  useEffect(() => {
    const el = turnsRef.current;
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
  }, []);

  return (
    <>
      {small && (
        <button type="button" className="tc-ask" onClick={() => setSmall(false)}>
          <span className="tc-askmark" aria-hidden="true">
            <TiffGlyph ground="ink" size={20} />
          </span>
          Ask Tiff
        </button>
      )}
      <section
        ref={dialog}
        className={"tm tc-docked" + (small ? " tc-small" : "")}
        role="dialog"
        aria-label="Tiff"
        tabIndex={-1}
        inert={leaving || small}
      >
        <header className="tm-head">
          <span className="tm-who">
            <span className="tm-hmark" aria-hidden="true">
              <TiffGlyph ground="ink" quiet size={24} />
            </span>
            {context && <Fade className="tm-ctx">{context}</Fade>}
            {c.aimed && c.targetLabel && (
              <button
                type="button"
                className="tm-aimx"
                aria-label={`Clear the tag — not about ${c.targetLabel}`}
                onClick={c.dropAim}
              >
                <Icon name="x" size={16} />
              </button>
            )}
          </span>
          <IconButton glyph="minimise" label="Minimise" size={32} onClick={() => setSmall(true)} />
          <button type="button" className="tm-x" aria-label="Close" onClick={(e) => close(e.detail === 0)}>
            <Icon name="x" size={20} />
          </button>
        </header>

        <div className="tm-turns" ref={turnsRef}>
          {all.map((t, i) => (
            <TurnView
              key={t.key}
              turn={t}
              past={i < lastYou}
              live={c.live?.key === t.key && c.live.said === null ? (c.fixing ? "fix" : "words") : null}
              question={c.questionOpen && i === lastTiff}
              c={c}
            />
          ))}
          {(c.stage === "thinking" || (c.stage === "answering" && all.at(-1)?.who !== "tiff")) && <ThinkingLine about={c.doing} />}
        </div>
        <p className="sr-only" role="status">
          {heard}
        </p>

        <Dock c={c} onEmpty={close} />
      </section>
    </>
  );
}

/* ── a turn ── */

export function TurnView({
  turn,
  past,
  live,
  question,
  c,
}: {
  turn: ModalTurn;
  past: boolean;
  live: "words" | "fix" | null;
  /** Her question, still standing: asked, or asked and being listened for. */
  question: boolean;
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

  const asking = question;
  /** Listening, and nothing said yet. */
  const asked = live === "words" && !c.draft.trim() && !c.interim.trim();
  const rows = turn.rows ?? [];

  return (
    <div
      ref={ref}
      className={"tm-turn" + (turn.who === "you" ? " tm-mine" : "") + (past ? " past" : "") + (live ? " live" : "")}
    >
      {/* Until you say something, the modal asks you to (Isaac, watching it
          live: "needs to prompt you to talk to it"); "You" arrives with your
          first words, where it no longer stands over nothing. */}
      {!asked && <div className="tm-label">{turn.who === "you" ? "You" : "Tiff"}</div>}
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
          {asked ? <p className="tm-tt tm-ask">Go ahead, I’m listening</p> : <LiveWords className="tm-tt" free said={c.draft} text={c.interim} />}
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

      {/* her quick price, onto the job's quote as an option of its own */}
      {turn.offer && !turn.streaming && (
        <div className="tm-doors">
          {turn.offer.state === "added" ? (
            <span>{turn.offer.said}</span>
          ) : (
            <>
              <Button kind="second" size={32} disabled={turn.offer.state === "busy"} onClick={() => void c.addOffer(turn.key)}>
                {turn.offer.state === "busy" ? "Adding to the quote" : "Add to quote"}
              </Button>
              {turn.offer.state === "failed" && <span>{turn.offer.said}</span>}
            </>
          )}
        </div>
      )}

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
          <Icon name="check" size={18} />
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
          <Icon name="x" size={16} />
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

/* ── the box ── */

/* THE BOX, AS CLAUDE'S IS (Isaac, 20 October 2026: "It needs to be minimal
   and look like a chat conversation in Claude… Little microphone symbol, the
   send can turn blue once there's content in there"; the board
   https://claude.ai/artifact/7Z74AT18cUFjexk68UovpB, built as mocked).
   One rounded box: your words, then a small microphone and Send as an
   arrow, grey until there is something to send. The microphone records in
   the box: a red dot and the time, with Stop; what you say comes up in the
   conversation as you say it, as it always has, and Stop gives it to her.
   No Type instead, Start again or Done. While she thinks the box stays,
   and Send waits. */
export function Dock({ c, onEmpty }: { c: Conversation; onEmpty: (byKey: boolean) => void }) {
  const listening = c.stage === "listening";
  const working = c.stage === "thinking" || c.stage === "answering";
  const typed = c.draft.trim() !== "";
  const field = useRef<HTMLTextAreaElement | null>(null);
  const stop = useRef<HTMLButtonElement | null>(null);
  /* focus is in the chat from the moment it opens: on the box to type, or on
     Stop while she listens (on the box, a pause would be read as you typing) */
  useEffect(() => {
    if (listening) stop.current?.focus({ preventScroll: true });
    else if (!working && !c.fixing) field.current?.focus({ preventScroll: true });
  }, [working, listening, c.fixing]);
  /* the box grows with what is in it, to five lines */
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [c.draft, listening]);
  const canSend = typed && !working && !listening;

  return (
    <footer className="tm-dock tc-dock">
      <form
        className="tc-box"
        onPointerDown={(e) => {
          /* a tap in the box while she listens says "I'm still going" */
          if (listening && !(e.target as Element).closest("button")) c.keepListening();
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) c.send();
        }}
      >
        {!c.fixing && (
          <textarea
            ref={field}
            className="tc-in"
            rows={1}
            value={listening ? "" : c.draft}
            /* while your words are read back nothing is typed in front of them */
            readOnly={c.stage === "thinking"}
            onChange={(e) => (listening ? c.typeInstead(e.target.value) : c.setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) c.send();
              }
            }}
            placeholder="Reply to Tiff"
            aria-label="Reply to Tiff"
            autoComplete="off"
          />
        )}
        <div className="tc-row">
          {listening && (
            <span className="tc-rec">
              <span className="tc-recdot" aria-hidden="true" />
              <DictClock seconds={c.seconds} />
            </span>
          )}
          <span className="tc-sp" />
          {listening ? (
            <button
              type="button"
              className="pt-btn pt-btn--second pt-btn--32 pt-btn--icon tc-stop"
              aria-label="Stop"
              ref={(el) => {
                stop.current = el;
                c.bindQuiet(el);
              }}
              onClick={(e) => {
                if (!c.done()) onEmpty(e.detail === 0);
              }}
            >
              <span aria-hidden="true" />
            </button>
          ) : c.voiceEnabled ? (
            <IconButton glyph="mic" label="Speak instead of typing" size={32} disabled={working} onClick={(e) => c.talk(e.currentTarget, e.detail === 0)} />
          ) : null}
          <IconButton glyph="send" kind="main" type="submit" label="Send" size={32} disabled={!(canSend || (c.fixing && typed))} />
        </div>
      </form>
      {c.error && (
        <p className="tm-err" role="alert">
          {c.error}
        </p>
      )}
    </footer>
  );
}

/* WHILE SHE THINKS: "Thinking", three dots, and what she's doing when the
   tool she picked up says ("reading the design"). No mark turning here:
   where there is one, it is above the conversation (Isaac, 20 October). */
export function ThinkingLine({ about }: { about: string }) {
  return (
    <p className="tc-think" role="status">
      <span>Thinking</span>
      <span className="tc-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {about && <span className="tc-about">{about}</span>}
    </p>
  );
}
