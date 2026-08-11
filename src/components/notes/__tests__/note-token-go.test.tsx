import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";

/* ONE WORD FOR THE WAY ONWARD.

   The card used to have two names for the same gesture: "Stop & read" while
   the mic was open, "Go" once the words were in the box. Isaac, 2026-08-10,
   looking at a recording in prod: "still says stop and read" — he was not
   reporting a stale deploy, he was reading two vocabularies on one card.

   They are still two different actions, which is the whole reason this file
   exists. Recording's Go ENDS THE RECORDING and shows you the words; idle's
   Go COMMITS them. If a later tidy-up ever wires one to the other's handler
   the labels will look right and the card will file a note nobody has read,
   which is exactly the failure the whole "speaking does not commit" change
   was made to prevent.

   What makes the shared name safe is that they never share a screen: one
   exists only while the mic is open, the other only once there is something
   to sort. That is pinned here too, because it is the assumption the name
   rests on. */

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

/** The engine's state, set per test before the sheet opens. */
const mic = { recording: false };
const mockStop = jest.fn();
const mockStart = jest.fn();

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      return {
        recording: mic.recording,
        transcribing: false,
        interim: "",
        seconds: 3,
        barsRef: react.createRef(),
        start: mockStart,
        stop: mockStop,
        handOver: jest.fn(),
        cancel: jest.fn(),
      };
    },
  };
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

beforeEach(() => {
  jest.clearAllMocks();
  mic.recording = false;
});

afterEach(cleanup);

it("ends the recording — it does not commit anything", async () => {
  mic.recording = true;
  const user = await openSheet();

  await user.click(screen.getByRole("button", { name: "Go" }));

  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(routeNote).not.toHaveBeenCalled();
});

it("keeps the stop mark, because the word does not say the mic is closing", async () => {
  mic.recording = true;
  await openSheet();

  // the glyph is the only thing left saying "this ends the recording"
  expect(screen.getByRole("button", { name: "Go" }).querySelector("svg")).toBeTruthy();
});

it("is the only Go on screen while the mic is open", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.getAllByRole("button", { name: "Go" })).toHaveLength(1);
});

it("is absent until there is something to sort, once the mic is closed", async () => {
  const user = await openSheet();
  expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox"), "roof unit is short cycling");
  expect(screen.getAllByRole("button", { name: "Go" })).toHaveLength(1);
});
