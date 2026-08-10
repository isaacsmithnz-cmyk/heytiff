import { act, cleanup, render, screen } from "@testing-library/react";

jest.mock("@/lib/voice/chime", () => ({ playChime: jest.fn() }));
jest.mock("@/lib/voice/realtime-stream", () => ({
  openMicTap: () => mockOpenMicTap(),
  startRealtime: (opts: { tap: unknown }) => mockStartRealtime(opts),
}));

import { useDictation } from "../dictation";

/* WHEN THE MIC STARTS LISTENING, which is not the same question as when the
   recording starts.

   Isaac, 2026-08-10: "when I record my voice anywhere, it always misses the
   first part even after it has given me the audio beep." On the live
   transport it did. `goLive` used to fetch a token, open a socket and compile
   a worklet before a single sample was tapped, and only then start listening
   — a second or so of speech that the socket never saw, on the path whose
   transcript OVERRIDES the recording.

   The buffering itself is pinned in lib/voice/__tests__/realtime-preroll. What
   this file pins is the ordering it depends on, which is the part a later
   tidy-up would undo without noticing: the tap is opened FIRST, before the
   token round trip, not after it. A tap opened where the socket is built
   buffers nothing worth having. */

class FakeRecorder {
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

/** Every step of bringing the live path up, in the order it happened. */
let steps: string[] = [];

const tap = {
  rate: 16_000,
  overflowed: false,
  deliverTo: jest.fn(),
  close: jest.fn(() => steps.push("tap closed")),
};

const mockOpenMicTap = jest.fn(async () => {
  steps.push("mic tapped");
  return tap;
});
const mockStartRealtime = jest.fn(async ({ tap: given }: { tap: unknown }) => {
  steps.push(given ? "socket open" : "socket open, listening to nothing");
  return { stop: jest.fn(async () => "live words"), cancel: jest.fn() };
});

const track = { stop: jest.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;

function Probe() {
  const d = useDictation({ onTranscript: jest.fn(), onError: jest.fn() });
  return <button onClick={d.start}>start</button>;
}

const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

const tokenResponse = { ok: true, json: async () => ({ token: "single-use", keyterms: [] }) };

beforeEach(() => {
  steps = [];
  FakeRecorder.last = null;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => fakeStream) },
  });
  global.fetch = jest.fn(async (url: unknown) => {
    steps.push(`fetch ${String(url)}`);
    return tokenResponse;
  }) as unknown as typeof fetch;
  window.history.replaceState({}, "", "/dashboard?voice=live");
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/dashboard");
});

it("taps the mic before asking for a token, not after the socket is up", async () => {
  render(<Probe />);
  screen.getByText("start").click();
  await settle();

  expect(steps).toEqual([
    "mic tapped",
    "fetch /api/workboard/transcribe/token",
    "socket open",
  ]);
});

it("hands the already-listening tap to the socket rather than a fresh one", async () => {
  render(<Probe />);
  screen.getByText("start").click();
  await settle();

  expect(mockStartRealtime).toHaveBeenCalledWith(expect.objectContaining({ tap }));
});

it("opens no tap at all on the batch transport", async () => {
  window.history.replaceState({}, "", "/dashboard?voice=batch");
  render(<Probe />);
  screen.getByText("start").click();
  await settle();

  expect(mockOpenMicTap).not.toHaveBeenCalled();
  expect(FakeRecorder.last?.state).toBe("recording");
});

it("lets go of the mic when the token never arrives", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
  render(<Probe />);
  screen.getByText("start").click();
  await settle();

  expect(mockStartRealtime).not.toHaveBeenCalled();
  expect(tap.close).toHaveBeenCalled();
});

it("lets go of the mic when the recording ended before the token came back", async () => {
  let handOverToken = () => {};
  global.fetch = jest.fn((url: unknown) =>
    String(url).endsWith("/token")
      ? new Promise((resolve) => {
          handOverToken = () => resolve(tokenResponse);
        })
      : /* the recording's own upload, which the stop below sets going */
        Promise.resolve({ ok: true, json: async () => ({ text: "roof unit is short cycling" }) })
  ) as unknown as typeof fetch;

  render(<Probe />);
  screen.getByText("start").click();
  await settle(); // tapped and listening, token still in flight

  await act(async () => {
    FakeRecorder.last!.stop();
  });
  handOverToken();
  await settle();

  expect(mockStartRealtime).not.toHaveBeenCalled();
  expect(tap.close).toHaveBeenCalled();
});
