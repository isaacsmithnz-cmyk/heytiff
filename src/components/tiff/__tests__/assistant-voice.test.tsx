import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffAssistant } from "../assistant";
import type { AskEvent, AskInput } from "@/lib/tiff/ask-client";

/* THE ASK BAR'S MICROPHONE.

   Speaking to Tiff is typing with your voice and nothing more: no sieve, no
   routing, no review — which is exactly what makes it worth pinning, because
   every OTHER mic in this app does route, and the temptation to make this one
   clever is permanent.

   What these hold down:
   · a deployment with no key offers no mic, and the box still works;
   · interim words are SHOWN and never COMMITTED — a discarded recording
     leaves nothing behind, which is the bug you get for free by binding the
     box straight to the live transcript;
   · a transcript APPENDS, so two presses make one sentence;
   · Send is gone, not disabled, while the mic is open — there is nothing to
     send yet;
   · a failure says so instead of dying quietly. */

const asks: AskInput[] = [];
jest.mock("@/lib/tiff/ask-client", () => ({
  askTiff: async (input: AskInput) => {
    asks.push(input);
    const emit = input.onEvent as (e: AskEvent) => void;
    emit({ t: "delta", text: "Thirty millimetres." });
    emit({ t: "done" });
  },
}));

jest.mock("@/app/actions/kb", () => ({
  kbDocUrl: async () => ({ ok: true as const, url: "https://signed.example/doc.pdf" }),
}));

/* The engine is replaced, but only the engine. `LevelBars`, `clockOf` and
   `appendSpoken` stay real — `appendSpoken` in particular IS the behaviour
   under test here, and a test that reimplements the join can't fail when the
   join changes. */
type Cbs = {
  onTranscript: (text: string, info: { capped: boolean }) => void;
  onError?: (message: string) => void;
};
const mockCbs: { current: Cbs | null } = { current: null };
const mockCtl: {
  setRecording?: (v: boolean) => void;
  setTranscribing?: (v: boolean) => void;
  setInterim?: (v: string) => void;
  start: jest.Mock;
  stop: jest.Mock;
  cancel: jest.Mock;
} = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn() };

jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  const react = jest.requireActual("react") as typeof import("react");
  return {
    ...actual,
    useDictation: (opts: Cbs) => {
      mockCbs.current = opts;
      const [recording, setRecording] = react.useState(false);
      const [transcribing, setTranscribing] = react.useState(false);
      const [interim, setInterim] = react.useState("");
      mockCtl.setRecording = setRecording;
      mockCtl.setTranscribing = setTranscribing;
      mockCtl.setInterim = setInterim;
      return {
        recording,
        transcribing,
        interim,
        seconds: 7,
        barsRef: react.createRef(),
        start: mockCtl.start,
        stop: mockCtl.stop,
        cancel: mockCtl.cancel,
      };
    },
  };
});

/* The engine's own contract, mirrored: words arrive while `transcribing` is
   still true, because the real hook clears it in a `finally` AFTER the
   callback. Getting this backwards in a test hides the disabled-input focus
   bug the component works around. */
const landTranscript = (text: string, capped = false) =>
  act(() => {
    mockCtl.setRecording?.(false);
    mockCtl.setInterim?.("");
    mockCtl.setTranscribing?.(true);
    mockCbs.current?.onTranscript(text, { capped });
    mockCtl.setTranscribing?.(false);
  });

const speak = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByLabelText("Ask by voice"));
  act(() => mockCtl.setRecording?.(true));
};

const box = () => screen.getByLabelText("Ask Tiff") as HTMLInputElement;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  asks.length = 0;
  mockCbs.current = null;
});

afterEach(cleanup);

describe("no key on the deployment", () => {
  it("offers no mic, and the box still works", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled={false} />);

    expect(screen.queryByLabelText("Ask by voice")).not.toBeInTheDocument();

    await user.type(box(), "clearance above an FTXM71");
    await user.click(screen.getByLabelText("Send"));
    expect(asks[0]?.question).toBe("clearance above an FTXM71");
  });
});

describe("dictating a question", () => {
  it("shows the mic and starts the engine when it is pressed", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    await user.click(screen.getByLabelText("Ask by voice"));
    expect(mockCtl.start).toHaveBeenCalledTimes(1);
  });

  it("replaces Send with Stop while the mic is open, and offers a discard", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    expect(screen.queryByLabelText("Send")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Stop dictating and read it back")).toBeInTheDocument();
    expect(screen.getByLabelText("Discard the recording")).toBeInTheDocument();
    expect(box()).toBeDisabled();
    expect(box()).toHaveAttribute("placeholder", "Listening…");
  });

  it("SHOWS the live words without committing them", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    act(() => mockCtl.setInterim?.("minimum clearance above"));
    expect(box()).toHaveValue("minimum clearance above");

    /* Thrown away mid-sentence. If the box had been bound to the live
       transcript, the tail of a half-heard question would still be sitting
       in it — this is the whole reason interim text is display-only. */
    await user.click(screen.getByLabelText("Discard the recording"));
    expect(mockCtl.cancel).toHaveBeenCalledTimes(1);
    act(() => {
      mockCtl.setRecording?.(false);
      mockCtl.setInterim?.("");
    });
    expect(box()).toHaveValue("");
  });

  it("puts the transcript in the box and sends exactly that", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);
    await user.click(screen.getByLabelText("Stop dictating and read it back"));
    expect(mockCtl.stop).toHaveBeenCalledTimes(1);

    landTranscript("What is the minimum clearance above an FTXM71?");
    expect(box()).toHaveValue("What is the minimum clearance above an FTXM71?");
    expect(box()).not.toBeDisabled();

    await user.click(screen.getByLabelText("Send"));
    expect(asks[0]?.question).toBe("What is the minimum clearance above an FTXM71?");
  });

  it("appends, so two presses make one question", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    await speak(user);
    landTranscript("What is the minimum clearance");
    await speak(user);
    landTranscript("above an FTXM71?");

    expect(box()).toHaveValue("What is the minimum clearance above an FTXM71?");
  });

  it("appends to what was already typed rather than replacing it", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    await user.type(box(), "FTXM71 —");
    await speak(user);
    landTranscript("what is the clearance above it?");

    expect(box()).toHaveValue("FTXM71 — what is the clearance above it?");
  });

  it("says so when the recording could not be read, and the box still works", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    act(() => {
      mockCtl.setRecording?.(false);
      mockCbs.current?.onError?.("Nothing was recorded. Try again, or type it.");
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was recorded");
    await user.type(box(), "typed instead");
    await user.click(screen.getByLabelText("Send"));
    expect(asks[0]?.question).toBe("typed instead");
  });
});

describe("running out of time", () => {
  it("keeps the words, says why it stopped, and lets you carry straight on", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    await speak(user);
    landTranscript("what is the minimum clearance", true);
    expect(box()).toHaveValue("what is the minimum clearance");
    expect(screen.getByRole("status")).toHaveTextContent("Two minutes");

    /* The mic is live again immediately — this is a pause, not a failure. */
    await speak(user);
    landTranscript("above an FTXM71?", false);
    expect(box()).toHaveValue("what is the minimum clearance above an FTXM71?");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Send"));
    expect(asks[0]?.question).toBe("what is the minimum clearance above an FTXM71?");
  });
});
