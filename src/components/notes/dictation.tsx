"use client";

import { useEffect, useInsertionEffect, useRef, useState } from "react";
import { startRealtime, type RealtimeHandle } from "@/lib/voice/realtime-stream";
import { playChime } from "@/lib/voice/chime";
import { clearRun, markStopped, markTranscript } from "@/lib/voice/timing";

/* Dictation, extracted from the note pill so every box you'd type a paragraph
   into can have it (Isaac, 2026-08-02: "anywhere that you need to enter notes
   or anything that would involve a reasonable amount of typing should have a
   voice-to-text option"). The pill owned this engine and was the only thing
   in the app that could hear you, which is backwards — the pill's job is
   ROUTING a note into tasks and flags, and dictation is just how you get
   words in. They're separate concerns and now they're separate code.

   THIS FILE IS THE ENGINE AND NOTHING ELSE. It used to also carry two
   dressed-up fields (`DictateBox`, `DictateLine`); those are now postures of
   the one token in ./note-token, because five controls that all did some
   subset of "hear a person and do something with the words" is what this
   whole track exists to undo. Nothing in here knows what a note IS.

   It also lives under components/notes/ rather than components/workboard/,
   which is not tidying: the widget is meant to end up on every screen, and
   leaving the engine inside one feature's folder is how it stayed one
   feature's engine for two months.

   TWO TRANSPORTS, ONE HOOK. By default this records and transcribes WHEN
   YOU STOP — the shipped behaviour, unchanged. Built with
   NEXT_PUBLIC_VOICE_REALTIME=1 it also opens a socket to Scribe v2 Realtime
   and words appear as they're said (same dev-flag mechanism as
   NEXT_PUBLIC_STUDIO_SIM: inlined at build time, so flipping it is a
   redeploy). The flag chooses a transport, never a feature — every caller's
   props are the same either way, which is the point of putting the choice
   here rather than in six components.

   THE RECORDER RUNS IN BOTH MODES, and that is the safety model, not an
   oversight. The live path can fail at the token, the handshake, the
   worklet, a vendor error, a dropped socket or an empty transcript; in
   every one of those cases the MediaRecorder has been running the whole
   time, so the audio uploads the old way and the person never finds out.
   A live transcript is a nicety. The words are not.

   The level meter is real samples, so if the bars don't move, nothing is
   being heard.

   The mic is always an ENHANCEMENT. No key, no permission, no MediaRecorder —
   the box is still a plain textarea you can type into. */

/** Inlined at build time — a live transcript is opt-in per deployment. */
const REALTIME = process.env.NEXT_PUBLIC_VOICE_REALTIME === "1";

/* HOW LONG YOU GET, AND WHY THERE IS A LIMIT AT ALL.

   There wasn't one until 2026-08-06. Nothing stopped a recording — the clock
   counted up for as long as the mic was open — and the only cap in the system
   was 25 MB on the upload route, which is about an hour of speech and whose
   error message nonetheless told people to "keep it under a couple of
   minutes". A limit nobody enforced, announced by a message nobody could
   reach.

   Two minutes is the real one now, and it lives HERE rather than in a posture
   so that every mic in the app inherits it — the capsule, the strip, the
   field, the line, the debrief and Tiff's ask bar. A cap that only applied to
   the screen someone happened to be building would be exactly the kind of
   fork this file exists to prevent.

   IT STOPS, IT DOES NOT DISCARD. Hitting the ceiling runs the same path as
   pressing stop, so the two minutes you already said are transcribed and
   kept. Throwing away a long recording because it ran long is the one
   outcome nobody would forgive. */
export const MAX_RECORDING_SECONDS = 120;

/** When the clock stops counting up and starts counting down. Long enough to
    finish a sentence and press stop yourself. */
export const COUNTDOWN_FROM = 30;

/* A build-time flag can't be A/B'd: every swap is a redeploy of production,
   which is no way to find out whether the live path is actually faster. So
   `?voice=live` / `?voice=batch` beats the flag — enough to measure both
   against the same note, on the same connection, minutes apart.

   IT LIVES IN THE URL AND NOWHERE ELSE, and that is the whole lesson of
   2026-08-04. The first version stashed the choice in sessionStorage so it
   would survive navigation, with a comment observing that an override
   outliving its tab "would eventually have someone debugging a transport
   nobody remembers choosing". It took about an hour: Isaac measured with
   `?voice=live`, came back later to a plain URL, recorded a note, got
   nothing, and reported the feature broken. It wasn't the feature — it was
   this. Server logs showed the token route being hit with no query string
   in sight.

   A measuring switch you cannot see in the address bar is a trap, and the
   convenience it bought (not retyping a query string) was never worth it.
   No storage, no ghost state: the URL says which transport you are on, or
   you are on the deployment's default.

   Read in the click handler and never during render — a value that differs
   between server and client would tear hydration if it reached the markup,
   and this one deliberately does not. */
export function transportChoice(): boolean {
  if (typeof window === "undefined") return REALTIME;
  const asked = new URLSearchParams(window.location.search).get("voice");
  if (asked === "live") return true;
  if (asked === "batch") return false;
  return REALTIME;
}

/* WHAT COMES BACK IS NOT ALWAYS SPEECH. Scribe labels non-speech audio in
   brackets — "[outro jingle]", "(music)", "[BLANK_AUDIO]" — and a clip with
   nothing said in it comes back as nothing BUT that label. Live-walked
   2026-08-10: a silent recording put "[outro jingle]" into the capture box
   as if somebody had said it, and down the Stop & read path that same string
   would have been handed to the router and filed as a note.

   Anything left once the labels are stripped is real speech, so a genuine
   sentence with a "[cough]" in it still counts. */
export const saidSomething = (text: string) =>
  text.replace(/[[(][^\])]*[\])]/g, "").trim() !== "";

type DictationState = {
  recording: boolean;
  /** Sending the audio off and waiting for words back. */
  transcribing: boolean;
  seconds: number;
  /** Words heard SO FAR, while they're still being said. Always "" on the
      batch transport — a caller that shows it simply shows nothing until
      the live path is switched on. */
  interim: string;
  /** Bind to the level-meter element; the meter writes to it every frame. */
  barsRef: React.RefObject<HTMLSpanElement | null>;
  start: () => void;
  stop: () => void;
  /** Stop, but keep the words for the box rather than routing them. */
  handOver: () => void;
  /** Throw the recording away — nothing is transcribed, nothing is sent. */
  cancel: () => void;
};

export function useDictation({
  onTranscript,
  onError,
}: {
  /* TWO WAYS A RECORDING CAN END, and the caller still has to tell them
     apart — though no longer to decide whether to ROUTE. Nothing routes off
     a transcript any more (see note-flow): the words land in the box to be
     checked whichever way the recording ended, which is what killed the
     third case. `handedOver` existed only to carve out "keep these, do not
     route them", and that is now simply what happens.

       (not capped)  you stopped, or handed over to the keyboard. The words
                     are yours to look at; there is nothing to explain.
       capped        the two-minute clock ran out mid-sentence. Same words,
                     same box, but SAY SO — this ending was not chosen.

     Callers that only ever append (the field mics, Tiff's ask bar) can
     ignore it entirely, and always could. */
  onTranscript: (text: string, info: { capped: boolean }) => void;
  onError?: (message: string) => void;
}): DictationState {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  /* Set by the ceiling effect, cleared by every fresh `start`. Read when
     the words are handed over, which is always after the stop it caused. */
  const capped = useRef(false);
  /* WAS ANYTHING ACTUALLY SAID? Counted off the real level meter, because
     that is the only honest source — the same samples the bars are drawn
     from. A few frames above room noise is a voice; nothing is nothing.
     `handOver` needs this to tell a recording apart from a mis-tap. */
  const loudFrames = useRef(0);
  /* AND DID THE METER EVEN RUN? It is an enhancement — no AudioContext, a
     blocked one, a browser that refuses — and `startMeter` gives up quietly
     when it cannot start. Without this flag "the meter heard nothing" is
     indistinguishable from "there was no meter", and handOver would bin
     real speech on every browser where the meter failed. Not knowing must
     never mean throwing it away. */
  const meterRan = useRef(false);
  const barsRef = useRef<HTMLSpanElement | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const live = useRef<RealtimeHandle | null>(null);

  /* The callbacks live in a ref so the recorder's own handlers always see the
     current ones without the effect below re-running and dropping the mic.
     THE REF IS THE POINT: put `onTranscript`/`onError` in the deps of the
     unmount effect further down and every parent re-render runs its cleanup,
     which discards a live recording mid-sentence. That is the bug this shape
     exists to prevent, and it is one dependency array away at all times.

     The write is an INSERTION EFFECT rather than a line in the render body,
     where it used to be. A render-phase write lands on renders React is free
     to throw away, which is why the rule bans it — but the timing it bought
     is real and worth keeping: `useInsertionEffect` runs synchronously inside
     the commit, so there is no moment at which a handler can read a callback
     the last committed render already replaced. A plain `useEffect` flushes
     on a later task, and this hook spends most of its life inside promises
     (getUserMedia, the token fetch, `handle.stop()`, the upload) that resolve
     on microtasks — exactly the window that would leave stale. */
  const cbs = useRef({ onTranscript, onError });
  useInsertionEffect(() => {
    cbs.current = { onTranscript, onError };
  });

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  /* The ceiling. Kept out of the tick above on purpose: stopping the recorder
     from inside a setState updater is a side effect in a place React is
     allowed to run twice, and the one thing this must never do is fire the
     stop path more than once. Watching the committed value instead makes it
     an ordinary effect, and `recorder.current.stop()` after the recorder has
     already stopped is a no-op anyway. */
  useEffect(() => {
    if (!recording || seconds < MAX_RECORDING_SECONDS) return;
    if (recorder.current?.state !== "recording") return;
    capped.current = true;
    playChime("stop");
    recorder.current.stop();
  }, [recording, seconds]);

  const stopMeter = () => {
    barsRef.current?.style.setProperty("--lvl", "0");
    if (!meter.current) return;
    cancelAnimationFrame(meter.current.raf);
    void meter.current.ctx.close().catch(() => {});
    meter.current = null;
  };

  const startMeter = (stream: MediaStream) => {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const s of samples) {
          const centred = (s - 128) / 128;
          sum += centred * centred;
        }
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
        if (level > 0.07) loudFrames.current += 1;
        // straight to the DOM, never through React — this runs every frame
        barsRef.current?.style.setProperty("--lvl", level.toFixed(3));
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };

      meter.current = { ctx, raf: requestAnimationFrame(tick) };
      meterRan.current = true;
    } catch {
      /* no meter; recording continues */
    }
  };

  // unmounting must release the microphone — a live mic behind a closed sheet
  // is the kind of thing you only find out about from a support call
  useEffect(
    () => () => {
      stopMeter();
      live.current?.cancel();
      live.current = null;
      const rec = recorder.current;
      if (rec?.state === "recording") {
        discard.current = true;
        rec.stop();
      } else rec?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  /** The batch transport, unchanged — and now also the live one's floor. */
  const upload = async (blob: Blob) => {
    try {
      const form = new FormData();
      form.append("audio", blob, "note.webm");
      const res = await fetch("/api/workboard/transcribe", { method: "POST", body: form });
      const body = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !body.text || !saidSomething(body.text)) {
        /* A run that never reaches a proposal has to be dropped, or the
           NEXT note — quite possibly a typed one — prints its `routed`
           measured from a stop that happened minutes ago. */
        clearRun();
        cbs.current.onError?.(
          body.error ??
            (body.text ? "Nothing was said in that one. Try again, or type it." : "That recording couldn't be read. Type it instead.")
        );
        return;
      }
      markTranscript("batch");
      cbs.current.onTranscript(body.text, { capped: capped.current });
    } catch {
      clearRun();
      cbs.current.onError?.("That recording couldn't be sent. Type it instead.");
    }
  };

  /* Try to bring the socket up alongside the recorder. Deliberately NOT
     awaited by `start`: the mic is already recording by the time this runs,
     so a slow token or a refused handshake costs a live transcript and
     nothing else. Every failure here is silent by design — there is nothing
     to tell the person, because nothing they asked for has been lost. */
  const goLive = async (stream: MediaStream) => {
    try {
      const res = await fetch("/api/workboard/transcribe/token", { method: "POST" });
      if (!res.ok) return;
      const { token, keyterms } = (await res.json()) as { token?: string; keyterms?: string[] };
      if (!token) return;
      const handle = await startRealtime({
        stream,
        token,
        keyterms: keyterms ?? [],
        onText: setInterim,
      });
      /* Stopped or discarded while the handshake was in flight — the socket
         is now nobody's, so close it rather than leak a paid stream. */
      if (recorder.current?.state !== "recording") {
        handle.cancel();
        return;
      }
      live.current = handle;
    } catch (err) {
      console.error(`[dictation] live transport unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const start = () => {
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        /* Only once the microphone is genuinely open — chiming before the
           prompt is answered would announce a recording that may never
           start. `{ audio: true }` turns on echo cancellation by default,
           which is what keeps this note out of the clip that follows. */
        playChime("start");
        const rec = new MediaRecorder(stream);
        discard.current = false;
        capped.current = false;
        loudFrames.current = 0;
        meterRan.current = false;
        setInterim("");
        startMeter(stream);
        const chunks: BlobPart[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = async () => {
          const handle = live.current;
          live.current = null;
          stopMeter();
          setRecording(false);
          /* The clock starts the moment they stop talking, because that is
             the moment they start waiting. */
          markStopped();

          if (discard.current) {
            handle?.cancel();
            stream.getTracks().forEach((t) => t.stop());
            setInterim("");
            clearRun();
            return;
          }

          setTranscribing(true);
          try {
            /* The live transcript first, because it is already finished.
               `stop()` only flushes the last utterance — it does not wait
               for the whole recording to be processed, which is the entire
               difference between this path and the one below it. */
            if (handle) {
              const text = (await handle.stop()).trim();
              if (saidSomething(text)) {
                markTranscript("live");
                cbs.current.onTranscript(text, { capped: capped.current });
                return;
              }
              /* Socket produced nothing. The clip is still in `chunks`, so
                 the batch path below is the floor — but SAY SO, because this
                 is the exact silence that made 2026-08-04's failure look
                 like a broken feature instead of a failing transport. */
              console.error("[realtime] socket returned no words — falling back to upload");
            }

            /* NOTHING RECORDED IS STILL SOMETHING TO SAY. This branch used
               to `return` in silence, on the theory that an empty clip meant
               a stray press with nothing to report. On 2026-08-04 it swallowed
               a real failure instead: three notes went to the live socket,
               came back with no words, fell through to here, found an empty
               blob and vanished — no transcript, no error, nothing to tell
               the difference between "we heard nothing" and "we are broken".

               The floor is the same as everywhere else in this file: say
               something, and leave the person a way to get their note in. */
            const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            if (blob.size === 0) {
              clearRun();
              console.error("[dictation] recording was empty — nothing to transcribe");
              cbs.current.onError?.("Nothing was recorded. Try again, or type it.");
              return;
            }
            await upload(blob);
          } finally {
            /* The tracks are held until here so the live path can flush the
               last sentence off a stream that is still open. */
            stream.getTracks().forEach((t) => t.stop());
            setTranscribing(false);
            setInterim("");
          }
        };
        recorder.current = rec;
        rec.start();
        setSeconds(0);
        setRecording(true);
        if (transportChoice()) void goLive(stream);
      } catch {
        // graceful floor: whatever asked for this stays usable by typing
        cbs.current.onError?.("No microphone available — type it instead.");
      }
    })();
  };

  const stop = () => {
    if (recorder.current?.state !== "recording") return;
    playChime("stop");
    recorder.current.stop();
  };

  /* FINISH IT BY TYPING, and the two cases are not the same thing.

     SAID SOMETHING → stop like `stop` does, but mark the words as handed
     over so the caller puts them in the box instead of routing them.
     Pressing Type mid-sentence must never file half a note and must never
     throw away what you already said, so the wait for the transcript is
     the honest price of keeping it.

     SAID NOTHING → this was a mis-tap, not a recording, and it must cost
     NOTHING. Live-walked 2026-08-10: Type on a silent clip uploaded the
     audio, held the card on "Reading it back" for two and a half seconds,
     and then dropped the transcriber's own noise label — "[outro jingle]" —
     into the box as if it were words. Nobody said anything, so there is
     nothing to read back: the audio goes in the bin, unsent, and the box is
     there instantly.

     No chime on that path either. A chime announces that something was
     kept or thrown away, and from where the person is standing they simply
     changed their mind about how to start. */
  const handOver = () => {
    const rec = recorder.current;
    if (rec?.state !== "recording") return;
    /* Discard ONLY where we are confident: the meter ran, it never rose
       above room noise, and the live socket produced no words either. Any
       uncertainty keeps the recording. */
    if (meterRan.current && loudFrames.current < 3 && interim === "") {
      discard.current = true;
      rec.stop();
      return;
    }
    playChime("stop");
    rec.stop();
  };

  const cancel = () => {
    if (recorder.current?.state !== "recording") return;
    /* Its own note. Stopping and discarding are both endings, and if they
       sounded alike you could not tell by ear whether the note was kept. */
    playChime("discard");
    discard.current = true;
    recorder.current.stop();
  };

  return { recording, transcribing, seconds, interim, barsRef, start, stop, handOver, cancel };
}

/** The five-bar real-sample meter — bind `ref` to a dictation's `barsRef`. */
export function LevelBars({ innerRef }: { innerRef: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <span className="wb-lvl" role="status" aria-label="Listening" ref={innerRef}>
      {[0.5, 0.8, 1, 0.8, 0.5].map((g, i) => (
        <i key={i} style={{ "--g": g } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** The live transcript, one word at a time — bind to a dictation's `interim`.

    THE ENGINE DOES NOT SPEAK EVENLY. Scribe sends partials in bursts and
    REVISES them: three words land at once, then a pause, then "grills"
    becomes "grilles". Rendering the whole string swapped the paragraph on
    every one of those, which read as flicker, and centring it meant each
    arrival shoved every word already said sideways. Isaac: less erratic,
    a smooth fast glide.

    Words keyed by POSITION is what buys that. React mounts only the spans
    just appended, so the glide runs on those alone; a revised word updates
    its text in place and stays put, which is exactly right — re-flashing a
    word you already read is the jitter, not the fix. */
export function LiveWords({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  /* Whether anything has actually scrolled out of sight above. The top of
     the box is faded so old words dissolve instead of being sliced, and
     that fade MUST be conditional: applied always, it dims the top of an
     unscrolled box — which is the first line of every short dictation, and
     most dictations are short. Measured after layout rather than guessed
     from length, because wrapping depends on the width it got. */
  const [scrolled, setScrolled] = useState(false);
  const words = text.split(/\s+/).filter(Boolean);

  /* Ride the newest word. The box is height-capped rather than growing,
     because a card that resizes under a two-minute dictation is its own
     kind of erratic — and the words you want are the last ones. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setScrolled(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  return (
    <p
      className={"wb2-livetext" + (scrolled ? " over" : "")}
      ref={ref}
      aria-live="polite"
    >
      {words.map((word, i) => (
        <span className="wb2-lw" key={i}>
          {word}
        </span>
      ))}
    </p>
  );
}

export const clockOf = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Seconds left before the recorder stops itself, floored at zero. */
export const remainingOf = (seconds: number) =>
  Math.max(0, MAX_RECORDING_SECONDS - seconds);

/** The recording clock, one component so every posture reads the same.

    It counts UP for most of the recording, because that is the only number
    worth knowing while you talk, and flips to counting DOWN for the last
    thirty seconds — the point at which the useful fact stops being how long
    you have been going and starts being how long you have left. */
export function DictClock({ seconds }: { seconds: number }) {
  const left = remainingOf(seconds);
  const closing = left <= COUNTDOWN_FROM;
  return (
    <span
      className={`wb2-capclock${closing ? " closing" : ""}`}
      /* The countdown is a state change mid-recording that nobody is looking
         at the clock to notice, so it is announced once it matters. */
      role={closing ? "status" : undefined}
      aria-live={closing ? "polite" : undefined}
      title={closing ? `${left}s left — it stops on its own at two minutes` : undefined}
    >
      {closing ? `${left}s left` : clockOf(seconds)}
    </span>
  );
}

/** Dictation APPENDS to what's already typed. One function because the live
    transport needs the same join to preview the sentence in the box as the
    committed transcript needs to land it — if they drifted apart, the words
    would visibly jump when you stopped talking. */
export const appendSpoken = (typed: string, spoken: string): string =>
  typed.trim() ? `${typed.trim()} ${spoken}` : spoken;

