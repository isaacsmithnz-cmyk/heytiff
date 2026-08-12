import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";

/* ONLY ONE BUTTON IS ALLOWED TO SAY GO.

   This took three passes in a day and the middle one was wrong, which is why
   the rule is written down here rather than left to taste.

   It began as "Stop & read" while recording and "Go" once the words were in
   the box. Isaac, reading a recording on prod: "still says stop and read" —
   two vocabularies on one card. So both became Go. Then he walked the whole
   path and hit the real problem: "annoyingly you have to push go twice." You
   press a button called Go, and nothing goes.

   Both presses stay — nothing routes off a transcript, and that is the point
   of the review, not an accident. But only ONE of them commits anything, so
   only one is called Go. `Done` ends the recording; `Go` files it.

   What this file guards is that the two never swap handlers. If a later
   tidy-up wires one to the other, every label still reads correctly while
   the card files a note nobody has read — which is the exact failure the
   "speaking does not commit" change was built to prevent. */

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
const mic = { recording: false, hearing: false };
const mockStop = jest.fn();
const mockStart = jest.fn();
const mockRestart = jest.fn();
const mockHandOver = jest.fn();

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
        hearing: mic.hearing,
        barsRef: react.createRef(),
        start: mockStart,
        stop: mockStop,
        handOver: mockHandOver,
        cancel: jest.fn(),
        restart: mockRestart,
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
  mic.hearing = false;
});

afterEach(cleanup);

it("ends the recording with Done — and commits nothing", async () => {
  mic.recording = true;
  const user = await openSheet();

  await user.click(screen.getByRole("button", { name: "Done" }));

  expect(mockStop).toHaveBeenCalledTimes(1);
  expect(routeNote).not.toHaveBeenCalled();
});

it("keeps the stop mark beside Done", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.getByRole("button", { name: "Done" }).querySelector("svg")).toBeTruthy();
});

/* THE RULE, BOTH WAYS ROUND. A Go while the mic is open would be the button
   that started this: the one you press expecting a commit and get a stop. */
it("offers no Go at all while the mic is open", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
});

it("has no Done once the mic is closed", async () => {
  const user = await openSheet();
  await user.type(screen.getByRole("textbox"), "roof unit is short cycling");

  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
});

it("is absent until there is something to sort, once the mic is closed", async () => {
  const user = await openSheet();
  expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox"), "roof unit is short cycling");
  expect(screen.getAllByRole("button", { name: "Go" })).toHaveLength(1);
});

/* ── THE RECORDING CARD, AFTER THE AUDIT ──

   The stage used to be a 680 × 201px card that was 86% empty, with a 36px
   meter marooned in the middle of it and the clock hidden in a corner at
   12.5px. What replaced it is pinned here as behaviour rather than pixels:
   the state is said in WORDS, the recovery exists, and the preference
   control is gone while the mic is open. */

it("says whether it is hearing you, in words", async () => {
  mic.recording = true;
  mic.hearing = true;
  await openSheet();
  expect(screen.getByText("Hearing you")).toBeInTheDocument();
});

/* The silent line is the one that matters — it is the answer to the question
   Isaac could not get off a row of 6px dots. */
it("says so when nothing is arriving", async () => {
  mic.recording = true;
  mic.hearing = false;
  await openSheet();
  expect(screen.getByText("Not hearing anything")).toBeInTheDocument();
});

it("offers a way to bin the take and start over", async () => {
  mic.recording = true;
  const user = await openSheet();

  await user.click(screen.getByRole("button", { name: /start again/i }));

  expect(mockRestart).toHaveBeenCalledTimes(1);
  // it is the recovery, not the commit — the recording must not end here
  expect(mockStop).not.toHaveBeenCalled();
  expect(routeNote).not.toHaveBeenCalled();
});

/* The Default switch is about what the Tiff button does NEXT time, and its
   Talk half is already pressed while you are talking. Mid-recording the only
   live-useful half is the way out to the keyboard. */
it("drops the Default switch while the mic is open, keeping the way out", async () => {
  mic.recording = true;
  const user = await openSheet();

  expect(screen.queryByText("Default")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /type instead/i }));
  expect(mockHandOver).toHaveBeenCalledTimes(1);
});

it("brings the switch back the moment the mic closes", async () => {
  await openSheet();
  expect(screen.getByText("Default")).toBeInTheDocument();
});
