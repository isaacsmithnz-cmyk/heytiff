# Voice capture, step by step

How a spoken note gets from a microphone to a saved row, as the code stands on
2026-08-10 (main `a925135`). Written after the whole path was walked on
production for the first time.

Everything here is one engine — `useDictation` in
`src/components/notes/dictation.tsx` — wearing different clothes. The capture
card, Tiff's ask bar and the field mics all call it, so a change here is a
change everywhere. That is deliberate and is the reason the file exists.

---

## 0. Before you press anything

- **Who gets a microphone at all.** `canDictate()` (`src/lib/voice/can-dictate.ts`)
  checks whether the user holds *any* capability that offers dictation —
  today `workboard` or `tiff`. Both API routes enforce it independently,
  because each one spends money per call and a route handler is reachable
  directly.
- **Which transport.** `NEXT_PUBLIC_VOICE_REALTIME` is set to `1` in Vercel,
  so **live is the default in production**. `?voice=live` / `?voice=batch` in
  the URL beats the flag for a single page load, and nothing is stored — the
  address bar is the only place the override lives.
- **What the mic does when you press it** is a stored preference (the
  `Default` switch), which only appears on surfaces that actually consult it.

## 1. You press the mic

`start()` runs, in this order, and the order is load-bearing:

1. **`getUserMedia({ audio: true })`** — the browser's permission prompt.
   Echo cancellation is on by default, which is what keeps the chime that
   follows out of the recording.
2. **The tap opens** (live transport only). `openMicTap()` in
   `src/lib/voice/realtime-stream.ts` starts an `AudioContext` at 16 kHz, wires
   an `AudioWorklet`, and **starts buffering PCM immediately**. It is opened
   here — before the chime, before the recorder — because the socket it feeds
   is still seconds away. See step 4.
3. **The start chime** — a rising fifth, B4 → F♯5, ~90 ms a note. It fires only
   once the microphone is genuinely open, so it never announces a recording
   that fails to start.
4. **`new MediaRecorder(stream)`** and `rec.start()`. **The recorder runs on
   both transports**, always. This is the safety model, not redundancy: every
   live failure falls back to uploading this clip.
5. **The level meter starts** — a second `AudioContext` with an analyser,
   sampled every animation frame.
6. **`goLive()` is fired and not awaited** (live only), so a slow token or a
   refused handshake costs a live transcript and nothing else.

## 2. What you see while it records

| element | what it is |
|---|---|
| red pulsing dot + **Recording** | the ribbon's state |
| **0:04** at 26 px | the clock, counting up; flips to *Ns left* for the last **30 s** |
| the trace | 48 bars across ~69% of the card, driven by real samples |
| **Hearing you** / **Not hearing anything** | the meter, in words |
| Type instead · Start again · Done | the actions |

**The trace and the label come from the same samples.** Every frame the meter
computes RMS, writes `--lvl` straight to the DOM (never through React — it
runs at 60 fps), and counts a frame as loud above `LOUD_ENOUGH = 0.07`. The
label is the slow version of the same fact: it flips only when the gap since
the last loud frame crosses `QUIET_MS = 1200`, because a label that flickers
between syllables is worse than no label.

At silence the bars rest at 6% of 56 px — a live flat line. That is the whole
point: *listening and hearing nothing* has to look different from *dead*.

**The ceiling.** At `MAX_RECORDING_SECONDS = 120` the recorder stops itself,
plays the stop chime and marks the run `capped`. It **stops, it does not
discard** — the two minutes you already said are transcribed and kept, and the
card says why it stopped.

## 3. The five ways it ends

| control | what happens to the audio |
|---|---|
| **Done** | stop chime, transcribe, words land in the box |
| **Type instead** | same, *unless* nothing was said — see below |
| **Start again** | binned unheard, fresh mic opens |
| **×** (ribbon) | binned unheard, card closes |
| two-minute ceiling | transcribed and kept, marked `capped` |

**Type instead** discards only where it is confident: the meter ran, it never
rose above room noise, **and** the live socket produced no words. Any
uncertainty keeps the recording. Without the "meter ran" check, every browser
where the meter failed would bin real speech.

**Start again** bins the take without asking. A confirm step would make it
slower than starting over by hand. You get two chimes — discard (low,
unresolved), then start — and that pair is the receipt that it both let go and
came back.

## 4. What the live socket is doing meanwhile

Only on the live transport, and every failure below is silent by design.

1. `POST /api/workboard/transcribe/token` mints ElevenLabs' **single-use
   token** (15 min, consumed on use). The browser opens the socket, not the
   server — Vercel Hobby functions cannot hold a WebSocket.
2. The route sends **staff names first**, then trade vocabulary, capped at
   **50 terms × 20 chars** for this model.
3. `startRealtime()` opens `wss://api.elevenlabs.io/v1/speech-to-text/realtime`
   with `model_id=scribe_v2_realtime`, `commit_strategy=vad`.
4. **The buffered pre-roll goes up first**, in order, ahead of anything heard
   live. This is what stops the first second of speech going missing: the
   token round trip, the handshake and the worklet compile all happen *after*
   the beep, and everything said in that window is already in the tap.
5. Audio streams as 16-bit PCM in **100 ms** chunks. Partials come back and
   land in the box as `interim`; the trace shrinks to a baseline to make room.

If the backlog ever exceeds **30 s** (a wedged token fetch), the live path is
**abandoned rather than trimmed** — the upload still has every word, so the
transport that didn't miss the start does the job.

## 5. When it stops

`onstop` runs and the order matters:

1. `markStopped()` — the clock starts, because this is the moment you start
   waiting.
2. **Discarded?** cancel the socket, stop the tracks, done. (If this was a
   *restart*, the new microphone opens from here, not from the button — the
   meter, the tracks and the recording flag are shared, so a new run started
   from the button would be switched off by the old run's cleanup.)
3. **Live transcript first**, because it is already finished. `handle.stop()`
   flushes the last utterance and waits for the socket to go quiet (500 ms
   settle, 2.5 s hard cap).
4. **If the socket produced nothing**, fall through to uploading the clip —
   and log loudly, because that silence once looked like a broken feature
   instead of a failing transport.
5. **The batch floor.** `POST /api/workboard/transcribe`, 25 MB cap, same
   keyterms. An empty blob is an error the person can see, never a silent
   return.
6. **`saidSomething()`** strips the transcriber's own bracketed labels
   (`[BLANK_AUDIO]`, `[outro jingle]`) before deciding anything was said. A
   silent clip comes back as *nothing but* those labels.

## 6. The words land in the box

**Nothing routes off a transcript.** Whichever way the recording ended, the
words go into the textarea to be read and fixed first. Speaking used to be the
one way into the app you could not check before it committed.

A note spoken across three recordings is one note — each leg appends.

**Adding more is one press.** Isaac, comparing it to Claude's own composer:
*"you can hit enter, then tap the mic again to keep adding."* The behaviour was
always there; what was missing was anything that looked like it. With words in
the box the mode control drops the `Default` switch — a preference, in the
strongest position on the row, whose left half happened to start recording —
for a plain `Talk` button. The switch owns the empty box, where "what should
this do next time" is a fair question, and every capture opens empty.

**Opening the sheet may already have started a leg.** With the stored default
on Talk, `tiff-button` starts recording as the sheet opens, so a test counting
`start` calls must measure a delta rather than an absolute.

**This is why there are two presses**, and why only the second one is called
Go. `Done` ends the recording; `Go` files it. They were briefly both called
Go, until walking it on prod produced the obvious complaint — you press a
button called Go and nothing goes. The two presses stayed; the word moved.

## 7. You press Go

`submit()` makes one decision:

- **Looks like a question** → `ask()` streams an answer from the brain into
  the card. Never in a debrief, which is capture by definition.
- **Otherwise** → `read()` calls the `routeNote` server action, tagged
  `voice` if any part of it was spoken. **The note row is written before the
  model runs and kept whatever it says** — the words are the valuable thing,
  routing is an enhancement on top.

Routing takes about seven seconds, so the card has a `sorting` state of its
own: the transcript shown as words, skeleton bars, no fake progress.

## 8. The review, and saving

The proposal comes back as tasks, flags, knowledge entries and note lines,
each tickable. `Save these` calls `applyNote` with what is still ticked.
Walking away instead dismisses the note, so nothing sits at `pending` forever.

## 9. What gets measured

`src/lib/voice/timing.ts` prints one console line per note. Two links are
timed separately and **there is no total**, because a person now sits between
them:

- `stop → transcript` — the bit the transport changes (measured: **~0.86 s**
  live against 3.9–5.2 s batch)
- `Go → proposal` — the routing call (**~7.1 s**, variance ±2.6 s)

## 10. The rules that are easy to undo by accident

1. **The MediaRecorder runs on both transports.** Deleting the "redundant"
   recorder removes the floor under every live failure.
2. **The tap opens before the token fetch.** Move it next to the socket and
   the first second of every note goes missing again — silently, because a
   live transcript beats the recording.
3. **The discard flag is per-recording.** A real `MediaRecorder` fires
   `onstop` a task *later* than the `stop()` that caused it, so a shared flag
   lets a binned take come back transcribed.
4. **`stop()` waits for quiet, not for the next message.** The protocol has no
   acknowledgement; resolving on the first arrival truncates every note that
   ends mid-sentence.
5. **Both transports return what was said.** No `no_verbatim` — the two paths
   returning different prose for the same sentence means switching transport
   silently changes what your notes read like.
6. **The chime says which ending it was.** Stop and discard must never sound
   alike, or you cannot tell by ear whether the note was kept.

## Where things live

| file | what |
|---|---|
| `src/components/notes/dictation.tsx` | the engine: recorder, meter, chimes, endings |
| `src/components/notes/note-token.tsx` | the card and its stages |
| `src/components/notes/note-flow.ts` | what happens to the words |
| `src/lib/voice/realtime-stream.ts` | mic tap → PCM → WebSocket (browser only) |
| `src/lib/voice/realtime.ts` | the protocol, pure and tested |
| `src/lib/voice/transcribe.ts` | the batch adapter and keyterms |
| `src/lib/voice/chime.ts` | the three notes |
| `src/lib/voice/timing.ts` | where the seconds went |
| `src/app/api/workboard/transcribe/` | batch route + token route |
