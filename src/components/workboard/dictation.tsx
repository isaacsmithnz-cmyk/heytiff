"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { startRealtime, type RealtimeHandle } from "@/lib/voice/realtime-stream";

/* Dictation, extracted from the note pill so every box you'd type a paragraph
   into can have it (Isaac, 2026-08-02: "anywhere that you need to enter notes
   or anything that would involve a reasonable amount of typing should have a
   voice-to-text option"). The pill owned this engine and was the only thing
   in the app that could hear you, which is backwards — the pill's job is
   ROUTING a note into tasks and flags, and dictation is just how you get
   words in. They're separate concerns and now they're separate code.

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
  /** Throw the recording away — nothing is transcribed, nothing is sent. */
  cancel: () => void;
};

export function useDictation({
  onTranscript,
  onError,
}: {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
}): DictationState {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const barsRef = useRef<HTMLSpanElement | null>(null);
  const meter = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const live = useRef<RealtimeHandle | null>(null);

  /* The callbacks live in a ref so the recorder's own handlers always see the
     current ones without the effect below re-running and dropping the mic. */
  const cbs = useRef({ onTranscript, onError });
  cbs.current = { onTranscript, onError };

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

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
        // straight to the DOM, never through React — this runs every frame
        barsRef.current?.style.setProperty("--lvl", level.toFixed(3));
        if (meter.current) meter.current.raf = requestAnimationFrame(tick);
      };

      meter.current = { ctx, raf: requestAnimationFrame(tick) };
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
      if (!res.ok || !body.text) {
        cbs.current.onError?.(body.error ?? "That recording couldn't be read. Type it instead.");
        return;
      }
      cbs.current.onTranscript(body.text);
    } catch {
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
        const rec = new MediaRecorder(stream);
        discard.current = false;
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

          if (discard.current) {
            handle?.cancel();
            stream.getTracks().forEach((t) => t.stop());
            setInterim("");
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
              if (text) {
                cbs.current.onTranscript(text);
                return;
              }
              /* Socket produced nothing. The clip is still in `chunks`. */
            }

            const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
            if (blob.size === 0) return;
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
        if (REALTIME) void goLive(stream);
      } catch {
        // graceful floor: whatever asked for this stays usable by typing
        cbs.current.onError?.("No microphone available — type it instead.");
      }
    })();
  };

  const stop = () => recorder.current?.stop();

  const cancel = () => {
    if (recorder.current?.state !== "recording") return;
    discard.current = true;
    recorder.current.stop();
  };

  return { recording, transcribing, seconds, interim, barsRef, start, stop, cancel };
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

export const clockOf = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Dictation APPENDS to what's already typed. One function because the live
    transport needs the same join to preview the sentence in the box as the
    committed transcript needs to land it — if they drifted apart, the words
    would visibly jump when you stopped talking. */
export const appendSpoken = (typed: string, spoken: string): string =>
  typed.trim() ? `${typed.trim()} ${spoken}` : spoken;

/* ── the field ──
   A textarea with a mic in its corner. Dictation APPENDS rather than
   replaces: you say a bit, type a correction, say the rest — replacing would
   make the second press silently eat the first.

   On the live transport the words show up in the field as they're said,
   which is the whole reason it exists — but they are NOT committed to
   `value` until you stop, because a partial transcript is revisable and the
   caller's state should only ever hold text the model has finished with. */

export function DictateBox({
  value,
  onChange,
  voiceEnabled,
  placeholder,
  rows = 3,
  disabled = false,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** ELEVENLABS_API_KEY is set on this deployment — no key, no mic offered. */
  voiceEnabled: boolean;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** What the mic's accessible name says it's dictating INTO. */
  label: string;
  className?: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const dict = useDictation({
    onTranscript: (text) => {
      setErr(null);
      onChange(appendSpoken(value, text));
    },
    onError: setErr,
  });

  return (
    <div className={"wb2-dict" + (className ? ` ${className}` : "")}>
      <textarea
        className="wb2-notes"
        rows={rows}
        placeholder={dict.recording ? "Listening…" : placeholder}
        value={dict.interim ? appendSpoken(value, dict.interim) : value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || dict.recording || dict.transcribing}
      />
      {voiceEnabled && (
        <div className="wb2-dictbar">
          {dict.recording ? (
            <>
              <button
                type="button"
                className="wb2-dictmic on"
                onClick={dict.stop}
                title="Stop and read it back"
                aria-label={`Stop dictating — ${label}`}
              >
                <Icon name="square" size={13} />
              </button>
              <LevelBars innerRef={dict.barsRef} />
              <span className="wb2-capclock">{clockOf(dict.seconds)}</span>
              <button
                type="button"
                className="wb2-dictx"
                onClick={dict.cancel}
                title="Throw it away"
                aria-label={`Discard the recording — ${label}`}
              >
                <Icon name="x" size={12} />
              </button>
            </>
          ) : dict.transcribing ? (
            <span className="wb2-dicthint">Reading it back…</span>
          ) : (
            <button
              type="button"
              className="wb2-dictmic"
              onClick={dict.start}
              disabled={disabled}
              title="Say it instead"
              aria-label={`Dictate — ${label}`}
            >
              <Icon name="mic" size={13} />
              Say it
            </button>
          )}
        </div>
      )}
      {err && <p className="wb2-dicterr">{err}</p>}
    </div>
  );
}

/* ── the one-liner ──
   Same engine, same mic, one line instead of a paragraph — for lists you add
   to an item at a time rather than boxes you write prose into. Enter commits,
   and dictation lands in the field rather than committing itself — you get to
   read what it heard before it becomes a bullet.

   The mic rides ON THE ROW (Isaac, 2026-08-04: "put the microphone onto the
   same line as the text"). Under the field it read as a second control for a
   second purpose; beside it, saying a note and typing one are plainly the two
   ways to fill the same box. Recording takes the row over — stop, live level,
   clock, discard — because while it's listening there is nothing to add. */

export function DictateLine({
  value,
  onChange,
  onCommit,
  voiceEnabled,
  placeholder,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter, or the tick. Called with the trimmed line; never with "". */
  onCommit: () => void;
  voiceEnabled: boolean;
  placeholder?: string;
  disabled?: boolean;
  label: string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const dict = useDictation({
    onTranscript: (text) => {
      setErr(null);
      onChange(appendSpoken(value, text));
    },
    onError: setErr,
  });

  return (
    <div className="wb2-dictline">
      <div className="wb2-addrow">
        <input
          className="wb2-fi"
          placeholder={dict.recording ? "Listening…" : placeholder}
          value={dict.interim ? appendSpoken(value, dict.interim) : value}
          disabled={disabled || dict.recording || dict.transcribing}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            onCommit();
          }}
        />
        {voiceEnabled && dict.recording ? (
          <>
            <LevelBars innerRef={dict.barsRef} />
            <span className="wb2-capclock">{clockOf(dict.seconds)}</span>
            <button
              type="button"
              className="wb2-micgo on"
              onClick={dict.stop}
              title="Stop and read it back"
              aria-label={`Stop dictating — ${label}`}
            >
              <Icon name="square" size={12} />
            </button>
            <button
              type="button"
              className="wb2-dictx"
              onClick={dict.cancel}
              title="Throw it away"
              aria-label={`Discard the recording — ${label}`}
            >
              <Icon name="x" size={12} />
            </button>
          </>
        ) : (
          <>
            {voiceEnabled && (
              <button
                type="button"
                className="wb2-micgo"
                onClick={dict.start}
                disabled={disabled || dict.transcribing}
                title="Say it instead"
                aria-label={`Dictate — ${label}`}
              >
                <Icon name="mic" size={14} />
              </button>
            )}
            <button
              type="button"
              className="wb2-addgo"
              disabled={disabled || dict.transcribing || value.trim() === ""}
              title="Add it"
              aria-label={`Add — ${label}`}
              onClick={onCommit}
            >
              <Icon name="plus" size={14} />
            </button>
          </>
        )}
      </div>
      {dict.transcribing && <p className="wb2-dicthint">Reading it back…</p>}
      {err && <p className="wb2-dicterr">{err}</p>}
    </div>
  );
}
