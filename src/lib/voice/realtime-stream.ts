/* Speech to text, live — the runtime half. BROWSER ONLY.

   Everything here has a `window` in it: a microphone stream becomes 16-bit
   PCM, the PCM goes up a WebSocket, and words come back while the person is
   still talking. The protocol itself — what the messages mean, how a
   transcript accumulates — is in `realtime.ts` and is pure, so this file is
   only the plumbing.

   THE AUDIO IS NEVER RESAMPLED. The vendor accepts six sample rates and a
   browser's AudioContext runs at one of them (48k almost always, 44.1k on
   some hardware), so we ask for 16k to save a tradie's mobile data, take
   whatever we're actually given, and name that rate in the query string.
   A rate outside the six is not an error to recover from — it means this
   transport can't carry the audio, and the caller still has the recording.

   THAT LAST POINT IS THE WHOLE SAFETY MODEL. This module can fail at six
   different places — token, handshake, worklet, socket close, vendor error,
   empty transcript — and the answer to every one of them is the same: the
   MediaRecorder in `dictation.tsx` never stopped running, so the batch path
   uploads the clip and the person never learns any of this happened.

   THE MIC IS TAPPED BEFORE THE SOCKET EXISTS, and that is the point of the
   split between `openMicTap` and `startRealtime`. Isaac, 2026-08-10: "when I
   record my voice anywhere, it always misses the first part even after it has
   given me the audio beep." It did, and the beep was telling the truth — the
   MediaRecorder really was running, and the clip really did contain every
   word. What was late was THIS transport: a token round trip to our own
   server, then a handshake to the vendor, then a worklet compile, and only
   then did the first sample go up the wire. A second or so of speech was
   never sent, the socket transcribed what was left, and since a live
   transcript wins over the recording (`dictation.tsx`, `onstop`) the complete
   clip was thrown away in favour of the truncated words.

   So the tap opens the moment the microphone does and BUFFERS. Whatever was
   said while the socket was being built goes up as the first chunks, in
   order, before anything heard live. The fix has to live here rather than in
   a caller: every mic in the app goes through this one path. */

import {
  EMPTY_TRANSCRIPT,
  REALTIME_FAILED,
  REALTIME_MODEL_ID,
  REALTIME_SOCKET,
  applyMessage,
  audioFormatFor,
  visibleText,
  type Transcript,
} from "./realtime";

/** Ask for 16 kHz — a quarter of the bytes of 48 kHz, and Scribe is a speech
    model, so the top of the spectrum buys nothing. Browsers are allowed to
    ignore this and we handle being ignored. */
const WANTED_RATE = 16_000;

/* ~100 ms of audio per message. This is a FLOOR ON PERCEIVED LAG, not a
   throughput knob: a word cannot appear on screen sooner than the buffer it
   is sitting in, so at the original 250 ms every word waited up to a quarter
   of a second before the network even saw it, on top of the vendor's ~150 ms.
   Isaac, 2026-08-05, with the live path finally on by default: "seems less
   accurate and lags compared to previous."

   100 ms costs ten small messages a second (~4 KB of base64 each at 16 kHz
   mono) instead of four, which is nothing next to feeling immediate. Much
   below this and the framing starts to outweigh the audio — a render quantum
   is 128 frames, 8 ms at 16 kHz. */
const CHUNK_MS = 100;

/** The hard cap on `stop()`. Past this we take what we have; the words are
    worth more than the tail, and a person waiting on a spinner is the thing
    this whole transport exists to stop. */
const FLUSH_TIMEOUT_MS = 2_500;

/** How long the socket has to stay quiet before `stop()` calls it finished.
    Comfortably over the vendor's ~150 ms, comfortably under a wait anyone
    would notice. */
const SETTLE_MS = 500;

const HANDSHAKE_TIMEOUT_MS = 6_000;

/* HOW MUCH SPEECH THE TAP WILL HOLD while the socket is being built, and what
   happens when it won't fit. A token fetch has no timeout of its own, so a
   wedged network could otherwise buffer a whole two-minute recording in
   memory on a phone.

   Past the cap the live path is ABANDONED rather than trimmed. Dropping the
   oldest audio would put the hole back exactly where this whole change came
   from; dropping the newest would put one in the middle. The batch upload
   still has every word, so the honest answer to "we missed the start" is to
   let the transport that didn't miss it do the job. Thirty seconds is far
   past any handshake that was ever going to succeed. */
const MAX_PREROLL_SECONDS = 30;

/* The worklet runs on the audio thread and does exactly one thing: hand each
   render quantum back to the main thread. It's a string because a worklet
   must be a separate module fetched by URL, and a blob URL avoids shipping a
   static asset that has to stay in sync with this file. `slice()` matters —
   the quantum's buffer is reused by the next callback. */
const WORKLET_SRC = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

/** Float samples in −1…1 to little-endian 16-bit PCM, base64 — the only
    shape `input_audio_chunk` accepts. */
export function encodePcm(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** An open microphone, listening before there is anywhere to send it. */
export type MicTap = {
  /** The rate the context actually gave us — the socket's `audio_format`
      comes from this, and the audio is never resampled. */
  rate: number;
  /** True once the buffer blew past the cap. The live path is off the table
      from that moment: there is now a hole at the start of what it would
      transcribe, and a truncated live transcript would still beat the
      complete recording. */
  overflowed: boolean;
  /** Hand over everything heard so far, oldest first, and keep handing over
      each quantum as it arrives. Called once, when the socket is up. */
  deliverTo: (sink: (samples: Float32Array) => void) => void;
  /** Release the microphone tap. Idempotent — both this module and its
      caller close on failure, so neither has to know who got there first. */
  close: () => void;
};

/** Start listening NOW, buffering until someone asks for the audio.
    Rejects where there is no audio pipeline at all, which the caller treats
    the same as every other live failure: stay on the recording. */
export async function openMicTap(stream: MediaStream): Promise<MicTap> {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("no audio pipeline");

  const ctx = new Ctor({ sampleRate: WANTED_RATE });
  const rate = ctx.sampleRate;
  if (!audioFormatFor(rate)) {
    void ctx.close().catch(() => {});
    throw new Error(`unsupported sample rate ${rate}`);
  }

  /* iOS hands back a SUSPENDED context whenever the constructor isn't
     reached inside the tap itself — and by here we're at least one await
     past it. A suspended context never runs the worklet, so no audio is ever
     sent and the whole thing fails as "the vendor returned nothing": the
     batch path picks it up and the live transport quietly never works on a
     phone. One line, one class of silent failure. */
  await ctx.resume().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const cap = rate * MAX_PREROLL_SECONDS;
  let held: Float32Array[] = [];
  let heldFrames = 0;
  let sink: ((samples: Float32Array) => void) | null = null;
  let closed = false;
  /* Replaced once the worklet (or its fallback) is wired up; until then
     there is nothing connected to let go of. */
  let disconnect = () => {};

  const tap: MicTap = {
    rate,
    overflowed: false,
    deliverTo: (next) => {
      const backlog = held;
      held = [];
      heldFrames = 0;
      sink = next;
      for (const part of backlog) next(part);
    },
    close: () => {
      if (closed) return;
      closed = true;
      sink = null;
      held = [];
      heldFrames = 0;
      disconnect();
      void ctx.close().catch(() => {});
    },
  };

  const take = (samples: Float32Array) => {
    if (closed) return;
    if (sink) {
      sink(samples);
      return;
    }
    if (tap.overflowed) return;
    held.push(samples);
    heldFrames += samples.length;
    if (heldFrames > cap) {
      tap.overflowed = true;
      held = [];
      heldFrames = 0;
    }
  };

  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    /* Given up on while the worklet was compiling. The context is already
       closed, so wiring anything to it now throws — and there is nothing
       left to listen for anyway. */
    if (closed) return tap;
    const node = new AudioWorkletNode(ctx, "pcm-tap");
    node.port.onmessage = (e: MessageEvent<Float32Array>) => take(e.data);
    source.connect(node);
    disconnect = () => {
      node.port.onmessage = null;
      node.disconnect();
      source.disconnect();
    };
  } catch {
    if (closed) return tap;
    /* No AudioWorklet — an older WebView, or a CSP that won't run a blob.
       ScriptProcessorNode is deprecated and still universally implemented,
       which on a phone in a roof cavity is the property that matters. It
       only runs while connected to a destination, hence the muted gain. */
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    proc.onaudioprocess = (e) => take(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    disconnect = () => {
      proc.onaudioprocess = null;
      proc.disconnect();
      mute.disconnect();
      source.disconnect();
    };
  }

  return tap;
}

export type RealtimeHandle = {
  /** Flush, wait briefly for the last words, tear down. Resolves with the
      full transcript — "" means it produced nothing and the caller should
      fall back to uploading the recording. */
  stop: () => Promise<string>;
  /** Throw it away. Nothing resolves, nothing is kept. */
  cancel: () => void;
};

export type RealtimeOptions = {
  /** An already-listening mic from `openMicTap`. OWNERSHIP PASSES HERE: from
      this call on, every exit — a throw, `stop()`, `cancel()`, a dropped
      socket — closes the tap. */
  tap: MicTap;
  token: string;
  keyterms: readonly string[];
  /** Called on every partial and every commit with the text so far, so the
      box can show words appearing as they're said. */
  onText: (text: string) => void;
};

function socketUrl(token: string, format: string, keyterms: readonly string[]): string {
  const url = new URL(REALTIME_SOCKET);
  url.searchParams.set("model_id", REALTIME_MODEL_ID);
  url.searchParams.set("audio_format", format);
  /* `vad` rather than `manual`: the vendor spots the gaps between sentences
     and commits there, which is what makes text land WHILE someone talks
     instead of all at once when they stop. `stop()` still commits manually
     to flush whatever the last gap didn't. */
  url.searchParams.set("commit_strategy", "vad");
  url.searchParams.set("token", token);
  /* NO `no_verbatim`. It was set to "true" here on the theory that filler
     words are noise in a note that becomes a task — but the batch path has
     never sent it, so the two transports were returning DIFFERENT PROSE for
     the same sentence, and switching the default transport switched what
     your notes read like. "Removes filler words, false starts and
     disfluencies" is a rewrite of what you said, and on a site note the
     difference between a false start and a correction is a judgement this
     shouldn't be making silently. Both transports now return what was said;
     if fillers are ever worth stripping, it should be a decision made once,
     for both, and visibly. */
  /* Repeated params, `keyterms=a&keyterms=b`. The docs say "array of
     strings" and show no example, and this is the second time this vendor's
     array encoding has been guesswork — on the batch endpoint a
     JSON-stringified array was parsed as ONE 50-character keyword and the
     whole request 400'd. `session_started` echoes the parsed config back, so
     the handshake log below reports how many terms actually landed rather
     than how many were sent. */
  for (const term of keyterms) url.searchParams.append("keyterms", term);
  return url.toString();
}

/** Open the socket, start streaming the mic into it, and report words back
    as they arrive. Rejects if the live path can't be established at all —
    the caller treats that as "stay on batch" and carries on recording. */
export async function startRealtime({
  tap,
  token,
  keyterms,
  onText,
}: RealtimeOptions): Promise<RealtimeHandle> {
  const rate = tap.rate;
  const format = audioFormatFor(rate);
  if (typeof WebSocket === "undefined" || !format) {
    tap.close();
    throw new Error(format ? "no socket" : `unsupported sample rate ${rate}`);
  }
  if (tap.overflowed) {
    tap.close();
    throw new Error("pre-roll overflowed before the socket opened");
  }

  const ws = new WebSocket(socketUrl(token, format, keyterms));

  let transcript: Transcript = EMPTY_TRANSCRIPT;
  let dead = false;

  /* WAITING FOR THE LAST SENTENCE, and why it's a debounce rather than
     "resolve on the next commit". The protocol has no acknowledgement: when
     the commit flag goes up there is no way to tell OUR flush's transcript
     from a vad commit that was already in flight when the button was
     pressed. Resolving on the first thing that arrives therefore truncates
     the note exactly when someone stops mid-sentence — the common case.

     So `stop()` waits for the socket to go QUIET instead: every message
     restarts a short settle timer, and a hard cap keeps a chatty or wedged
     socket from holding the note hostage. */
  let flush: (() => void) | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (settleTimer) clearTimeout(settleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    settleTimer = null;
    hardTimer = null;
  };

  const settle = () => {
    if (!flush) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => flush?.(), SETTLE_MS);
  };

  const teardown = () => {
    if (dead) return;
    dead = true;
    clearTimers();
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    } catch {
      /* already gone */
    }
    tap.close();
  };

  /* WHAT THE SERVER THINKS WE ASKED FOR. `session_started` echoes the parsed
     config, which is the only way to find out whether the keyterms in the
     query string became a list or a single mangled string — the docs show no
     example and this vendor's array encoding has already been wrong once.
     Sent vs landed, once per session, so a wrong guess is visible instead of
     quietly costing accuracy on exactly the words that matter most. */
  const reportHandshake = (m: Record<string, unknown>) => {
    const cfg = (m.config ?? {}) as Record<string, unknown>;
    const landed = Array.isArray(cfg.keyterms) ? cfg.keyterms.length : "NOT PARSED";
    console.info(
      `[realtime] session up · ${String(cfg.model_id ?? "?")} · ${rate}Hz · ` +
        `keyterms sent ${keyterms.length}, landed ${landed}`
    );
  };

  ws.onmessage = (event) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).message_type === "session_started"
    ) {
      reportHandshake(parsed as Record<string, unknown>);
    }
    const applied = applyMessage(transcript, parsed);
    if (applied.kind === "error") {
      // the vendor's words go here and nowhere near the person
      console.error(`[realtime] ${applied.detail}`);
      /* A live error is not a lost note: resolve a pending flush with what
         we already heard, and let the caller fall back if that's nothing. */
      flush?.();
      teardown();
      return;
    }
    if (applied.kind !== "transcript") return;
    transcript = applied.next;
    onText(visibleText(transcript));
    settle();
  };

  ws.onerror = () => {
    console.error(`[realtime] ${REALTIME_FAILED}`);
  };

  ws.onclose = () => {
    flush?.();
    teardown();
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("handshake timeout")), HANDSHAKE_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("closed before open"));
    });
  }).catch((err) => {
    teardown();
    throw err;
  });

  /* ── mic → socket ── */

  const chunkFrames = Math.max(1, Math.round((rate * CHUNK_MS) / 1000));
  let feeding = true;
  let pending: Float32Array[] = [];
  let pendingFrames = 0;

  const send = (commit: boolean) => {
    if (dead || ws.readyState !== WebSocket.OPEN) return;
    if (pendingFrames === 0 && !commit) return;

    const merged = new Float32Array(pendingFrames);
    let at = 0;
    for (const part of pending) {
      merged.set(part, at);
      at += part.length;
    }
    pending = [];
    pendingFrames = 0;

    try {
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: encodePcm(merged),
          sample_rate: rate,
          commit,
        })
      );
    } catch {
      /* the close handler owns the failure */
    }
  };

  const take = (samples: Float32Array) => {
    if (!feeding) return;
    pending.push(samples);
    pendingFrames += samples.length;
    if (pendingFrames >= chunkFrames) send(false);
  };

  /* THE BACKLOG GOES FIRST. `deliverTo` replays everything said between the
     beep and this line — the token round trip, the handshake, the worklet —
     before a single sample heard from here on. It arrives in ~100 ms chunks
     like everything else, so the vendor sees one continuous recording and
     the first sentence is simply there. */
  tap.deliverTo(take);

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        feeding = false;
        if (dead || ws.readyState !== WebSocket.OPEN) {
          resolve(visibleText(transcript));
          teardown();
          return;
        }
        flush = () => {
          if (!flush) return;
          flush = null;
          clearTimers();
          resolve(visibleText(transcript));
          teardown();
        };
        send(true);
        /* Both timers start now: settle for "it went quiet", hard for "it
           never will". Whichever fires first, the person gets their words. */
        settle();
        hardTimer = setTimeout(() => flush?.(), FLUSH_TIMEOUT_MS);
      }),

    cancel: () => {
      feeding = false;
      flush = null;
      clearTimers();
      teardown();
    },
  };
}
