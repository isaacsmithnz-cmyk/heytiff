import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";

/* WHAT THE TWO-MINUTE CEILING MUST NOT DO TO A NOTE.

   Every other way a recording ends means "I have finished saying it", and the
   capsule routes on it — seven seconds of model, then a review card. The cap
   looks identical from the engine and means the opposite: someone was
   mid-sentence and the clock ran out.

   Route there and you file half a note and drop the person on a review card
   for a thought they never finished. Worst of all on the debrief, which is a
   whole day's braindump and by far the likeliest recording to run long.

   So: the words are kept in the box, nothing is routed, and pressing the mic
   again carries on from where it stopped. This file exists because the
   correct-looking version of this code is the broken one. */

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

it("routes normally when the recording was stopped on purpose", async () => {
  await openSheet();
  await deliver("middle rooftop unit tripped again", false);
  expect(routeNote).toHaveBeenCalledTimes(1);
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

  const again = screen.getByRole("button", { name: /keep going/i });
  await user.click(again);
  expect(mockStart).toHaveBeenCalled();

  await deliver("and the compressor is still noisy", true);
  expect(boxText()).toBe("middle rooftop unit tripped again and the compressor is still noisy");
  expect(routeNote).not.toHaveBeenCalled();
});

it("routes the WHOLE thing once the person finally stops on purpose", async () => {
  await openSheet();
  await deliver("middle rooftop unit tripped again", true);
  await deliver("and the compressor is still noisy", true);
  await deliver("book it in for Thursday", false);

  expect(routeNote).toHaveBeenCalledTimes(1);
  /* The last leg is what the engine hands over, but the note is everything
     said across all three — routing only the tail would lose two minutes of
     it, which is the same bug wearing a different hat. */
  expect(routeNote.mock.calls[0][0].transcript).toBe(
    "middle rooftop unit tripped again and the compressor is still noisy book it in for Thursday"
  );
});
