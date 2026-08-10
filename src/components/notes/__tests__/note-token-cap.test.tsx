import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";

/* WHAT A RECORDING TURNS INTO, AND WHEN.

   No transcript routes on its own any more (2026-08-10): every way a
   recording ends puts the words in the box, and `Go` is the one
   commit. So the first thing this file guards is that speaking is
   checkable — you can read it, fix a misheard word, and route the EDIT.

   The two-minute ceiling still gets its own tests, because it is the one
   ending nobody chose. It must keep the words, say why it stopped, and let
   the next press carry on from there — a note spoken across three
   recordings is one note, and routing only the tail would lose two minutes
   of it. That half of this file exists because the correct-looking version
   of the code is the broken one. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));

const routeNote = jest.fn();
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: (...a: unknown[]) => routeNote(...(a as [])),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

/* Only the engine is faked; the flow, the sheet and the textarea are real,
   because the behaviour under test lives in how they are wired together. */
type Cbs = { onTranscript: (t: string, i: { capped: boolean }) => void };
const mockCbs: { current: Cbs | null } = { current: null };
const mockStart = jest.fn();

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: (opts: Cbs) => {
      mockCbs.current = opts;
      const react = jest.requireActual("react") as typeof import("react");
      return {
        recording: false,
        transcribing: false,
        interim: "",
        seconds: 0,
        barsRef: react.createRef(),
        start: mockStart,
        stop: jest.fn(),
        cancel: jest.fn(),
      };
    },
  };
});

const deliver = async (text: string, capped: boolean) =>
  act(async () => {
    mockCbs.current?.onTranscript(text, { capped });
    // let the routing transition settle when one was started
    await Promise.resolve();
    await Promise.resolve();
  });

const openSheet = async () => {
  const user = userEvent.setup();
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffButton />
    </NoteScopeProvider>
  );
  await user.click(screen.getByLabelText(/Ask or tell Tiff/));
  return user;
};

const boxText = () => (screen.getByRole("textbox") as HTMLTextAreaElement).value;

beforeEach(() => {
  jest.clearAllMocks();
  mockCbs.current = null;
  routeNote.mockResolvedValue({
    ok: true,
    noteId: "n-1",
    staff: [],
    proposal: {
      tasks: [],
      bringItems: [],
      flags: [],
      progressBullets: [],
      commissioningEntries: [],
      issueEntries: [],
      kbEntries: [],
      noteLines: [],
      plainNote: "whatever",
      clarify: null,
    },
  });
});

afterEach(cleanup);

/* SPEAKING NO LONGER COMMITS. Stopping on purpose used to route on the
   spot, which made voice the one way into the app you could not check
   first — the box unmounted and the review card showed you what had been
   MADE of words you could no longer edit. Now every transcript lands in the
   box and `Go` is the single commit for spoken and typed alike.
   (Isaac, 2026-08-10, comparing it to dictating into a chat composer.) */
it("puts the words in the box rather than routing them, even on a deliberate stop", async () => {
  await openSheet();
  await deliver("middle rooftop unit tripped again", false);

  expect(routeNote).not.toHaveBeenCalled();
  expect(boxText()).toBe("middle rooftop unit tripped again");
});

it("routes what is in the box when Go is pressed — and calls it voice", async () => {
  const user = await openSheet();
  await deliver("middle rooftop unit tripped again", false);
  await user.click(screen.getByRole("button", { name: "Go" }));

  expect(routeNote).toHaveBeenCalledTimes(1);
  /* The commit is a button press now, so nothing at the call site knows the
     words were spoken. A note dictated and then filed as `text` would be a
     quiet lie in the data, so the flow remembers. */
  expect(routeNote).toHaveBeenCalledWith(
    expect.objectContaining({ transcript: "middle rooftop unit tripped again", source: "voice" })
  );
});

/* The point of the whole change: what gets routed is what you LEFT in the
   box, not what the microphone heard. */
it("routes the edit, not the transcript", async () => {
  const user = await openSheet();
  await deliver("order the grills", false);

  const box = screen.getByRole("textbox");
  await user.clear(box);
  await user.type(box, "order the grilles");
  await user.click(screen.getByRole("button", { name: "Go" }));

  expect(routeNote).toHaveBeenCalledWith(
    expect.objectContaining({ transcript: "order the grilles" })
  );
});

it("does NOT route when the ceiling stopped it — the note is not finished", async () => {
  await openSheet();
  await deliver("middle rooftop unit tripped again and the compressor", true);
  expect(routeNote).not.toHaveBeenCalled();
});

it("keeps the words in the box and says why it stopped", async () => {
  await openSheet();
  await deliver("middle rooftop unit tripped again", true);

  expect(boxText()).toBe("middle rooftop unit tripped again");
  expect(screen.getByRole("status")).toHaveTextContent("Two minutes");
  expect(screen.getByRole("status")).toHaveTextContent("carry on");
});

it("carries on where it left off when the mic is pressed again", async () => {
  const user = await openSheet();
  await deliver("middle rooftop unit tripped again", true);

  /* The way back to the mic is the Default switch's Talk half. It used to be
     a button that relabelled itself "Keep going" after the ceiling; the
     switch cannot borrow that word without the two halves changing width
     under the sliding thumb, so the invitation moved into the hint above —
     which the test before this one pins ("carry on"). */
  const again = screen.getByRole("button", { name: /talk/i });
  await user.click(again);
  expect(mockStart).toHaveBeenCalled();

  await deliver("and the compressor is still noisy", true);
  expect(boxText()).toBe("middle rooftop unit tripped again and the compressor is still noisy");
  expect(routeNote).not.toHaveBeenCalled();
});

it("routes the WHOLE thing once the person finally commits it", async () => {
  const user = await openSheet();
  await deliver("middle rooftop unit tripped again", true);
  await deliver("and the compressor is still noisy", true);
  await deliver("book it in for Thursday", false);
  await user.click(screen.getByRole("button", { name: "Go" }));

  expect(routeNote).toHaveBeenCalledTimes(1);
  /* The last leg is what the engine hands over, but the note is everything
     said across all three — routing only the tail would lose two minutes of
     it, which is the same bug wearing a different hat. */
  expect(routeNote.mock.calls[0][0].transcript).toBe(
    "middle rooftop unit tripped again and the compressor is still noisy book it in for Thursday"
  );
});
