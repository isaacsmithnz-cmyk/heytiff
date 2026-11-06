import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffAssistant, type ConversationParts } from "../assistant";
import { READING_BACK_NOTE } from "@/components/notes/waits";
import { STORE_KEY } from "@/lib/tiff/threads";
import { resetThreadSync } from "@/lib/tiff/thread-sync";

/* THE BOX'S MICROPHONE, in Conversations.

   Speaking to Tiff is typing with your voice and nothing more: no sieve, no
   routing, no review — which is exactly what makes it worth pinning, because
   every OTHER mic in this app does route, and the temptation to make this one
   clever is permanent.

   What these hold down:
   · a deployment with no key offers no mic, and the box still works;
   · interim words are SHOWN and never COMMITTED: the box takes the words
     only once they land;
   · a transcript APPENDS, so two presses make one question, and it joins
     what was already typed;
   · a failure says so instead of dying quietly, and two minutes says why it
     stopped. */

const asks: { question: string }[] = [];
jest.mock("@/lib/brain/ask-client", () => ({
  askBrain: async (input: { question: string }, on: { onDelta: (t: string) => void; onDone: () => void }) => {
    asks.push(input);
    on.onDelta("Thirty millimetres.");
    on.onDone();
  },
}));

jest.mock("@/app/actions/kb", () => ({
  kbDocUrl: async () => ({ ok: true as const, url: "https://signed.example/doc.pdf" }),
}));

/* The engine is replaced, but only the engine. `LevelOrb`, `LiveWords` and
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
  restart: jest.Mock;
  handOver: jest.Mock;
} = { start: jest.fn(), stop: jest.fn(), cancel: jest.fn(), restart: jest.fn(), handOver: jest.fn() };

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
        restart: mockCtl.restart,
        handOver: mockCtl.handOver,
      };
    },
  };
});

/* The engine's own contract, mirrored: words arrive while `transcribing` is
   still true, because the real hook clears it in a `finally` AFTER the
   callback. Getting this backwards in a test hides the disabled-box focus
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
  await user.click(screen.getByRole("button", { name: "Speak instead of typing" }));
  act(() => mockCtl.setRecording?.(true));
};

const box = () => screen.getByRole("textbox", { name: "Ask Tiff" });
const send = () => screen.getByRole("button", { name: "Send to Tiff" });

const frame = ({ list, pane }: ConversationParts) => (
  <>
    {list}
    {pane}
  </>
);
/* An open chat, so the box is at its foot. */
const draw = (voiceEnabled = true) => {
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify([{ id: "t-1", title: "Clearances", updatedAt: Date.now(), messages: [{ role: "user", text: "FTXM71?", at: Date.now() }] }])
  );
  return render(<TiffAssistant frame={frame} voiceEnabled={voiceEnabled} />);
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  asks.length = 0;
  mockCbs.current = null;
  resetThreadSync();
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }));
});

afterEach(cleanup);

describe("no key on the deployment", () => {
  it("offers no mic, and the box still works", async () => {
    const user = userEvent.setup();
    draw(false);
    expect(screen.queryByRole("button", { name: "Speak instead of typing" })).not.toBeInTheDocument();

    await user.type(box(), "clearance above an FTXM71");
    await user.click(send());
    expect(asks[0]?.question).toBe("clearance above an FTXM71");
  });
});

describe("dictating a question", () => {
  it("shows the mic and starts the engine when it is pressed", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByRole("button", { name: "Speak instead of typing" }));
    expect(mockCtl.start).toHaveBeenCalledTimes(1);
  });

  /* Live words are SHOWN, never HELD: if the box were bound to the live
     transcript, the tail of a half-heard question would be left in it. */
  it("shows the live words while you speak, and the box takes only what lands", async () => {
    const user = userEvent.setup();
    draw();
    await speak(user);
    act(() => mockCtl.setInterim?.("minimum clearance above"));
    expect(screen.getByRole("group", { name: "Recording" })).toHaveTextContent("minimum clearance above");

    landTranscript("minimum clearance above an FTXM71?");
    expect(box()).toHaveValue("minimum clearance above an FTXM71?");
  });

  it("puts the transcript in the box, gives the caret back, and sends exactly that", async () => {
    const user = userEvent.setup();
    draw();
    await speak(user);
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(mockCtl.stop).toHaveBeenCalledTimes(1);

    landTranscript("What is the minimum clearance above an FTXM71?");
    expect(box()).toHaveValue("What is the minimum clearance above an FTXM71?");
    expect(box()).not.toBeDisabled();
    expect(box()).toHaveFocus();

    await user.click(send());
    expect(asks[0]?.question).toBe("What is the minimum clearance above an FTXM71?");
  });

  it("appends, so two presses make one question", async () => {
    const user = userEvent.setup();
    draw();
    await speak(user);
    landTranscript("What is the minimum clearance");
    await speak(user);
    landTranscript("above an FTXM71?");
    expect(box()).toHaveValue("What is the minimum clearance above an FTXM71?");
  });

  it("appends to what was already typed rather than replacing it", async () => {
    const user = userEvent.setup();
    draw();
    await user.type(box(), "FTXM71 —");
    await speak(user);
    landTranscript("what is the clearance above it?");
    expect(box()).toHaveValue("FTXM71 — what is the clearance above it?");
  });

  it("says so when the recording could not be read, and the box still works", async () => {
    const user = userEvent.setup();
    draw();
    await speak(user);
    act(() => {
      mockCtl.setRecording?.(false);
      mockCbs.current?.onError?.("Nothing was recorded. Try again, or type it.");
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was recorded");
    await user.type(box(), "typed instead");
    await user.click(send());
    expect(asks[0]?.question).toBe("typed instead");
  });
});

describe("running out of time", () => {
  it("keeps the words, says why it stopped, and lets you carry straight on", async () => {
    const user = userEvent.setup();
    draw();
    await speak(user);
    landTranscript("what is the minimum clearance", true);
    expect(box()).toHaveValue("what is the minimum clearance");
    expect(screen.getByRole("status")).toHaveTextContent("two minutes");

    /* The mic is live again immediately — this is a pause, not a failure. */
    await speak(user);
    landTranscript("above an FTXM71?", false);
    expect(box()).toHaveValue("what is the minimum clearance above an FTXM71?");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(send());
    expect(asks[0]?.question).toBe("what is the minimum clearance above an FTXM71?");
  });
});

describe("the box while a recording is read back", () => {
  /* The word is on the page, in a live region, rather than in an `aria-label`
     nobody can see — and it carries no punctuation, because the ellipsis is
     the stylesheet's. */
  it("names the wait, unpunctuated, and the box waits for the words", async () => {
    const user = userEvent.setup();
    draw();
    expect(screen.queryByText(READING_BACK_NOTE)).not.toBeInTheDocument();
    await speak(user);
    act(() => {
      mockCtl.setRecording?.(false);
      mockCtl.setTranscribing?.(true);
    });
    expect(screen.getByRole("status")).toHaveTextContent(READING_BACK_NOTE);
    expect(READING_BACK_NOTE).not.toMatch(/[….]/);
    expect(box()).toBeDisabled();

    act(() => {
      mockCbs.current?.onTranscript("what is the clearance", { capped: false });
      mockCtl.setTranscribing?.(false);
    });
    expect(screen.queryByText(READING_BACK_NOTE)).not.toBeInTheDocument();
    expect(box()).toHaveValue("what is the clearance");
  });
});
