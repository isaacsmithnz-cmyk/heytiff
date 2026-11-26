/* Tiff's voice on the screen. BROWSER ONLY.

   ONE VOICE AT A TIME, for the whole page: a Read out pressed while another
   answer is being read stops that one, and the Talk screen stops whatever was
   reading when it opens. So the state lives here, once, and every door asks
   it whether it is the one being read (`useReadingOut`).

   READ IN PIECES. An answer is said a sentence or a few at a time: the first
   piece is asked for the moment there is one, the next while the first is
   playing. That is what makes her start speaking in under a second rather
   than after the whole answer has been made into sound, and it is the same
   reader whether the answer is all there (Read out) or still arriving (an
   answer to a question asked out loud, and every turn of a talk), because
   `feed` takes it a delta at a time.

   HER VOICE OR THE DEVICE'S. The route (api/tiff/speak) answers 503
   `{ fallback, say }` until ElevenLabs can speak for this deployment; from
   then on, for this page, the pieces are said by the browser's own voice
   (Australian English where it has one) without asking the route again for
   a few minutes. A quiet Tiff is a bug; a Tiff in the device's voice is a
   lesser voice.

   SOUND NEEDS A PRESS FIRST on an iPad: audio started outside a tap is
   refused, which would make "asked out loud, answered out loud" silent on
   exactly the device Isaac uses. `unlockSpeech` is called in the tap that
   opens the mic, Talk or Read out, and plays nothing on the one audio
   element every piece then reuses. */

import { useSyncExternalStore } from "react";
import { capSaid, lineCleaner, REST_WORDS, sentencesOf, SPEAK_MAX_CHARS } from "./speak-words";

const ROUTE = "/api/tiff/speak";
/** Once the route says it can't speak in her voice, how long the device's
    voice is used before asking again. */
const DEVICE_FOR_MS = 5 * 60_000;
/** The first piece goes as soon as it has this much; the rest are grouped
    up to the second. Small first, so the first sound is quick. */
const FIRST_PIECE = 40;
const PIECE = 360;

/* ── who is being read ── */

let reading: string | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const readingNow = () => reading;
const nobody = () => null;

/** The id being read out now, or null. */
export function useReadingOut(): string | null {
  return useSyncExternalStore(subscribe, readingNow, nobody);
}

/* ── the one audio element, unlocked in a tap ── */

let audio: HTMLAudioElement | null = null;
/* A hundredth of a second of silence, as a WAV: what a tap plays to earn the
   right to play her later. */
const SILENCE =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function theAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  audio ??= new Audio();
  return audio;
}

/** Call inside a tap. Lets her speak later without one. */
export function unlockSpeech(): void {
  const el = theAudio();
  if (el && !el.dataset.unlocked) {
    el.dataset.unlocked = "1";
    try {
      el.src = SILENCE;
      void Promise.resolve(el.play()).catch(() => {});
    } catch {
      /* no media here: she'll need a press to speak */
    }
  }
  try {
    const s = window.speechSynthesis;
    if (s && !s.speaking) s.speak(new SpeechSynthesisUtterance(""));
  } catch {
    /* no device voice */
  }
}

/* ── the device's voice ── */

let deviceUntil = 0;

function deviceVoice(): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis.getVoices();
    return (
      vs.find((v) => /en-AU/i.test(v.lang) && /karen|catherine|female/i.test(v.name)) ??
      vs.find((v) => /en-AU/i.test(v.lang)) ??
      vs.find((v) => /^en/i.test(v.lang)) ??
      null
    );
  } catch {
    return null;
  }
}

function sayOnDevice(words: string, stopped: () => boolean): Promise<void> {
  return new Promise((done) => {
    let s: SpeechSynthesis;
    try {
      s = window.speechSynthesis;
    } catch {
      return done();
    }
    if (!s || stopped()) return done();
    const u = new SpeechSynthesisUtterance(words);
    const v = deviceVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-AU";
    u.rate = 1.05;
    u.onend = () => done();
    u.onerror = () => done();
    s.speak(u);
  });
}

/* ── one piece in her voice ── */

type Sound = { kind: "audio"; url: string } | { kind: "device"; words: string } | { kind: "none" };

async function fetchSound(words: string, signal: AbortSignal): Promise<Sound> {
  if (Date.now() < deviceUntil) return { kind: "device", words };
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: words }),
      signal,
    });
    if (res.ok) return { kind: "audio", url: URL.createObjectURL(await res.blob()) };
    if (res.status === 503 || res.status === 502) {
      if (res.status === 503) deviceUntil = Date.now() + DEVICE_FOR_MS;
      const body = (await res.json().catch(() => null)) as { say?: unknown } | null;
      return { kind: "device", words: typeof body?.say === "string" && body.say ? body.say : words };
    }
    return { kind: "none" };
  } catch {
    return signal.aborted ? { kind: "none" } : { kind: "device", words };
  }
}

function play(sound: Sound, stopped: () => boolean): Promise<void> {
  if (sound.kind === "device") return sayOnDevice(sound.words, stopped);
  if (sound.kind === "none") return Promise.resolve();
  const el = theAudio();
  if (!el || stopped()) {
    URL.revokeObjectURL(sound.url);
    return Promise.resolve();
  }
  return new Promise((done) => {
    const end = () => {
      el.onended = null;
      el.onerror = null;
      el.onpause = null;
      URL.revokeObjectURL(sound.url);
      done();
    };
    el.onended = end;
    el.onerror = end;
    el.onpause = () => {
      if (stopped() || el.ended) end();
    };
    try {
      el.src = sound.url;
      Promise.resolve(el.play()).catch(end);
    } catch {
      end();
    }
  });
}

/* ── the reader ── */

export type Reader = {
  /** More of the answer, as it arrives. */
  feed: (delta: string) => void;
  /** That's all of it; `done` resolves once the last piece has been said. */
  finish: () => void;
  /** Resolves when she has said it all, or was stopped. */
  done: Promise<void>;
};

let stopCurrent: (() => void) | null = null;

/** Stop whatever is being read. */
export function stopSpeaking(): void {
  stopCurrent?.();
}

/** Read an answer out as `id`, in pieces, as it arrives. Stops anything
    else being read. */
export function startReading(id: string): Reader {
  stopCurrent?.();
  const ctl = new AbortController();
  let stopped = false;
  const isStopped = () => stopped;

  const clean = lineCleaner();
  let raw = "";
  let said = 0; // characters of `raw` already cleaned
  let ended = false;
  let total = 0;
  let capped = false;
  const sentences: string[] = [];
  let wake: (() => void) | null = null;
  const nudge = () => {
    const w = wake;
    wake = null;
    w?.();
  };

  const take = (text: string) => {
    if (capped) return;
    for (const s of sentencesOf(text)) {
      if (total + s.length > SPEAK_MAX_CHARS) {
        const room = SPEAK_MAX_CHARS - total;
        if (room > FIRST_PIECE) sentences.push(capSaid(s, room).replace(` ${REST_WORDS}`, ""));
        sentences.push(REST_WORDS);
        capped = true;
        return;
      }
      total += s.length + 1;
      sentences.push(s);
    }
  };

  /* Whole lines are cleaned as they complete; the line still arriving is
     read only up to its last full sentence, and never while it could be a
     table or a fence, whose meaning depends on the lines after it. */
  const cut = () => {
    const nl = raw.lastIndexOf("\n");
    if (nl >= said) {
      for (const line of raw.slice(said, nl + 1).split("\n")) {
        const s = clean(line);
        if (s) take(s);
      }
      said = nl + 1;
    }
    const tail = raw.slice(said);
    if (ended) {
      const s = clean(tail);
      if (s) take(s);
      said = raw.length;
      return;
    }
    const t = tail.trimStart();
    if (!t || t.startsWith("|") || t.startsWith("`") || t.startsWith("#")) return;
    const end = Math.max(t.lastIndexOf(". "), t.lastIndexOf("? "), t.lastIndexOf("! "));
    if (end < FIRST_PIECE / 2) return;
    /* a line read in two halves: only the whole sentences now, and the
       rest of the line when it ends */
    const whole = t.slice(0, end + 1);
    const s = clean(whole);
    if (s) take(s);
    said += tail.length - t.length + end + 1;
  };

  /** The next piece to say, or null when there is no more. */
  const nextPiece = async (first: boolean): Promise<string | null> => {
    for (;;) {
      if (stopped) return null;
      const want = first ? FIRST_PIECE : PIECE;
      let len = 0;
      let n = 0;
      while (n < sentences.length && (n === 0 || len + sentences[n].length <= PIECE)) {
        len += sentences[n].length + 1;
        n++;
        if (first && len >= want) break;
      }
      if (n > 0 && (len >= want || ended || !first)) return sentences.splice(0, n).join(" ");
      if (ended && sentences.length === 0) return null;
      await new Promise<void>((r) => (wake = r));
    }
  };

  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const finishUp = () => {
    if (reading === id) {
      reading = null;
      tell();
    }
    if (stopCurrent === stop) stopCurrent = null;
    resolveDone();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    ctl.abort();
    try {
      window.speechSynthesis?.cancel();
    } catch {}
    const el = theAudio();
    if (el && !el.paused) el.pause();
    nudge();
    finishUp();
  };
  stopCurrent = stop;
  reading = id;
  tell();

  void (async () => {
    const first = await nextPiece(true);
    let sound: Promise<Sound> | null = first ? fetchSound(first, ctl.signal) : null;
    while (sound && !stopped) {
      const now = await sound;
      /* the next piece is waited for and made while this one plays */
      const after = nextPiece(false).then((p) => (p ? fetchSound(p, ctl.signal) : null));
      await play(now, isStopped);
      const next = await after;
      if (stopped && next?.kind === "audio") URL.revokeObjectURL(next.url);
      sound = next ? Promise.resolve(next) : null;
    }
    if (!stopped) finishUp();
  })();

  return {
    feed: (delta) => {
      if (stopped || ended) return;
      raw += delta;
      cut();
      nudge();
    },
    finish: () => {
      if (ended) return;
      ended = true;
      cut();
      nudge();
    },
    done,
  };
}

/** Read a whole answer out as `id`. */
export function readOut(id: string, text: string): Promise<void> {
  const r = startReading(id);
  r.feed(text);
  r.finish();
  return r.done;
}
