import { act, cleanup, render, screen } from "@testing-library/react";
jest.mock("@/lib/voice/chime", () => ({ playChime: jest.fn() }));

import { useDictation } from "../dictation";

/* THE LATEST CALLBACKS, AND THE MIC THAT MUST SURVIVE THEM.

   `useDictation` holds `onTranscript`/`onError` in a ref. That looks like an
   optimisation and is not: the recorder is created inside `start()` and torn
   down by an effect with an empty dependency array, so the moment those two
   props become dependencies of anything, an ordinary parent re-render runs a
   cleanup that stops a live recording mid-sentence. Every caller re-renders
   while you talk — the clock ticks once a second.

   So the ref has to satisfy two things at once, and they pull in opposite
   directions:

     1. the words go to the callback from the LATEST committed render, not
        the one that happened to be current when the mic opened, and
     2. a new callback identity does NOT disturb the recorder.

   Both are tested here because both have a plausible wrong fix. Dropping the
   ref (props straight into the handlers, callbacks into the deps) breaks (2).
   Writing the ref once on mount breaks (1) — and (1) failing is silent: the
   note is transcribed, handed to a stale closure, and lands nowhere anybody
   is looking.

   The write itself is an insertion effect rather than a line in the render
   body; see the comment on `cbs` in ../dictation. What the phase must never
   become is "after the next paint" — this hook lives inside promises. */

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

const track = { stop: jest.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;

function Probe({
  onTranscript,
  onError,
}: {
  onTranscript: (t: string, info: { capped: boolean; handedOver: boolean }) => void;
  onError?: (m: string) => void;
}) {
  const d = useDictation({ onTranscript, onError });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <button onClick={d.stop}>stop</button>
    </div>
  );
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  FakeRecorder.last = null;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => fakeStream) },
  });
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ text: "roof unit is short cycling" }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("hands the words to the callback from the LATEST render, not the one that started the mic", async () => {
  const first = jest.fn();
  const second = jest.fn();

  const { rerender } = render(<Probe onTranscript={first} />);
  screen.getByText("start").click();
  await settle();

  // parent re-renders mid-recording with a brand-new callback identity
  rerender(<Probe onTranscript={second} />);

  await act(async () => {
    screen.getByText("stop").click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("roof unit is short cycling", { capped: false, handedOver: false });
});

it("keeps the mic alive across a re-render — a new callback must not stop the recorder", async () => {
  const { rerender } = render(<Probe onTranscript={jest.fn()} />);
  screen.getByText("start").click();
  await settle();

  const rec = FakeRecorder.last;
  rerender(<Probe onTranscript={jest.fn()} onError={jest.fn()} />);
  await settle();

  expect(FakeRecorder.last).toBe(rec);
  expect(rec?.state).toBe("recording");
});

it("routes an error to the latest onError too", async () => {
  const firstErr = jest.fn();
  const secondErr = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: false,
    json: async () => ({ error: "transcription failed" }),
  })) as unknown as typeof fetch;

  const { rerender } = render(<Probe onTranscript={jest.fn()} onError={firstErr} />);
  screen.getByText("start").click();
  await settle();

  rerender(<Probe onTranscript={jest.fn()} onError={secondErr} />);

  await act(async () => {
    screen.getByText("stop").click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(firstErr).not.toHaveBeenCalled();
  expect(secondErr).toHaveBeenCalledWith("transcription failed");
});
