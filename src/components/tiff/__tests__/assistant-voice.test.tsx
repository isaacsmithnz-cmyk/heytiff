import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffAssistant } from "../assistant";
import { READING_BACK_NOTE } from "@/components/notes/waits";
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

/* The engine is replaced, but only the engine. `LevelOrb`, `clockOf` and
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

  /* THE BAR HANDS ITS SPACE TO THE SHARED CARD. What used to be a stop ■ and
     a discard × crammed into the composer is now the same recording card the
     Tiff button's sheet and the debrief show — so what these assert is that
     the ask bar gives way to it, and that the three ways out of a recording
     are the card's three, not a second set invented here. */
  it("gives the bar over to the recording card, with the card's three ways out", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    // the composer is gone — there is nothing to send yet, and no box to type in
    expect(screen.queryByLabelText("Send")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ask Tiff")).not.toBeInTheDocument();

    // …and what replaced it is the card every other door opens
    expect(screen.getByLabelText("Listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start again/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Type instead/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Discard the recording")).toBeInTheDocument();
  });

  /* NOT ONE OF THEM MAY SUBMIT. The card sits inside Tiff's `<form>`, where a
     bare `<button>` defaults to `type="submit"` — so "Start again" would have
     asked the half-finished question instead of binning the take. The note
     postures never sat in a form, which is exactly how a shared component
     inherits a bug from the one place that never had to think about it. */
  it("never lets a card button submit the question", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    for (const name of [/Start again/, /Type instead/, /^Done$/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("type", "button");
    }

    await user.click(screen.getByRole("button", { name: /Start again/ }));
    expect(asks).toHaveLength(0);
  });

  /* The rule is unchanged and the place it is kept moved: live words are
     SHOWN, never HELD. They used to be shown in the ask box; the box is not
     on screen while the mic is open, so they are shown where the card shows
     them — joined onto whatever was already captured, by the same
     `appendSpoken` the committed transcript uses. */
  it("SHOWS the live words without committing them", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);

    act(() => mockCtl.setInterim?.("minimum clearance above"));
    expect(screen.getByLabelText("What you have said so far")).toHaveValue(
      "minimum clearance above"
    );

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

  /* WHAT YOU HAVE ALREADY SAID STAYS ON SCREEN, on the second leg as on the
     first (Isaac, 2026-08-10: "if I click talk, it looks like you're starting
     again because it doesn't show you what text it's already got on there").
     Tiff appends across legs exactly as the note card does, so the card must
     show the join, not just the newest words. */
  it("keeps the first leg on screen while the second one is being said", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    await speak(user);
    landTranscript("what is the minimum clearance");

    await speak(user);
    act(() => mockCtl.setInterim?.("above an FTXM71?"));
    expect(screen.getByLabelText("What you have said so far")).toHaveValue(
      "what is the minimum clearance above an FTXM71?"
    );
  });

  it("puts the transcript in the box and sends exactly that", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);
    await user.click(screen.getByRole("button", { name: "Done" }));
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

/* ── the three states of the bar, and the two orbs in them ───────────────── */

/* THE MICROPHONE'S OWN WAIT USED TO SAY NOTHING FOR ITSELF. While a finished
   recording was being turned into words the bar showed one line of flat grey
   text — the same treatment the two-minute notice and the failure line use,
   which put a passing state in the typeface of bad news. It gets the chip the
   transcript's waits get, and the pair reads as one object handing over: the
   orb in the bar BREATHES with your voice while the mic is open, then the
   same sphere carries on turning under the bar until the words land. */

describe("the bar while a recording is read back", () => {
  it("meters the voice while the mic is open, and names the wait after it closes", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);

    // nothing is listening yet, so there is no meter and nothing to read back
    expect(screen.queryByLabelText("Listening")).not.toBeInTheDocument();
    expect(screen.queryByText(READING_BACK_NOTE)).not.toBeInTheDocument();

    await speak(user);
    expect(screen.getByLabelText("Listening")).toBeInTheDocument();
    expect(screen.queryByText(READING_BACK_NOTE)).not.toBeInTheDocument();

    // the mic closes and the engine takes over: the meter goes, the chip comes
    act(() => {
      mockCtl.setRecording?.(false);
      mockCtl.setTranscribing?.(true);
    });
    expect(screen.queryByLabelText("Listening")).not.toBeInTheDocument();
    expect(screen.getByText(READING_BACK_NOTE)).toBeInTheDocument();

    // …and the whole thing is gone once the words are in the box
    act(() => {
      mockCbs.current?.onTranscript("what is the clearance", { capped: false });
      mockCtl.setTranscribing?.(false);
    });
    expect(screen.queryByText(READING_BACK_NOTE)).not.toBeInTheDocument();
    expect(box()).toHaveValue("what is the clearance");
  });

  /* The word is on the page, in a live region, rather than in an `aria-label`
     nobody can see — and it carries no punctuation, because the ellipsis is
     the stylesheet's. */
  it("announces the wait as text, unpunctuated", async () => {
    const user = userEvent.setup();
    render(<TiffAssistant voiceEnabled />);
    await speak(user);
    act(() => {
      mockCtl.setRecording?.(false);
      mockCtl.setTranscribing?.(true);
    });

    expect(screen.getByRole("status")).toHaveTextContent(READING_BACK_NOTE);
    expect(READING_BACK_NOTE).not.toMatch(/[….]/);
  });
});
