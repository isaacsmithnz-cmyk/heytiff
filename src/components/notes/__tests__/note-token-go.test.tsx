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

/* The fake OPENS AND CLOSES like the real engine, rather than reporting a
   constant. `mic.recording` seeds it, and pressing Talk actually moves the
   card into its recording stage — which is the only way to test what a
   SECOND leg looks like, since the first one has to be started from a box
   with words already in it. A fake that never changes state can only ever
   describe one screen. */
jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      const [rec, setRec] = react.useState(mic.recording);
      return {
        recording: rec,
        transcribing: false,
        interim: "",
        seconds: 3,
        hearing: mic.hearing,
        barsRef: react.createRef(),
        start: () => {
          mockStart();
          setRec(true);
        },
        stop: () => {
          mockStop();
          setRec(false);
        },
        handOver: () => {
          mockHandOver();
          setRec(false);
        },
        cancel: jest.fn(),
        restart: mockRestart,
      };
    },
  };
});

/* OPENING THE SHEET STARTS RECORDING. `DEFAULT_CAPTURE_MODE` is `talk` and
   `tiff-button` acts on it, so the card opens listening — "you click the
   button, it starts hearing you" (Isaac). There is no idle box on open, and
   a fake that ignored the auto-start hid that from this file for a day. */
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

/** Open, then finish the leg the sheet started — the real way to the box. */
const openToBox = async () => {
  const user = await openSheet();
  await user.click(screen.getByRole("button", { name: "Done" }));
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

/* THE RULE, BOTH WAYS ROUND. A Go while the mic is open would be the button
   that started this: the one you press expecting a commit and get a stop. */
it("offers no Go at all while the mic is open", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
});

it("has no Done once the mic is closed", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "roof unit is short cycling");

  expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
});

it("is absent until there is something to sort, once the mic is closed", async () => {
  const user = await openToBox();
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
  await openToBox();
  expect(screen.getByText("Default")).toBeInTheDocument();
});

/* ── KEEP TALKING ──

   Isaac, 2026-08-10: "when you record a message in Claude, you can hit enter,
   then tap the mic again to keep adding."

   The behaviour was already there — every leg appends. What was missing was
   an affordance that said so: with words in the box, the way back to the mic
   was the left half of a switch labelled DEFAULT. A preference control, in
   the strongest position on the row, that happens to start recording.

   So the switch owns the empty box and steps aside once there is something to
   add to. What is pinned here is that the mic never becomes HARDER to reach
   than it was — whichever control is showing, one press starts a leg. */

it("offers the switch on an empty box, where the preference is a fair question", async () => {
  await openToBox();

  expect(screen.getByText("Default")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
});

it("drops the preference for a plain mic once there are words to add to", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");

  expect(screen.queryByText("Default")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
});

/* The point of the whole thing: pressing it starts another leg, and the leg
   appends rather than replacing. The appending itself is pinned in
   note-token-cap; this is the reach. */
it("keeps the mic one press away with words already in the box", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");

  /* A DELTA, NOT A COUNT. Opening this sheet with the stored default on Talk
     already starts a leg (tiff-button), so an absolute number here would be
     asserting the auto-start rather than the button. */
  const before = mockStart.mock.calls.length;
  await user.click(screen.getByRole("button", { name: /talk/i }));

  expect(mockStart).toHaveBeenCalledTimes(before + 1);
});

/* ── A SECOND LEG MUST NOT LOOK LIKE A FIRST ONE ──

   Isaac, 2026-08-10, walking it: "if I click talk, it looks like you're
   starting again because it doesn't show you what text it's already got on
   there."

   It never was starting again — every leg appends and the words were safe in
   `flow.text` throughout. But the recording stage REPLACED the box with the
   trace, so the card hid the only evidence it had kept anything. Showing the
   words back is the difference between "carry on" and "start over", and only
   one of those is true. */

it("shows the words already in the box while a second leg records", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");

  mic.recording = true;
  await user.click(screen.getByRole("button", { name: /talk/i }));

  expect(screen.getByLabelText(/what you have said so far/i)).toHaveValue(
    "middle rooftop unit tripped again"
  );
});

/* And it is a RECORD, not something to edit mid-sentence — the box you can
   type into is the one you come back to when the recording ends. */
it("shows it read-only", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");
  mic.recording = true;
  await user.click(screen.getByRole("button", { name: /talk/i }));

  expect(screen.getByLabelText(/what you have said so far/i)).toHaveAttribute("readonly");
});

/* A FIRST leg has nothing to show, and an empty box in that space would put
   back the hole the audit just closed. */
it("shows nothing back on a first leg with an empty box", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.queryByLabelText(/what you have said so far/i)).not.toBeInTheDocument();
});

it("has no stop square on Done — the word says it", async () => {
  mic.recording = true;
  await openSheet();

  expect(screen.getByRole("button", { name: "Done" }).querySelector("svg")).toBeNull();
});
