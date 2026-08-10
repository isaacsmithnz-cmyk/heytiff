import { act, cleanup, render, screen } from "@testing-library/react";
const mockChime = jest.fn();
jest.mock("@/lib/voice/chime", () => ({ playChime: (k: string) => mockChime(k) }));

import {
  COUNTDOWN_FROM,
  DictClock,
  MAX_RECORDING_SECONDS,
  remainingOf,
  useDictation,
} from "../dictation";

/* THE TWO-MINUTE CEILING.

   Until 2026-08-06 there was no limit on a recording at all: the clock counted
   up for as long as the mic stayed open, and the only cap in the system was
   25 MB on the upload route — about an hour of speech, announced by an error
   telling people to keep it under a couple of minutes. A limit nobody
   enforced, described by a message nobody could reach.

   The property worth guarding is not "it stops". It is that it stops the way
   PRESSING STOP does — the words already said are read back and kept. A cap
   that discarded a long recording would be worse than no cap, and it is one
   line away at all times (`cancel()` instead of `stop()`).

   The cap lives in the engine so every posture inherits it. A test that only
   proved it for one screen would be worth very little. */

class FakeRecorder {
  static last: FakeRecorder | null = null;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stopCalls = 0;
  constructor(public stream: MediaStream) {
    FakeRecorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

const track = { stop: jest.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;

function Probe({
  onTranscript,
}: {
  onTranscript: (t: string, info: { capped: boolean; handedOver: boolean }) => void;
}) {
  const d = useDictation({ onTranscript });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <button onClick={d.stop}>stop</button>
      <button onClick={d.cancel}>cancel</button>
      <button onClick={d.handOver}>handover</button>
      <span data-testid="secs">{d.seconds}</span>
      <span data-testid="rec">{String(d.recording)}</span>
    </div>
  );
}

/* Let the promise chain inside `start()` settle — getUserMedia is awaited
   before the recorder exists, so the clock cannot tick until it resolves. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  FakeRecorder.last = null;
  track.stop.mockClear();
  mockChime.mockClear();
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: jest.fn(async () => fakeStream) },
  });
  /* A hand-rolled stub rather than `Response.json` on purpose: reading a real
     Response body needs a macrotask, which fake timers are holding. */
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ text: "compressor is noisy on start-up" }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the recorder stops itself", () => {
  it("runs on well past a minute without interfering", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();

    await tick(MAX_RECORDING_SECONDS - 1);
    expect(FakeRecorder.last?.stopCalls).toBe(0);
    expect(screen.getByTestId("rec")).toHaveTextContent("true");
  });

  it("stops at two minutes", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();

    await tick(MAX_RECORDING_SECONDS);
    expect(FakeRecorder.last?.stopCalls).toBe(1);
  });

  it("KEEPS what was said — it stops, it does not discard", async () => {
    const onTranscript = jest.fn();
    render(<Probe onTranscript={onTranscript} />);
    screen.getByText("start").click();
    await settle();

    await tick(MAX_RECORDING_SECONDS);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/workboard/transcribe", expect.anything());
    expect(onTranscript).toHaveBeenCalledWith("compressor is noisy on start-up", {
      capped: true,
      handedOver: false,
    });
  });

  /* The flag that lets a caller tell "I have finished" from "the clock ran
     out". note-flow ROUTES on the first and holds on the second, so a stale
     `capped` would file half a note — or, the other way, silently swallow a
     finished one. */
  it("says the ceiling caused it, and stops saying so on the next recording", async () => {
    const onTranscript = jest.fn();
    render(<Probe onTranscript={onTranscript} />);

    screen.getByText("start").click();
    await settle();
    await tick(MAX_RECORDING_SECONDS);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onTranscript.mock.calls[0]?.[1]).toEqual({ capped: true, handedOver: false });

    // pressed again, and this time stopped on purpose well inside the limit
    screen.getByText("start").click();
    await settle();
    await tick(5);
    await act(async () => {
      FakeRecorder.last?.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onTranscript.mock.calls[1]?.[1]).toEqual({ capped: false, handedOver: false });
  });

  it("gives a fresh two minutes when the mic is pressed again", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();
    await tick(MAX_RECORDING_SECONDS);

    const first = FakeRecorder.last;
    screen.getByText("start").click();
    await settle();
    expect(screen.getByTestId("secs")).toHaveTextContent("0");

    await tick(MAX_RECORDING_SECONDS - 1);
    expect(FakeRecorder.last).not.toBe(first);
    expect(FakeRecorder.last?.stopCalls).toBe(0);
  });

  it("only fires the stop path once, however long the clock is left running", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();

    await tick(MAX_RECORDING_SECONDS + 20);
    expect(FakeRecorder.last?.stopCalls).toBe(1);
  });
});

describe("the clock", () => {
  it("counts up for most of the recording", () => {
    render(<DictClock seconds={42} />);
    expect(screen.getByText("0:42")).toBeInTheDocument();
  });

  it("flips to counting down for the last stretch", () => {
    render(<DictClock seconds={MAX_RECORDING_SECONDS - COUNTDOWN_FROM} />);
    expect(screen.getByText(`${COUNTDOWN_FROM}s left`)).toBeInTheDocument();
  });

  it("says so out loud only once it matters", () => {
    const { rerender } = render(<DictClock seconds={10} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<DictClock seconds={MAX_RECORDING_SECONDS - 5} />);
    expect(screen.getByRole("status")).toHaveTextContent("5s left");
  });

  it("never counts past the ceiling into negative numbers", () => {
    expect(remainingOf(MAX_RECORDING_SECONDS + 30)).toBe(0);
    render(<DictClock seconds={MAX_RECORDING_SECONDS + 30} />);
    expect(screen.getByText("0s left")).toBeInTheDocument();
  });
});

/* THE THREE NOTES, at the three moments. The sound is the only signal that
   reaches someone who has put the phone in their pocket, so WHICH note plays
   is load-bearing — and "stopped" versus "threw it away" is the pair that
   must never blur, because it is the difference between having your note and
   not having it. */
describe("the mic's chimes", () => {
  it("says nothing until the microphone is genuinely open", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    /* Not yet — getUserMedia has not resolved, and a refused permission must
       never chime as though a recording had begun. */
    expect(mockChime).not.toHaveBeenCalled();

    await settle();
    expect(mockChime).toHaveBeenCalledWith("start");
  });

  it("plays the closing note when you stop on purpose", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();
    mockChime.mockClear();

    await act(async () => {
      screen.getByText("stop").click();
    });
    expect(mockChime).toHaveBeenCalledWith("stop");
  });

  /* The pair that must never blur: this is the difference between having your
     note and not having it, and on a roof with the phone pocketed the sound is
     the only thing that says which happened. */
  it("plays a DIFFERENT note when the recording is thrown away", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();
    mockChime.mockClear();

    await act(async () => {
      screen.getByText("cancel").click();
    });
    expect(mockChime).toHaveBeenCalledWith("discard");
    expect(mockChime).not.toHaveBeenCalledWith("stop");
  });

  it("plays it for you when the ceiling stops the recording", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    screen.getByText("start").click();
    await settle();
    mockChime.mockClear();

    await tick(MAX_RECORDING_SECONDS);
    expect(mockChime).toHaveBeenCalledWith("stop");
  });

  it("never chimes for a microphone that was not running", async () => {
    render(<Probe onTranscript={jest.fn()} />);
    await act(async () => {
      screen.getByText("stop").click();
      screen.getByText("cancel").click();
    });
    expect(mockChime).not.toHaveBeenCalled();
  });
});

/* ── FINISHING IT BY TYPING ──

   Pressing Type mid-recording is a third ending, and it has to behave like
   the ceiling rather than like stop or cancel: the words are kept, nothing
   is routed. The two ways of getting that wrong are both silent — route the
   half-sentence and you file a note nobody finished, or reuse `cancel` and
   the words evaporate with no error to show for it. */
describe("handing a recording over to the keyboard", () => {
  it("keeps every word and marks them as NOT for routing", async () => {
    const onTranscript = jest.fn();
    render(<Probe onTranscript={onTranscript} />);
    screen.getByText("start").click();
    await settle();

    await tick(8);
    screen.getByText("handover").click();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onTranscript).toHaveBeenCalledWith("compressor is noisy on start-up", {
      capped: false,
      handedOver: true,
    });
  });

  /* It is not the ceiling, and must not claim to be — `capped` is what makes
     the surface announce a two-minute limit, and announcing one to somebody
     eight seconds in would be a plain lie. */
  it("does not borrow the ceiling's flag", async () => {
    const onTranscript = jest.fn();
    render(<Probe onTranscript={onTranscript} />);
    screen.getByText("start").click();
    await settle();

    screen.getByText("handover").click();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onTranscript.mock.calls[0]?.[1]).toEqual({ capped: false, handedOver: true });
  });

  /* Cleared by the next `start`, exactly like `capped`. A sticky flag would
     mean the recording AFTER a handover silently refused to route. */
  it("clears itself, so the next recording routes normally", async () => {
    const onTranscript = jest.fn();
    render(<Probe onTranscript={onTranscript} />);

    screen.getByText("start").click();
    await settle();
    screen.getByText("handover").click();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    screen.getByText("start").click();
    await settle();
    screen.getByText("stop").click();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(onTranscript.mock.calls[1]?.[1]).toEqual({ capped: false, handedOver: false });
  });
});
