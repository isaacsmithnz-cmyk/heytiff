import { act, cleanup, render, screen } from "@testing-library/react";
jest.mock("@/lib/voice/chime", () => ({ playChime: () => {} }));

import { useDictation } from "../dictation";

/* ENDING ON QUIET, in the engine (the Tiff modal, 2026-09-28: "having to
   click done kind of takes away from the conversation flow").

   The meter is the only honest clock for a quiet: it is the same samples the
   bars are drawn from. What this holds is the engine's half: after a voice,
   a quiet as long as the policy says calls `onQuiet` ONCE; speaking again
   re-arms it; nothing is called before anyone has spoken; a tap
   (`keepListening`) starts the quiet over; and the fill the modal shows is
   the share of the quiet used, written to the bound element. The policy
   itself is tiff/modal/quiet's, and has its own tests. */

class FakeRecorder {
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: MediaStream) {}
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

/** How loud the room is right now, 0 to 1 of full scale. */
let amplitude = 0;
class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 256,
      frequencyBinCount: 128,
      getByteTimeDomainData(samples: Uint8Array) {
        samples.forEach((_, i) => (samples[i] = 128 + Math.round((i % 2 ? 1 : -1) * amplitude * 127)));
      },
    };
  }
  createMediaStreamSource() {
    return { connect: () => {} };
  }
  close() {
    return Promise.resolve();
  }
}

const fakeStream = { getTracks: () => [{ stop: () => {} }] } as unknown as MediaStream;

function Probe({ onQuiet, limit = 1000 }: { onQuiet: () => void; limit?: number | null }) {
  const d = useDictation({ onTranscript: () => {}, quietEnd: () => limit, onQuiet });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <button onClick={d.keepListening}>tap</button>
      <span data-testid="fill" ref={(el) => d.bindQuiet(el)} />
    </div>
  );
}

const frames = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};
const fill = () => Number(screen.getByTestId("fill").style.getPropertyValue("--quiet") || "0");

async function listening(onQuiet: () => void, limit?: number | null) {
  render(<Probe onQuiet={onQuiet} limit={limit} />);
  screen.getByText("start").click();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  amplitude = 0;
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => fakeStream) },
  });
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the quiet that ends a take", () => {
  it("calls onQuiet once when the quiet after a voice runs out, filling as it goes", async () => {
    const onQuiet = jest.fn();
    await listening(onQuiet);
    amplitude = 0.3;
    await frames(200);
    amplitude = 0;
    await frames(500);
    expect(onQuiet).not.toHaveBeenCalled();
    expect(fill()).toBeGreaterThan(0.3);
    expect(fill()).toBeLessThan(0.7);
    await frames(600);
    expect(onQuiet).toHaveBeenCalledTimes(1);
    expect(fill()).toBe(1);
    await frames(2000);
    expect(onQuiet).toHaveBeenCalledTimes(1);
  });

  it("speaking again re-arms it, and empties the fill", async () => {
    const onQuiet = jest.fn();
    await listening(onQuiet);
    amplitude = 0.3;
    await frames(200);
    amplitude = 0;
    await frames(1200);
    expect(onQuiet).toHaveBeenCalledTimes(1);
    amplitude = 0.3;
    await frames(100);
    expect(fill()).toBe(0);
    amplitude = 0;
    await frames(1200);
    expect(onQuiet).toHaveBeenCalledTimes(2);
  });

  it("calls nothing before anyone has spoken: a take waiting to start is not a finished one", async () => {
    const onQuiet = jest.fn();
    await listening(onQuiet);
    await frames(5000);
    expect(onQuiet).not.toHaveBeenCalled();
    expect(fill()).toBe(0);
  });

  it("a tap starts the quiet over", async () => {
    const onQuiet = jest.fn();
    await listening(onQuiet);
    amplitude = 0.3;
    await frames(200);
    amplitude = 0;
    await frames(800);
    act(() => screen.getByText("tap").click());
    await frames(800);
    expect(onQuiet).not.toHaveBeenCalled();
    await frames(400);
    expect(onQuiet).toHaveBeenCalledTimes(1);
  });

  it("a policy of null keeps listening however long the quiet", async () => {
    const onQuiet = jest.fn();
    await listening(onQuiet, null);
    amplitude = 0.3;
    await frames(200);
    amplitude = 0;
    await frames(10_000);
    expect(onQuiet).not.toHaveBeenCalled();
    expect(fill()).toBe(0);
  });
});
