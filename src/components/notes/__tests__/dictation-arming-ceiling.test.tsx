import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
jest.mock("@/lib/voice/chime", () => ({ playChime: jest.fn() }));

import { useDictation } from "../dictation";

/* A MICROPHONE THAT NEVER OPENS.

   `getUserMedia` is not guaranteed to settle: a permission prompt nobody
   answers, a device another app is holding, an OS panel behind the window.
   That used to be invisible — the surface showed its idle box, and the mic
   simply never arrived.

   Since the card opens on the recording stage it is no longer invisible, it
   is a LIE: a red dot, a clock at 0:00 and a Done button, for audio that does
   not exist. So the arming window has a ceiling, and past it the card hands
   back the box and says why.

   The late permission is the other half. When the browser finally answers, the
   stream is closed rather than opened into a recording nobody is watching —
   the same rule as standing down by hand. */

const track = { stop: jest.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;
let openMic: (s: MediaStream) => void = () => {};

class FakeRecorder {
  static made = 0;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {
    FakeRecorder.made += 1;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

function Probe() {
  const [err, setErr] = useState<string | null>(null);
  const d = useDictation({ onTranscript: jest.fn(), onError: setErr });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <span data-testid="state">{d.arming ? "arming" : d.recording ? "rec" : "idle"}</span>
      <span data-testid="err">{err ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeRecorder.made = 0;
  track.stop.mockClear();
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () =>
        new Promise<MediaStream>((resolve) => {
          openMic = resolve;
        }),
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
  cleanup();
});

it("stops claiming to listen when the microphone never opens", async () => {
  render(<Probe />);
  act(() => {
    screen.getByText("start").click();
  });
  expect(screen.getByTestId("state")).toHaveTextContent("arming");

  await act(async () => {
    jest.advanceTimersByTime(4_000);
  });

  expect(screen.getByTestId("state")).toHaveTextContent("idle");
  expect(screen.getByTestId("err")).toHaveTextContent(/microphone didn't open/i);
});

it("lets go of a permission that arrives after that", async () => {
  render(<Probe />);
  act(() => {
    screen.getByText("start").click();
  });
  await act(async () => {
    jest.advanceTimersByTime(4_000);
  });

  await act(async () => {
    openMic(fakeStream);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(FakeRecorder.made).toBe(0);
  expect(track.stop).toHaveBeenCalled();
  expect(screen.getByTestId("state")).toHaveTextContent("idle");
});
