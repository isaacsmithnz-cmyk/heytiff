"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { useNoteScope } from "@/components/notes/note-context";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { loadThreads, saveThreads, type TiffMsg, type TiffThread } from "@/lib/tiff/threads";
import { pushThreads } from "@/lib/tiff/thread-sync";
import { prefersStill } from "./box-motion";
import { Dock, TurnView } from "./tiff-modal";
import { useConversation, type ModalTurn } from "./use-conversation";

/* TIFF ON THE PAGE (Isaac, 20 October: the conversation takes Home's page,
   as Claude's does, instead of a window over it; the board
   https://claude.ai/artifact/AVjfrGkoonJch3NBX9Fmeh, frame 2). The same
   conversation the window has (./use-conversation), its turns and its dock
   (./tiff-modal), drawn on the page's white: Back to Home at the top, the
   turns, the reply box at the foot. Nothing flies; it is the page.

   EVERY CONVERSATION IS KEPT IN CONVERSATIONS ("Conversations are just
   where conversations are stored"): its turns are written to the same
   threads Conversations lists (lib/tiff/threads), words only, as they
   arrive, and the server copy follows (thread-sync). */

/* The clock and the dice at module scope, as the assistant keeps them: a
   clock in a component reads to the compiler as render code. */
const nowMs = (): number => Date.now();
const newThreadId = (at: number): string => `t-${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/** A turn as Conversations keeps it: what was said, and Tiff's plan as lines. */
function messageOf(t: ModalTurn, at: number): TiffMsg {
  const plan = (t.rows ?? []).filter((r) => !r.off).map((r) => `${r.lead}${r.join}${r.text}`);
  return { role: t.who === "you" ? "user" : "tiff", text: [t.text, ...plan].filter((s) => s.trim()).join("\n"), at };
}

export function TiffInline({ words, onBack }: { words: string; onBack: () => void }) {
  const scope = useNoteScope();
  const router = useRouter();
  const [at] = useState(nowMs);
  const [still] = useState(prefersStill);
  const [threadId] = useState(() => newThreadId(at));
  const c = useConversation({
    opening: { words, room: "home", origin: null, still, at },
    voiceEnabled: scope.voiceEnabled,
    target: scope.target,
    targetLabel: scope.targetLabel,
    screen: "Home",
    onLeave: (href) => leave(href),
  });

  const back = () => {
    const done = c.close();
    if (done.changed) router.refresh();
    onBack();
  };
  /* Tiff moved the screen: the page goes there, as the window's close does. */
  const leave = (href: string) => {
    const done = c.close();
    router.push(href);
    if (done.changed) router.refresh();
  };

  /* kept in Conversations, turn by turn, once a turn has words; an answer
     still arriving waits until it has */
  const said = c.turns.filter((t) => !t.streaming && t.text.trim());
  const kept = useRef("");
  useEffect(() => {
    const now = c.turns.filter((t) => !t.streaming && t.text.trim());
    const sig = now.map((t) => `${t.key}:${t.text.length}:${t.rows?.length ?? 0}`).join("|");
    if (!now.length || sig === kept.current) return;
    kept.current = sig;
    const first = now.find((t) => t.who === "you")?.text.trim() ?? "Home";
    const thread: TiffThread = {
      id: threadId,
      /* the list fades a long one (rule 50), so it is cut, never dotted */
      title: first.slice(0, 80).trimEnd(),
      updatedAt: nowMs(),
      messages: now.map((t, i) => messageOf(t, at + i)),
    };
    try {
      saveThreads([thread, ...loadThreads().filter((x) => x.id !== threadId)]);
      pushThreads();
    } catch {
      /* storage refused: the conversation still happened, it just isn't kept */
    }
  }, [c.turns, threadId, at]);

  /* the live turn rides at the end, as in the window, so it settles where it is */
  const all: ModalTurn[] = c.live ? [...c.turns, { key: c.live.key, who: "you", text: c.live.said ?? c.draft, enter: c.live.enter }] : c.turns;
  let lastYou = -1;
  let lastTiff = -1;
  all.forEach((t, i) => {
    if (t.who === "you") lastYou = i;
    else lastTiff = i;
  });

  /* kept at the newest as turns arrive */
  const turnsRef = useRef<HTMLDivElement | null>(null);
  const tail = all.length ? `${all.length}:${all.at(-1)!.text.length}:${c.interim.length}` : "";
  useLayoutEffect(() => {
    const el = turnsRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
  }, [tail, still]);

  const working = c.stage === "thinking" || c.stage === "answering";
  const title = said.find((t) => t.who === "you")?.text ?? words;

  return (
    <section className="hm-chat" aria-label="Talking to Tiff">
      <div className="hm-chatbar">
        <Button kind="quiet" size={32} onClick={back}>
          ‹ Back to Home
        </Button>
        <Fade className="hm-chat-title">{title}</Fade>
        <TiffGlyph size={32} alive working={working} label="Tiff" />
      </div>
      <div className="tm-turns hm-chat-turns" ref={turnsRef}>
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
        {c.stage === "thinking" && <p className="hm-chat-now" role="status">Tiff is sorting it out</p>}
      </div>
      <Dock c={c} onEmpty={back} />
    </section>
  );
}
