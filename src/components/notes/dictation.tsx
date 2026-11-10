"use client";

import { Fragment, useEffect, useInsertionEffect, useLayoutEffect, useRef, useState } from "react";
import { openMicTap, startRealtime, type MicTap, type RealtimeHandle } from "@/lib/voice/realtime-stream";
import { playChime } from "@/lib/voice/chime";
import { clearRun, markStopped, markTranscript } from "@/lib/voice/timing";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { morphWords, type Said } from "@/lib/voice/morph-words";
import { nameRuns, namedWords } from "@/lib/staff/people-named";
import { usePeople } from "@/components/notes/use-people";

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

   Four minutes is the real one now (Isaac, 3 November 2026: "a 2-minute timer
   is potentially too little"), and it lives HERE rather than in a posture
   so that every mic in the app inherits it — the capsule, the strip, the
   field, the line, the debrief and Tiff's ask bar. A cap that only applied to
   the screen someone happened to be building would be exactly the kind of
   fork this file exists to prevent.

   IT STOPS, IT DOES NOT DISCARD. Hitting the ceiling runs the same path as
   pressing stop, so the four minutes you already said are transcribed and
   kept. Throwing away a long recording because it ran long is the one
   outcome nobody would forgive. */
export const MAX_RECORDING_SECONDS = 240;

/* WHAT COUNTS AS A VOICE, for the "was anything said" count that decides
   whether `handOver` may bin a take unheard. */
const LOUD_ENOUGH = 0.07;

/* HOW LONG THE MICROPHONE GETS TO OPEN before the card stops claiming to be
   listening.

   `getUserMedia` is not guaranteed to settle. A permission prompt nobody
   answers, a device another app is holding, an OS panel behind the window —
   all of them leave the promise pending for as long as you care to wait, and
   until 2026-08-17 that was invisible: the surface showed its idle box, so
   the mic simply never arrived and you pressed the button again.

   The card now opens ON the recording stage (`arming`), which is what makes
   this worth a ceiling: a pending prompt renders as a recording that is not
   happening — a red dot, a clock at 0:00, and a Done button for audio that
   does not exist. Four seconds is well past a granted permission (instant,
   after the first time) and well short of a person deciding the app is
   broken. Past it the card hands back the box and says so. */
const ARMING_CEILING_MS = 4_000;

/* What to say when the batch transport comes back with nothing usable. It is
   read inside a try/catch, so the `??` and the ternary have to live out here:
   React Compiler 1.0 cannot lower a value block in there and gives up on the
   whole component when it meets one. */
/* The tap, or none when the live transport is off. It swallows its own
   failure because a browser with no audio pipeline is a batch recording, not
   an error anybody needs to hear about. Out here because the ternary would be
   a value block inside `start`'s try. */
const tapFor = (stream: MediaStream) =>
  transportChoice() ? openMicTap(stream).catch(() => null) : null;

/* Both of these are read inside `goLive`'s try/catch, where a `??` or a
   ternary is a value block the compiler cannot lower. */
const keytermsOf = (k: string[] | undefined) => k ?? [];
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/* The words, or null when there are none worth handing back — refused, empty,
   or noise the transcriber labelled. Read inside a try/catch, where a `||`
   chain is a value block the compiler cannot lower, so it lives out here. */
const usableText = (ok: boolean, body: { text?: string }): string | null =>
  ok && body.text && saidSomething(body.text) ? body.text : null;

const unreadable = (body: { text?: string; error?: string }) =>
  body.error ??
  (body.text
    ? "Nothing was said in that one. Try again, or type it."
    : "That recording couldn't be read. Type it instead.");

/* AND WHAT TO SAY WHEN IT DOES NOT OPEN, which is the half that matters —
   Isaac, 2026-08-17: "now it's not listening at all", against a card sitting
   on the mark with a clock at 0:00.

   The three reasons a microphone stays shut want three different things from
   the person, and only one of them is "give up and type": a prompt that is
   still up needs an answer, and a site that is blocked needs a browser
   setting. Guessing between them would be worse than the silence — so this
   asks. `permissions.query` is not everywhere (Firefox has no `microphone`
   descriptor) and it is not allowed to matter: anything it cannot answer
   falls back to the floor this file has always used.

   Only ever called once a wait has already failed, so its own cost is
   irrelevant — it must never sit in front of opening the microphone. */
async function micStuck(): Promise<string> {
  try {
    const perms = navigator.permissions as Permissions | undefined;
    const state = (await perms?.query({ name: "microphone" as PermissionName }))?.state;
    if (state === "prompt")
      return "HeyTiff needs the microphone. Allow it when your browser asks.";
    if (state === "denied")
      return "HeyTiff needs the microphone. Allow it in your browser’s settings.";
  } catch {
    /* No permissions API, or no microphone descriptor. The floor below says
       the true thing either way. */
  }
  return "The microphone didn't open — type it instead.";
}

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
   as if somebody had said it, and down the stop-and-read path that same string
   would have been handed to the router and filed as a note.

   Anything left once the labels are stripped is real speech, so a genuine
   sentence with a "[cough]" in it still counts. */
export const saidSomething = (text: string) =>
  text.replace(/[[(][^\])]*[\])]/g, "").trim() !== "";

export type DictationState = {
  recording: boolean;
  /* THE MIC IS OPENING. `start()` awaits `getUserMedia`, opens a tap, plays
     the chime and builds a MediaRecorder before `recording` can go true —
     a gap that is short and is NEVER zero, and every surface that branches
     on `recording` alone rendered its idle self across it.

     On the Tiff button that was visible and Isaac hit it: press the button
     and a small card flashes up — the box, the Default switch, the words
     "Ask or tell Tiff" — before the recording card replaces it. The sheet
     is opened and the mic asked for in the same click handler, so the flash
     is the whole distance between those two lines.

     A surface that shows a recording shows it from HERE. There is no audio
     yet, which is exactly what the clock reading 0:00 says. */
  arming: boolean;
  /** Sending the audio off and waiting for words back. */
  transcribing: boolean;
  seconds: number;
  /** Words heard SO FAR, while they're still being said. Always "" on the
      batch transport — a caller that shows it simply shows nothing until
      the live path is switched on. */
  interim: string;
  /** Bind to the level-meter element; the meter writes to it every frame. */
  barsRef: React.RefObject<HTMLSpanElement | null>;
  /** Hand it what shows the quiet running out (`quietEnd`), as a ref
      callback: the meter writes `--quiet`, 0 to 1, to it every frame. */
  bindQuiet: (el: HTMLElement | null) => void;
  /** Start the quiet over, as if they had just spoken: a tap that says
      "I'm still going". */
  keepListening: () => void;
  start: () => void;
  stop: () => void;
  /** Stop, but keep the words for the box rather than routing them. */
  handOver: () => void;
  /** Throw the recording away — nothing is transcribed, nothing is sent. */
  cancel: () => void;
  /** Bin this recording unheard and open a fresh mic in its place. */
  restart: () => void;
};

export function useDictation({
  onTranscript,
  onError,
  quietEnd,
  onQuiet,
}: {
  /* TWO WAYS A RECORDING CAN END, and the caller still has to tell them
     apart. The capture card this was written for put the words in its box
     to be checked whichever way the recording ended, which is what killed
     a third case: `handedOver` existed only to carve out "keep these, do not
     route them". The card went with the old capture UI (2026-09-27); the
     Tiff modal (components/tiff/modal/use-conversation) sends the words on
     Done and holds a capped take to be fixed.

       (not capped)  you stopped, or handed over to the keyboard. The words
                     are yours to look at; there is nothing to explain.
       capped        the four-minute clock ran out mid-sentence. Same words,
                     same box, but SAY SO — this ending was not chosen.

     Callers that only ever append (the field mics, Tiff's ask bar) can
     ignore it entirely, and always could. */
  onTranscript: (text: string, info: { capped: boolean }) => void;
  onError?: (message: string) => void;
  /* ENDING ON QUIET (the Tiff modal, 2026-09-28: "having to click done kind
     of takes away from the conversation flow"). How long a quiet, in ms,
     after the voice was last heard, ends this take, given the words heard so
     far and whether the live transport is reading them; null keeps
     listening. Read every frame, so it is a policy, not a timer. When the
     quiet runs out `onQuiet` is called, once per quiet: speaking again
     re-arms it. The hook never stops itself on quiet; the caller does what
     its Done does. */
  quietEnd?: (words: string, how: { live: boolean }) => number | null;
  onQuiet?: () => void;
}): DictationState {
  const [recording, setRecording] = useState(false);
  const [arming, setArming] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  /* ONE OF THESE PER RECORDING, so that a later run can never answer for an
     earlier one. It was a single shared `discard` ref, which held only while
     a recording was always followed by a pause: `start` reset the flag long
     after the last `onstop` had read it.

     A real MediaRecorder fires `onstop` on a LATER TASK than the `stop()`
     that caused it, so any caller that bins a take and opens a new one in
     the same breath — `cancel()` then `start()` — clears the shared flag
     before the old handler reads it, and the recording that was thrown away
     is transcribed and appended instead. Words arriving in the box from a
     take you deliberately binned is the worst shape of this bug: it reads as
     the app inventing sentences.

     `restart` below is careful to sequence THROUGH `onstop` rather than
     around it, so it does not hit this on its own. The per-run object is
     what makes the hazard structurally impossible rather than a rule the
     next caller has to know. */
  const run = useRef<{ discard: boolean } | null>(null);
  /* Set by `restart`, honoured by the `onstop` it caused. The new mic opens
     from there rather than from the button, because the old one has to have
     let go of the meter, the tracks and the recording flag first — all three
     live in refs this hook shares between runs. */
  const restarting = useRef(false);
  /* CHANGED YOUR MIND WHILE IT WAS OPENING. The three ways out all check
     `recorder.state === "recording"` and do nothing before that is true, so
     while the mic is arming they were dead controls — and now that the card
     shows them from the first frame, that is a button you can press.

     ONE OBJECT PER ATTEMPT, for the same reason `run` below is one per
     recording: a shared boolean is answered by whichever attempt reads it
     last. Stand down, press Talk again, and a plain flag would be cleared by
     the second press before the FIRST attempt's `getUserMedia` resolved —
     which would then open a second recorder and a second live socket on the
     same voice, and file every word twice. */
  const arm = useRef<{ off: boolean } | null>(null);
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
  /* When a voice was last above `LOUD_ENOUGH`. Read only inside the animation
     frame — a clock touched during render tears hydration for the whole
     tree. */
  const lastLoud = useRef(0);
  const quietRef = useRef<HTMLElement | null>(null);
  /** The words heard so far, for `quietEnd`, which reads them every frame. */
  const heardText = useRef("");
  /** This quiet has already called `onQuiet`. Cleared by the voice. */
  const quietFired = useRef(false);
  const hear = (text: string) => {
    heardText.current = text;
    setInterim(text);
  };

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
  const cbs = useRef({ onTranscript, onError, quietEnd, onQuiet });
  useInsertionEffect(() => {
    cbs.current = { onTranscript, onError, quietEnd, onQuiet };
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
    quietRef.current?.style.setProperty("--quiet", "0");
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
        const now = performance.now();
        if (level > LOUD_ENOUGH) {
          loudFrames.current += 1;
          lastLoud.current = now;
        }
        // straight to the DOM, never through React — this runs every frame
        barsRef.current?.style.setProperty("--lvl", level.toFixed(3));
        const policy = cbs.current.quietEnd;
        if (policy) {
          /* Only after a voice: a take that has heard nobody yet is waiting
             for them to start, not for them to finish. */
          const heard = loudFrames.current >= 3 && lastLoud.current > 0;
          const limit = heard ? policy(heardText.current, { live: live.current !== null }) : null;
          const quiet = level > LOUD_ENOUGH ? 0 : now - lastLoud.current;
          if (quiet === 0) quietFired.current = false;
          quietRef.current?.style.setProperty("--quiet", limit ? Math.min(1, quiet / limit).toFixed(3) : "0");
          if (limit && quiet >= limit && !quietFired.current) {
            quietFired.current = true;
            cbs.current.onQuiet?.();
          }
        }
        /* NOTHING HERE REACHES REACT. A crossing of a quiet threshold used
           to flip a `hearing` flag for a label under the clock — a state
           update, and a re-render of the whole recording surface, every time
           you paused mid-sentence. The label is gone (see the note against
           `RecordingMeter`), so this loop is now purely one custom property
           written to one element, which is what it always wanted to be. */
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };

      lastLoud.current = 0;
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
        /* Unmounting is never a restart, whatever was pending. */
        restarting.current = false;
        if (run.current) run.current.discard = true;
        rec.stop();
      } else rec?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  /** The batch transport, unchanged — and now also the live one's floor.
      `mine` is the run that asked for it: words that arrive for a run somebody
      has already walked away from go in the bin, not in a box. */
  /* The optional call, hoisted into its own function. Both of `upload`'s
     endings report through it, and both are inside a try/catch — where React
     Compiler 1.0 cannot lower a value block, and gives up on the whole
     component when it meets one. */
  const report = (msg: string) => cbs.current.onError?.(msg);

  const upload = async (blob: Blob, mine: { discard: boolean }) => {
    try {
      const form = new FormData();
      form.append("audio", blob, "note.webm");
      const res = await fetch("/api/workboard/transcribe", { method: "POST", body: form });
      const body = (await res.json()) as { text?: string; error?: string };
      /* Walked away while this was in the air. Nothing to say and nowhere to
         say it — the surface that asked is gone. */
      if (mine.discard) return void clearRun();
      const text = usableText(res.ok, body);
      if (text === null) {
        /* A run that never reaches a proposal has to be dropped, or the
           NEXT note — quite possibly a typed one — prints its `routed`
           measured from a stop that happened minutes ago. */
        clearRun();
        report(unreadable(body));
        return;
      }
      markTranscript("batch");
      cbs.current.onTranscript(text, { capped: capped.current });
    } catch {
      clearRun();
      report("That recording couldn't be sent. Type it instead.");
    }
  };

  /* Try to bring the socket up alongside the recorder. Deliberately NOT
     awaited by `start`: the mic is already recording by the time this runs,
     so a slow token or a refused handshake costs a live transcript and
     nothing else. Every failure here is silent by design — there is nothing
     to tell the person, because nothing they asked for has been lost.

     IT IS HANDED A TAP THAT IS ALREADY LISTENING, opened back in `start`
     before the beep had finished. Everything below — the token round trip,
     the handshake, the worklet — used to be a hole at the front of the live
     transcript, which then beat the complete recording. The tap buffers
     through all of it; see the head of realtime-stream. */
  const goLive = async (tapping: Promise<MicTap | null>, rec: MediaRecorder) => {
    const tap = await tapping;
    if (!tap) return;
    /* IT MUST STILL BE THIS RECORDING. Every await below is a chance for the
       person to stop and start another one, and `state === "recording"` on
       its own is true of the NEXT recording too — which would hand a socket
       fed by a dead stream to a mic that is listening properly. */
    const mine = () => recorder.current === rec && rec.state === "recording";
    try {
      const res = await fetch("/api/workboard/transcribe/token", { method: "POST" });
      if (!res.ok) return void tap.close();
      const { token, keyterms } = (await res.json()) as { token?: string; keyterms?: string[] };
      if (!token) return void tap.close();
      /* Stopped or discarded while the token was in flight — nothing to
         listen to any more, and the recording is already on its way. */
      if (!mine()) return void tap.close();
      const handle = await startRealtime({
        tap,
        token,
        keyterms: keytermsOf(keyterms),
        onText: hear,
      });
      /* Stopped or discarded while the handshake was in flight — the socket
         is now nobody's, so close it rather than leak a paid stream. */
      if (!mine()) {
        handle.cancel();
        return;
      }
      live.current = handle;
    } catch (err) {
      /* `startRealtime` closes the tap on its own way out and closing twice
         is a no-op, so this is the one line that covers every failure
         whichever side of the handover it happened on. */
      tap.close();
      console.error(`[dictation] live transport unavailable: ${errText(err)}`);
    }
  };

  const start = () => {
    /* SYNCHRONOUS, and that is the point — it is read in the same render as
       the click that asked for it, so the surface never shows its idle self
       between the press and the microphone. Everything below is a wait.

       THE LAST RECORDING'S WORDS GO NOW, not after `getUserMedia` comes back.
       There is one microphone, so an attempt that was still opening stands
       down here rather than racing this one. */
    if (arm.current) arm.current.off = true;
    const mineArm = { off: false };
    arm.current = mineArm;
    hear("");
    setArming(true);
    /* Cleared the moment the recorder starts, and by every way out below. If
       it fires, this attempt is over: the flag is what stops a microphone
       that arrives late from opening into a card nobody is recording on. */
    const ceiling = setTimeout(() => {
      if (arm.current !== mineArm || mineArm.off) return;
      mineArm.off = true;
      setArming(false);
      void micStuck().then((why) => cbs.current.onError?.(why));
    }, ARMING_CEILING_MS);
    void (async () => {
      /* Declared out here so the failure path below can let go of a tap that
         opened moments before something else in this block threw. */
      let tapping: Promise<MicTap | null> | null = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        /* STOOD DOWN WHILE THE MIC WAS OPENING. Nothing has been recorded and
           nothing has chimed yet, so this is not a discard — the tracks close
           and the card goes back to the box it came from. This is the only
           check the arming window needs: `getUserMedia` is the one await in
           it, and everything after it runs in a single go. */
        if (mineArm.off) {
          clearTimeout(ceiling);
          stream.getTracks().forEach((t) => t.stop());
          /* Only if nothing else has taken over since — a second press is
             arming its own microphone and this one must not switch its light
             off on the way out. */
          if (arm.current === mineArm) setArming(false);
          return;
        }
        /* THE TAP OPENS FIRST, in parallel with everything below it. Not
           tidiness: the beep is a promise that the app is listening, and the
           live transport used to start listening a second or more after it
           sounded. Started here, the worklet is up while the chime is still
           playing, and the socket — which arrives much later — is handed
           every word said in the meantime. It swallows its own failure
           because a browser with no audio pipeline is a batch recording,
           not an error anybody needs to hear about. */
        tapping = tapFor(stream);
        /* Only once the microphone is genuinely open — chiming before the
           prompt is answered would announce a recording that may never
           start. `{ audio: true }` turns on echo cancellation by default,
           which is what keeps this note out of the clip that follows. */
        playChime("start");
        const rec = new MediaRecorder(stream);
        /* This run's own answer to "was it binned?", read by nothing but the
           `onstop` below. See the note on `run`. */
        const mine = { discard: false };
        run.current = mine;
        capped.current = false;
        loudFrames.current = 0;
        meterRan.current = false;
        quietFired.current = false;
        hear("");
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

          if (mine.discard) {
            handle?.cancel();
            stream.getTracks().forEach((t) => t.stop());
            hear("");
            clearRun();
            /* AND ONLY NOW, if this was a restart. Everything above had to
               happen first: the meter, the tracks and `recording` are shared
               refs, so a new run opened from the button instead of from here
               would have the old run's cleanup switch it back off. */
            if (restarting.current) {
              restarting.current = false;
              start();
            }
            return;
          }

          setTranscribing(true);
          await withCleanup(async () => {
            /* The live transcript first, because it is already finished.
               `stop()` only flushes the last utterance — it does not wait
               for the whole recording to be processed, which is the entire
               difference between this path and the one below it. */
            if (handle) {
              const text = (await handle.stop()).trim();
              /* Same check the upload does, and it has to be HERE rather than
                 at the top of this block: the walking away happens while the
                 socket is flushing its last utterance, which is exactly the
                 line above. */
              if (mine.discard) return void clearRun();
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
            await upload(blob, mine);
          }, () => {
            /* The tracks are held until here so the live path can flush the
               last sentence off a stream that is still open. */
            stream.getTracks().forEach((t) => t.stop());
            setTranscribing(false);
            hear("");
          });
        };
        recorder.current = rec;
        rec.start();
        clearTimeout(ceiling);
        setSeconds(0);
        setArming(false);
        setRecording(true);
        if (tapping) void goLive(tapping, rec);
      } catch {
        clearTimeout(ceiling);
        void tapping?.then((tap) => tap?.close());
        setArming(false);
        // graceful floor: whatever asked for this stays usable by typing
        cbs.current.onError?.("No microphone available — type it instead.");
      }
    })();
  };

  /* PRESSED BEFORE THE MIC OPENED. All four ways out below share this: there
     is no recorder yet, so there is nothing to stop, keep or bin — the only
     honest thing to do is not open it. It is silent, because a chime reports
     what happened to a recording and there was never one.

     Returns whether it handled the press, so each way out can carry on with
     its own ending when it did not. */
  const standDown = () => {
    if (!arming || recorder.current?.state === "recording") return false;
    /* `off` is also what retires the ceiling — it checks the flag before it
       says anything, so a mic you stood down from never gets complained
       about four seconds later. */
    if (arm.current) arm.current.off = true;
    setArming(false);
    return true;
  };

  const stop = () => {
    if (standDown()) return;
    if (recorder.current?.state !== "recording") return;
    playChime("stop");
    recorder.current.stop();
  };

  /* FINISH IT BY TYPING, and the two cases are not the same thing.

     SAID SOMETHING → stop exactly as `stop` does, and the words reach the
     caller's box the same way. Pressing Type mid-sentence must never file
     half a note and must never throw away what you already said, so the
     wait for the transcript is the honest price of keeping it.

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
    if (standDown()) return;
    const rec = recorder.current;
    if (rec?.state !== "recording") return;
    /* Discard ONLY where we are confident: the meter ran, it never rose
       above room noise, and the live socket produced no words either. Any
       uncertainty keeps the recording. */
    if (meterRan.current && loudFrames.current < 3 && interim === "") {
      if (run.current) run.current.discard = true;
      rec.stop();
      return;
    }
    playChime("stop");
    rec.stop();
  };

  const cancel = () => {
    if (standDown()) return;
    /* WALKING AWAY DURING THE READ-BACK IS STILL WALKING AWAY, and this used
       to return here and do nothing — the recorder had already stopped, so
       there was nothing left to cancel. The transcription was still in the
       air, though, and when it landed it went to `onTranscript` exactly as if
       somebody were waiting for it.

       That is the bug Isaac hit on 2026-08-17: close the card while it is
       reading back, open it again later, and the words from the LAST note are
       sitting in the box — or worse, they arrive mid-sentence while you are
       recording a new one, because the flow appends them to whatever is
       there. Marking the run discarded is enough: both delivery points check
       it, the fetch is allowed to finish and its answer goes in the bin.

       No chime. The recording already ended with one; this is not a second
       ending, it is the person leaving. */
    if (recorder.current?.state !== "recording") {
      if (run.current) run.current.discard = true;
      return;
    }
    /* Its own note. Stopping and discarding are both endings, and if they
       sounded alike you could not tell by ear whether the note was kept. */
    playChime("discard");
    if (run.current) run.current.discard = true;
    recorder.current.stop();
  };

  /* START THAT ONE AGAIN — one press, because the alternative is close the
     card, lose the tag, open it again and press the mic.

     IT THROWS THE AUDIO AWAY, deliberately and without asking. Everything
     said so far is binned unheard: nothing is uploaded, nothing is
     transcribed, nothing reaches the box. That is the whole point of the
     button — you fluffed it and want a clean run — and a confirm step would
     make the fast path slower than starting over by hand.

     TWO CHIMES, IN ORDER, and they are the confirmation. The discard note
     first (low, unresolved: nothing was kept), then the start note when the
     new mic is genuinely open. From a roof with the phone in your pocket
     that pair is the only way to know it both let go and came back. */
  const restart = () => {
    /* Nothing to start again — the run you would be redoing has not begun.
       Standing down and reopening would be the same mic, one flicker later. */
    if (arming && recorder.current?.state !== "recording") return;
    const rec = recorder.current;
    if (rec?.state !== "recording") return;
    playChime("discard");
    restarting.current = true;
    if (run.current) run.current.discard = true;
    rec.stop();
  };

  return {
    recording,
    arming,
    transcribing,
    seconds,
    interim,
    barsRef,
    bindQuiet: (el: HTMLElement | null) => {
      quietRef.current = el;
    },
    keepListening: () => {
      lastLoud.current = performance.now();
      quietFired.current = false;
    },
    start,
    stop,
    handOver,
    cancel,
    restart,
  };
}

/* THE PHONE'S WORD MOTIONS, TO THE MILLISECOND (heytiff-mobile
   src/components/LiveWords.tsx). Isaac, 9 November 2026: "make sure that the
   words show the same way. The mobile does. How quickly they render and the
   way that they change words to self-heal... I want the boxes to pretty much
   be identical". The web used to hold each word of a burst back up to a fifth
   of a second and blur it in, and swapped a fixed word with no sign; now a
   word shows the moment it's heard, as on the phone. */
/** The words around a fixed one slide over to make room, even onto the next line. */
const GLIDE_MS = 240;
/** A word that went fades out where it stood, lifting a little. */
const GONE_MS = 200;
/** The right word fades up into its place, a beat after the wrong one starts to go. */
const FIX_MS = 280;
const FIX_DELAY_MS = 50;
/** A new word at the end just fades in. */
const ADD_MS = 200;
/** A fixed word arrives in ink and settles to the grey of the words still being heard. */
const SETTLE_MS = 1200;

/** The live transcript, one word at a time — bind to a dictation's `interim`,
    with `said` holding whatever is already captured (an earlier leg, or
    typed words) so the two read as one sentence.

    THE ENGINE DOES NOT SPEAK EVENLY. Scribe sends partials in bursts and
    REVISES them: three words land at once, then a pause, then "grills"
    becomes "grilles". Words keyed by WHO THEY ARE (lib/voice/morph-words,
    the phone's morphWords) is what makes that read as one voice: each new
    guess is matched against the last, a word that stayed keeps its span and
    slides to wherever it now stands, a word that went fades where it stood,
    and a word the model fixed rises into its place in ink and settles to
    grey, so the eye catches what changed (Isaac, 5 November 2026: "instead
    of like a jumpy change, it's like morphing into the correct word").

    The words as heard are grey and leaning, as the phone draws them; `said`
    is the record, ink and upright, and never animates. It is NOT split into
    words: splitting it would put hundreds of spans in front of the handful
    that matter.

    FREE WORDS ARE NOT A WINDOW. In Tiff's window your words stand free in
    the conversation: the box is as tall as what you have said, and the
    conversation around it is what scrolls. So it neither rides nor fades. */
export function LiveWords({
  said = "",
  text,
  free = false,
  rows,
  className,
  label = "What you have said so far",
}: {
  said?: string;
  text: string;
  /** Free on the page, not a window (above): no ride, no fade. */
  free?: boolean;
  /** What the textarea this stands in for was sized to. */
  rows?: number;
  /** The box it is standing in: same width, font, padding and border as the
      box that was there a frame earlier. */
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  /* Whether anything has scrolled out of sight above: the top of the box is
     faded only then, measured after layout. */
  const [scrolled, setScrolled] = useState(false);
  /** Where each word stood last time round, by name, and what it said: what
      a word slides from, and where a word that went fades out. */
  const stood = useRef<Map<string, { x: number; y: number; w: string }>>(new Map());
  /* the words as they're shown, each named against the guess before */
  const [river, setRiver] = useState<{ text: string; words: Said[]; next: number }>({ text: "", words: [], next: 0 });
  if (river.text !== text) setRiver({ text, ...morphWords(river.words, text, river.next) });
  /* A PERSON ON THE WORKSPACE, SAID: in blue as you say it, as the phone's
     (Isaac, 11 November 2026): what you'd typed and the words as heard. */
  const people = usePeople();
  const saidRuns = nameRuns(said.trim(), people);
  const riverNamed = namedWords(
    river.words.map((s) => s.w),
    people,
  );

  /* A LAYOUT EFFECT: the motions start, and the box rides to the newest
     word, before the frame is painted, so no word is ever seen in its new
     place before it begins to slide. `offsetLeft` and `offsetTop` ignore the
     transforms running on a word, so where a word stands is read true even
     mid-slide. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const was = stood.current;
    const now = new Map<string, { x: number; y: number; w: string }>();
    const fixes = new Set(river.words.filter((s) => s.fix).map((s) => String(s.id)));
    const ink = getComputedStyle(el).getPropertyValue("--ink").trim() || "#050505";

    for (const span of el.querySelectorAll<HTMLElement>(".wb2-lw:not(.gone)")) {
      const name = span.dataset.w ?? "";
      const at = { x: span.offsetLeft, y: span.offsetTop, w: span.textContent ?? "" };
      now.set(name, at);
      if (still || typeof span.animate !== "function") continue;
      const from = was.get(name);
      if (from) {
        const dx = from.x - at.x;
        const dy = from.y - at.y;
        if (dx || dy) span.animate({ transform: [`translate(${dx}px, ${dy}px)`, "none"] }, { duration: GLIDE_MS, easing: "ease-out" });
      } else if (fixes.has(name)) {
        span.animate(
          { opacity: [0, 1], transform: ["translateY(5px) scale(0.97)", "none"] },
          { duration: FIX_MS, delay: FIX_DELAY_MS, easing: "ease-out", fill: "backwards" },
        );
        const grey = getComputedStyle(span).color;
        /* a name is blue from the moment it's heard, as the phone's: no ink first */
        if (!span.classList.contains("cv-named")) span.animate({ color: [ink, ink, grey], offset: [0, 0.3, 1] }, { duration: SETTLE_MS, easing: "ease-out" });
      } else {
        span.animate({ opacity: [0, 1], transform: ["translateY(3px)", "none"] }, { duration: ADD_MS, easing: "ease-out", fill: "backwards" });
      }
    }
    /* a word that went fades out where it stood: a stand-in, laid over the
       place it had, since its own span has already left */
    if (!still) {
      for (const [name, at] of was) {
        if (now.has(name)) continue;
        const gone = document.createElement("span");
        gone.className = "wb2-lw gone";
        gone.setAttribute("aria-hidden", "true");
        gone.textContent = at.w;
        gone.style.left = `${at.x}px`;
        gone.style.top = `${at.y}px`;
        el.appendChild(gone);
        if (typeof gone.animate !== "function") {
          gone.remove();
          continue;
        }
        gone.animate({ opacity: [1, 0], transform: ["none", "translateY(-4px) scale(0.97)"] }, { duration: GONE_MS, easing: "ease-in", fill: "forwards" }).onfinish = () => gone.remove();
      }
    }
    stood.current = now;

    /* Ride the newest word down the box. */
    if (free) return;
    el.scrollTop = el.scrollHeight;
    setScrolled(el.scrollHeight > el.clientHeight + 1);
  }, [said, river, free]);

  /* AND MEASURED AGAIN WHEN THE BOX HAS FINISHED OPENING: a window that eases
     open is shorter than its words for a moment, and would read as scrolled.
     Only the box's own animation counts, not the words'. */
  useEffect(() => {
    const el = ref.current;
    if (!el || free) return;
    const settle = (e: Event) => {
      if (e.target !== el) return;
      setScrolled(el.scrollHeight > el.clientHeight + 1);
    };
    el.addEventListener("animationend", settle);
    el.addEventListener("transitionend", settle);
    return () => {
      el.removeEventListener("animationend", settle);
      el.removeEventListener("transitionend", settle);
    };
  }, [free]);

  return (
    <p
      className={
        (className ? `${className} ` : "") +
        "wb2-lwbox" +
        (free ? " free" : scrolled ? " over" : "")
      }
      style={rows ? ({ "--lwrows": rows } as React.CSSProperties) : undefined}
      ref={ref}
      /* `log` is the role a running transcript has, and it carries the
         polite live region on its own. */
      role="log"
      aria-live="polite"
      aria-label={label}
    >
      {/* THE SPACES ARE REAL, not a margin between the spans: `textContent`
          concatenates, so a margin gives a screen reader and anything copied
          out of here "theatthreehundred". */}
      {said.trim() && (
        <>
          <span className="wb2-lwsaid">
            {saidRuns.map((r, i) =>
              r.name ? (
                <span key={i} className="cv-named">
                  {r.text}
                </span>
              ) : (
                <Fragment key={i}>{r.text}</Fragment>
              ),
            )}
          </span>{" "}
        </>
      )}
      {river.words.map((word, i) => (
        <Fragment key={word.id}>
          <span className={riverNamed[i] ? "wb2-lw cv-named" : "wb2-lw"} data-w={word.id}>
            {word.w}
          </span>{" "}
        </Fragment>
      ))}
    </p>
  );
}

/** Dictation APPENDS to what's already typed. One function because the live
    transport needs the same join to preview the sentence in the box as the
    committed transcript needs to land it — if they drifted apart, the words
    would visibly jump when you stopped talking. */
export const appendSpoken = (typed: string, spoken: string): string =>
  typed.trim() ? `${typed.trim()} ${spoken}` : spoken;

