import { act, cleanup, render, screen } from "@testing-library/react";
jest.mock("@/lib/voice/chime", () => ({ playChime: jest.fn() }));

import { useDictation } from "../dictation";

/* START THAT ONE AGAIN — and the audio has to actually go in the bin.

   Two separate properties live in this file, and only the second one is
   subtle.

   The first is `restart` itself: bin this take, open a fresh mic, stay in
   the recording stage. It sequences THROUGH `onstop` rather than around it,
   because the meter, the tracks and the recording flag are refs shared
   between runs — a new run opened straight from the button would have the
   old run's cleanup switch it back off underneath it.

   The second is why the discard flag is per-run rather than a single ref.
   A real MediaRecorder fires `onstop` on a LATER TASK than the `stop()` that
   caused it, so ANY caller that bins a take and starts another in the same
   breath clears a shared flag before the old handler has read it — and the
   recording that was thrown away is transcribed and appended instead. Words
   arriving in the box from a take you deliberately binned is the worst shape
   this bug has: it reads as the app inventing sentences.

   The last test drives that pattern directly, because `restart` is careful
   enough not to. The fake fires `onstop` asynchronously for the same reason
   — a synchronous one would pass against the broken implementation. */

class FakeRecorder {
  static all: FakeRecorder[] = [];
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {
    FakeRecorder.all.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    // the real one never calls this synchronously — see the note above
    setTimeout(() => this.onstop?.(), 0);
  }
}

const track = { stop: jest.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;

function Probe({ onTranscript }: { onTranscript: (t: string, i: { capped: boolean }) => void }) {
  const d = useDictation({ onTranscript });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <button onClick={d.stop}>stop</button>
      <button onClick={d.restart}>restart</button>
      {/* The pattern the per-run flag exists for: bin one and open another
          without waiting for the first to finish letting go. */}
      <button
        onClick={() => {
          d.cancel();
          d.start();
        }}
        data-testid="rush"
      >
        cancel then start
      </button>
      <span data-testid="state">{d.recording ? "recording" : "idle"}</span>
    </div>
  );
}

const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(5);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};

let uploads = 0;

beforeEach(() => {
  jest.useFakeTimers();
  uploads = 0;
  FakeRecorder.all = [];
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => fakeStream) },
  });
  global.fetch = jest.fn(async () => {
    uploads += 1;
    return { ok: true, json: async () => ({ text: "the binned take" }) };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("bins the recording it restarts — nothing is uploaded, nothing reaches the box", async () => {
  const onTranscript = jest.fn();
  render(<Probe onTranscript={onTranscript} />);
  screen.getByText("start").click();
  await settle();

  screen.getByText("restart").click();
  await settle();

  expect(uploads).toBe(0);
  expect(onTranscript).not.toHaveBeenCalled();
});

it("opens a fresh microphone in its place", async () => {
  render(<Probe onTranscript={jest.fn()} />);
  screen.getByText("start").click();
  await settle();
  const first = FakeRecorder.all[0];

  screen.getByText("restart").click();
  await settle();

  expect(FakeRecorder.all).toHaveLength(2);
  expect(FakeRecorder.all[1]).not.toBe(first);
  expect(FakeRecorder.all[1].state).toBe("recording");
  // and the card is still in its recording stage, not blinking through idle
  expect(screen.getByTestId("state")).toHaveTextContent("recording");
});

/* THE RACE ITSELF. The second run is well underway by the time the first
   run's `onstop` fires, so the first run has to answer for itself. */
it("still bins the first take even though the second one has already started", async () => {
  const onTranscript = jest.fn();
  render(<Probe onTranscript={onTranscript} />);
  screen.getByText("start").click();
  await settle();

  screen.getByText("restart").click();
  await settle();
  expect(FakeRecorder.all).toHaveLength(2);

  // now finish the SECOND take properly
  screen.getByText("stop").click();
  await settle();

  expect(uploads).toBe(1);
  expect(onTranscript).toHaveBeenCalledTimes(1);
});

/* THE PER-RUN FLAG, driven directly. `restart` sequences through `onstop`
   and so never exercises this; a shared discard ref would upload the binned
   take here, because the second run clears it before the first run's
   handler ever reads it. */
it("bins a cancelled take even when the next recording starts before it lets go", async () => {
  const onTranscript = jest.fn();
  render(<Probe onTranscript={onTranscript} />);
  screen.getByText("start").click();
  await settle();

  screen.getByTestId("rush").click();

  /* THE ORDERING IS THE TEST. `start` resolves on microtasks (getUserMedia)
     and `onstop` arrives on a macrotask, so a browser gets the second run
     fully live BEFORE the first run's handler runs. Flushing microtasks
     without advancing the clock reproduces exactly that gap; settle both at
     once and the old handler fires first, which is the easy case and proves
     nothing. */
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  expect(FakeRecorder.all).toHaveLength(2);
  expect(FakeRecorder.all[1].state).toBe("recording");

  // only now does the binned take get its say
  await settle();

  expect(uploads).toBe(0);
  expect(onTranscript).not.toHaveBeenCalled();
});

it("does nothing when there is no recording to restart", async () => {
  render(<Probe onTranscript={jest.fn()} />);
  screen.getByText("restart").click();
  await settle();

  expect(FakeRecorder.all).toHaveLength(0);
  expect(uploads).toBe(0);
});
