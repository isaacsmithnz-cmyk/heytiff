import { act, cleanup, render, screen } from "@testing-library/react";
jest.mock("@/lib/voice/chime", () => ({ playChime: jest.fn() }));

import { useDictation } from "../dictation";

/* WORDS THAT ARRIVE AFTER YOU HAVE GONE.

   Isaac, 2026-08-17, walking the capture card: "It seems to be holding on to
   text from a previous note, and flashing up as I'm talking. The text that
   you can see in there is from the last note that I recorded."

   The read-back is the hole. Every other ending is covered — stop, discard
   and restart all happen while the recorder is running, and `cancel()` marks
   the run so `onstop` bins it. But once the recorder has stopped, the audio
   is in the air: a fetch is out, or the socket is flushing its last
   utterance. `cancel()` checked `state === "recording"`, found it wasn't, and
   returned having done nothing at all.

   So closing the card during "Reading it back" left a transcription running
   with nobody waiting for it, and when it landed it went to `onTranscript`
   exactly as if somebody were. The flow appends — that is how a note spoken
   across three recordings stays one note — so the words turned up in the box
   of the NEXT capture, or mid-sentence while it was recording.

   A discarded run is now discarded whichever side of the stop you are on. The
   request is allowed to finish; its answer goes in the bin. */

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

/** The transcription, held open — this is the read-back you walk away from. */
let land: (text: string) => void = () => {};

function Probe({ onTranscript }: { onTranscript: (t: string, i: { capped: boolean }) => void }) {
  const d = useDictation({ onTranscript });
  return (
    <div>
      <button onClick={d.start}>start</button>
      <button onClick={d.stop}>stop</button>
      <button onClick={d.cancel}>cancel</button>
      <span data-testid="state">{d.transcribing ? "reading" : d.recording ? "rec" : "idle"}</span>
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
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        json: () => new Promise((resolve) => (land = (text) => resolve({ text }))),
      }) as unknown as Response
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it("drops a transcription you walked away from — it must never reach the next note", async () => {
  const heard = jest.fn();
  render(<Probe onTranscript={heard} />);

  screen.getByText("start").click();
  await settle();
  await act(async () => {
    screen.getByText("stop").click();
    await Promise.resolve();
  });
  expect(screen.getByTestId("state")).toHaveTextContent("reading");

  // the card closes — `flow.close` calls `cancel` on whatever is happening
  screen.getByText("cancel").click();

  // and only now does the transcriber answer
  await act(async () => {
    land("Hi Chloe, thanks for sharing");
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(heard).not.toHaveBeenCalled();
});

it("still delivers the words when you simply waited for them", async () => {
  const heard = jest.fn();
  render(<Probe onTranscript={heard} />);

  screen.getByText("start").click();
  await settle();
  await act(async () => {
    screen.getByText("stop").click();
    await Promise.resolve();
  });

  await act(async () => {
    land("Hi Chloe, thanks for sharing");
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(heard).toHaveBeenCalledWith("Hi Chloe, thanks for sharing", { capped: false });
});
