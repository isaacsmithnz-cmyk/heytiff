"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { LiveWords, saidSomething, useDictation } from "@/components/notes/dictation";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { Wave } from "@/components/conversations/speak-bar";
import { quietLimit } from "@/components/tiff/modal/quiet";
import { stopSpeaking, useReadingOut } from "@/lib/voice/speaker";

/* TALKING TO TIFF, HANDS-FREE (Isaac, 26 November 2026: "both", then
   "Flow's right" to https://claude.ai/artifact/2vtUgVFZHbJf5gamXZZBPm,
   board 3). You talk, she answers out loud, and she listens again, until
   End talk.

   NOTHING HERE IS A SECOND TIFF. Each thing you say is a turn of the chat
   it was opened from, asked the way a typed question is (`onSay`), with her
   tools and her history, and written into that chat as it happens; this is
   only the ears and the mouth. The mic opens on the dictation hook every box
   uses and closes on quiet as the Tiff modal's does (modal/quiet.ts); her
   answer is read by the one reader Read out uses (lib/voice/speaker).

   THE MIC IS SHUT WHILE SHE SPEAKS, so she never hears herself. Stop Tiff
   cuts her off and listens; Mute leaves it shut until Unmute.

   Her mark is 96 here and the boomerang is up the whole time she's
   listening, thinking or speaking (rule 8); the word under it says which. */

export type TalkTurn = { key: string; who: "you" | "tiff"; text: string; steps?: string[] };

type Phase = "opening" | "listening" | "thinking" | "speaking" | "muted";

const WORD: Record<Phase, string> = {
  opening: "Listening",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  muted: "Muted",
};

export function TalkDialog({
  turns,
  readingId,
  about,
  onSay,
  onEnd,
}: {
  /** This talk's turns so far, in the chat: yours and hers, hers still arriving last. */
  turns: TalkTurn[];
  /** What the reader calls her answer while she says it, so the screen knows she's speaking. */
  readingId: (key: string) => string;
  /** The job the chat is about, when it is one. */
  about?: string | null;
  /** Ask her what was said; resolves once she has answered and said it. */
  onSay: (words: string) => Promise<void>;
  onEnd: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("opening");
  const [error, setError] = useState<string | null>(null);
  const ended = useRef(false);
  const muted = useRef(false);

  /* The hook's callbacks reach the latest `heard` through a ref: the take
     that ends was started renders ago. */
  const heardRef = useRef<(words: string) => void>(() => {});
  const listenRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});
  const dict = useDictation({
    onTranscript: (words) => heardRef.current(words),
    onError: (message) => {
      setError(message);
      setPhase("muted");
      muted.current = true;
    },
    quietEnd: quietLimit,
    onQuiet: () => dict.stop(),
  });

  const listen = () => {
    if (ended.current) return;
    setError(null);
    setPhase("listening");
    dict.start();
  };

  const heard = (words: string) => {
    if (ended.current) return;
    if (!saidSomething(words)) return listen();
    setPhase("thinking");
    void onSay(words.trim()).finally(() => {
      if (!ended.current && !muted.current) listenRef.current();
    });
  };
  useEffect(() => {
    heardRef.current = heard;
    listenRef.current = listen;
    cancelRef.current = dict.cancel;
  });

  /* opened from a tap, so the first take starts at once */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    stopSpeaking();
    listenRef.current();
  }, []);

  /* speaking from her first word on the screen to the last one said */
  const reading = useReadingOut();
  const last = turns[turns.length - 1];
  const speaking = !!last && last.who === "tiff" && reading === readingId(last.key);
  const shown: Phase = phase === "thinking" && (speaking || (last?.who === "tiff" && last.text)) ? "speaking" : phase;

  const end = () => {
    ended.current = true;
    dict.cancel();
    stopSpeaking();
    onEnd();
  };
  useEffect(
    () => () => {
      ended.current = true;
      cancelRef.current();
      stopSpeaking();
    },
    []
  );

  const mute = () => {
    muted.current = true;
    dict.cancel();
    setPhase("muted");
  };
  const unmute = () => {
    muted.current = false;
    listen();
  };

  const scroll = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.text, dict.interim]);

  const listeningNow = dict.recording || dict.arming;
  const up = shown !== "muted";

  return (
    <Dialog
      heading="Talking to Tiff"
      under={about ?? undefined}
      onClose={end}
      dismissable={false}
      width={560}
      foot={
        <>
          {shown === "speaking" ? (
            <Button kind="second" size={44} onClick={() => stopSpeaking()}>
              Stop Tiff
            </Button>
          ) : shown === "muted" ? (
            <Button kind="second" size={44} onClick={unmute}>
              Unmute
            </Button>
          ) : (
            <Button kind="second" size={44} onClick={mute}>
              Mute
            </Button>
          )}
          <Button kind="main" size={44} onClick={end}>
            End talk
          </Button>
        </>
      }
    >
      <div className="tlk">
        <div className="tlk-face">
          <TiffGlyph size={96} working={up} />
          <p className="tlk-word" role="status">
            {WORD[shown]}
            {shown === "thinking" && (
              <span className="tc-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
          </p>
        </div>
        <div className="tlk-turns" ref={scroll}>
          {turns.map((t) =>
            t.who === "you" ? (
              <p key={t.key} className="tlk-you">
                {t.text}
              </p>
            ) : (
              <div key={t.key} className="tlk-tiff">
                {t.steps && t.steps.length > 0 && (
                  <ul className="tlk-steps" aria-label="What Tiff did">
                    {t.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {t.text && <p>{t.text}</p>}
              </div>
            )
          )}
          {listeningNow && dict.interim && (
            <div className="tlk-you tlk-you--live">
              <LiveWords said="" text={dict.interim} />
            </div>
          )}
        </div>
        <div className="cv-bar tlk-bar">
          {shown === "muted" ? (
            <span className="tlk-off">{error ?? "Your microphone is off"}</span>
          ) : (
            <Wave barsRef={dict.barsRef} />
          )}
        </div>
      </div>
    </Dialog>
  );
}
