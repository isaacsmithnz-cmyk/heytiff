import { openMicTap, startRealtime } from "../realtime-stream";

/* THE FIRST PART OF WHAT YOU SAID.

   Isaac, 2026-08-10: "when I record my voice anywhere, it always misses the
   first part even after it has given me the audio beep."

   The beep was honest — the MediaRecorder was running and the clip had every
   word. What was late was the live transport: a token round trip to our own
   server, a handshake to the vendor, a worklet compile. Nothing spoken in
   that window was ever sent, the socket transcribed the remainder, and a live
   transcript BEATS the recording in `dictation.tsx` — so the complete clip was
   discarded in favour of the truncated words. A bug you can only see as a
   missing first sentence, on the transport that was supposed to be the fast
   one.

   So the mic is tapped before the socket exists and buffers until there is
   somewhere to put the audio. What is pinned here is that the buffer is
   actually DRAINED, in order, ahead of anything heard afterwards — the two
   ways to break this again are dropping the backlog and appending it. */

/* ── the audio pipeline jsdom doesn't have ───────────────────────────── */

class FakeWorkletNode {
  static last: FakeWorkletNode | null = null;
  port: { onmessage: ((e: MessageEvent<Float32Array>) => void) | null } = { onmessage: null };
  disconnect = jest.fn();
  constructor() {
    FakeWorkletNode.last = this;
  }
  /** A render quantum arriving from the audio thread. */
  hear(samples: Float32Array) {
    this.port.onmessage?.({ data: samples } as MessageEvent<Float32Array>);
  }
}

class FakeCtx {
  static last: FakeCtx | null = null;
  sampleRate: number;
  state = "running";
  audioWorklet = { addModule: jest.fn(async () => {}) };
  resume = jest.fn(async () => {});
  close = jest.fn(async () => {});
  createMediaStreamSource = jest.fn(() => ({ connect: jest.fn(), disconnect: jest.fn() }));
  constructor(options?: { sampleRate?: number }) {
    // a browser is allowed to ignore the asked-for rate; this one obliges
    this.sampleRate = options?.sampleRate ?? 48_000;
    FakeCtx.last = this;
  }
}

class FakeSocket {
  static last: FakeSocket | null = null;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  addEventListener() {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  /** The handshake completing, several hundred milliseconds late. */
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const stream = {} as MediaStream;

/** Distinct per index, so a reordered or dropped chunk is visible. */
const speech = (from: number, frames: number) =>
  Float32Array.from({ length: frames }, (_, i) => ((from + i) % 20_000) / 20_000);

/** What `encodePcm` will have made of those samples. */
const asPcm = (samples: Float32Array) => Array.from(samples, (v) => Math.round(v * 32767));

/** Every sample the socket has actually been given, in the order it got them. */
function samplesSent(ws: FakeSocket): number[] {
  const out: number[] = [];
  for (const raw of ws.sent) {
    const msg = JSON.parse(raw) as { audio_base_64: string };
    const binary = atob(msg.audio_base_64);
    for (let i = 0; i < binary.length; i += 2) {
      const lo = binary.charCodeAt(i);
      const hi = binary.charCodeAt(i + 1);
      const word = lo | (hi << 8);
      out.push(word > 0x7fff ? word - 0x10000 : word);
    }
  }
  return out;
}

beforeEach(() => {
  FakeWorkletNode.last = null;
  FakeCtx.last = null;
  FakeSocket.last = null;
  Object.assign(globalThis, {
    AudioContext: FakeCtx,
    AudioWorkletNode: FakeWorkletNode,
    WebSocket: FakeSocket,
  });
});

const liveHandle = async (tap: Awaited<ReturnType<typeof openMicTap>>) => {
  const starting = startRealtime({ tap, token: "single-use", keyterms: [], onText: () => {} });
  await Promise.resolve(); // let the socket be constructed
  FakeSocket.last!.open();
  return starting;
};

it("sends what was said before the socket opened, in order and ahead of the rest", async () => {
  const tap = await openMicTap(stream);
  const node = FakeWorkletNode.last!;

  // the person is already talking; the token fetch and handshake are in flight
  const first = speech(0, 1_600);
  const second = speech(1_600, 1_600);
  node.hear(first);
  node.hear(second);

  const handle = await liveHandle(tap);

  // ...and carries on talking once the socket is up
  const third = speech(3_200, 1_600);
  node.hear(third);

  expect(samplesSent(FakeSocket.last!)).toEqual([
    ...asPcm(first),
    ...asPcm(second),
    ...asPcm(third),
  ]);

  handle.cancel();
});

it("holds the backlog rather than dropping the oldest of it", async () => {
  const tap = await openMicTap(stream);
  const node = FakeWorkletNode.last!;
  // twelve seconds of a slow handshake, well past a single 100ms chunk
  for (let i = 0; i < 12; i++) node.hear(speech(i * 16_000, 16_000));

  const handle = await liveHandle(tap);

  expect(samplesSent(FakeSocket.last!).slice(0, 4)).toEqual(asPcm(speech(0, 4)));
  expect(samplesSent(FakeSocket.last!)).toHaveLength(12 * 16_000);

  handle.cancel();
});

it("abandons the live path when the backlog outgrows the cap, rather than transcribing a hole", async () => {
  const tap = await openMicTap(stream);
  const node = FakeWorkletNode.last!;
  // 30s is the cap at 16kHz; a wedged token fetch could buffer far more
  for (let i = 0; i < 40; i++) node.hear(speech(i * 16_000, 16_000));
  expect(tap.overflowed).toBe(true);

  await expect(
    startRealtime({ tap, token: "single-use", keyterms: [], onText: () => {} })
  ).rejects.toThrow(/pre-roll/);
  // and the mic is released — the recording is now the only transcript
  expect(FakeCtx.last!.close).toHaveBeenCalled();
  expect(FakeSocket.last).toBeNull();
});

it("releases the microphone when nobody ever comes for the audio", async () => {
  const tap = await openMicTap(stream);
  tap.close();
  tap.close(); // both sides close on failure; the second is a no-op
  expect(FakeCtx.last!.close).toHaveBeenCalledTimes(1);
  expect(FakeWorkletNode.last!.disconnect).toHaveBeenCalledTimes(1);
});

it("stops feeding the socket once the words have been asked for", async () => {
  jest.useFakeTimers();
  try {
    const tap = await openMicTap(stream);
    const node = FakeWorkletNode.last!;
    const handle = await liveHandle(tap);
    const ws = FakeSocket.last!;

    const stopping = handle.stop();
    const sentByStop = ws.sent.length; // the commit, and nothing after it
    node.hear(speech(0, 16_000)); // a quantum still in flight from the audio thread
    expect(ws.sent).toHaveLength(sentByStop);

    jest.advanceTimersByTime(1_000); // the settle window
    await expect(stopping).resolves.toBe("");
  } finally {
    jest.useRealTimers();
  }
});
