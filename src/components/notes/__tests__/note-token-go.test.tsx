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

/* THE SHEET OPENS ON THE DOOR, and Talk is what starts the recording —
   pressing the button itself no longer does (see `choice` in ../note-flow).
   Everything below is about what happens once you have chosen to talk, so
   the helper presses it. A fake that ignored the auto-start hid the old
   shape from this file for a day; the same rule applies to the new one.  */
/* THE MARK, ARRIVING OR ARRIVED. Opened from the button the field spends its
   first 1.4s as `gather` — the dots flying out of the button and into their
   seats — and settles to `mark`. Both are the instrument standing there; only
   one of them is still moving, and no test in this file is about which. */
const MARK_UP = '.dotf[data-stage="gather"], .dotf[data-stage="mark"]';

const openSheet = async () => {
  const user = userEvent.setup();
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffButton />
    </NoteScopeProvider>
  );
  await user.click(screen.getByLabelText(/Ask or tell Tiff/));
  /* Tests that seed `mic.recording` open past the door; the rest have to
     walk through it. Matched on the door's own row rather than the word,
     because an idle box carries a Talk button too. */
  const door = document.querySelector<HTMLElement>(".wb2-capdoor .pbtn");
  if (door) await user.click(door);
  return user;
};

/** Open, then finish the leg the sheet started — the real way to the box. */
const openToBox = async () => {
  const user = await openSheet();
  await user.click(screen.getByRole("button", { name: "Done" }));
  return user;
};

/** The OTHER way to the box: through the door's second button, without ever
    opening the microphone. This is the path Isaac walked on 2026-08-18, and
    the only one where "Keep talking" is a lie. */
const openTyping = async () => {
  const user = userEvent.setup();
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffButton />
    </NoteScopeProvider>
  );
  await user.click(screen.getByLabelText(/Ask or tell Tiff/));
  await user.click(screen.getByRole("button", { name: /^type$/i }));
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
   the recovery exists, and the preference control is gone while the mic is
   open. */

/* THE CARD DOES NOT NARRATE ITS OWN SENSES. A line under the clock used to
   read "HEARING YOU" / "NOT HEARING ANYTHING" — written for the five-bar
   meter, which could not show either. The orb shows both by turning and
   swelling, and the words read as a product hedging about whether it works
   (Isaac: "it just looks like it's not a reliable product if it has to
   suggest it"). This is the only place that claim is pinned, because it is
   the one worth keeping: the instrument demonstrates, it does not disclaim. */
it("shows the instrument without commentary on whether it can hear", async () => {
  mic.recording = true;
  await openSheet();

  /* The instrument is the mark itself now rather than the sphere, and it is
     decorative — the stage is named by the ribbon above it, so the field has
     no label of its own to find. What has not changed, and is the whole point
     of this test, is that nothing anywhere says a word about whether the
     microphone is working.

     `gather` because the sheet was opened from the button and the mark is
     still flying in from it; it becomes `mark` when the last dot lands. Either
     way it is the same element and the same instrument — see MARK_UP. */
  expect(document.querySelector(MARK_UP)).not.toBeNull();
  expect(screen.queryByText(/hearing/i)).not.toBeInTheDocument();
});

/* AND IT WAS ALREADY THERE BEFORE THE PRESS. The door stands on the same
   mark (pinned at the door end in tiff-button), so `Talk` swaps the row of
   buttons for the recording card and leaves the instrument exactly where it
   was. Getting this wrong is not just a missing animation — the field is
   268px, so building it on the press means the card grows under your thumb at
   the moment the microphone opens.

   THE SAME NODE, not merely the same selector. A field re-mounted by the
   stage change would restart the arrival from the button halfway through it,
   which is exactly the cut this arrangement exists to prevent, and no
   assertion about markup can see the difference. */
it("carries the same mark from the door into the recording", async () => {
  const user = userEvent.setup();
  render(
    <NoteScopeProvider voiceEnabled>
      <TiffButton />
    </NoteScopeProvider>
  );
  await user.click(screen.getByLabelText(/Ask or tell Tiff/));
  const field = document.querySelector(MARK_UP);
  expect(field).not.toBeNull();

  await user.click(screen.getByRole("button", { name: "Talk" }));
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  expect(document.querySelector(MARK_UP)).toBe(field);
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

/* Mid-recording the only live-useful control on that row is the way out to
   the keyboard. It used to have to share the row with a DEFAULT switch whose
   Talk half was already pressed while you were talking; the switch is gone
   with the stored preference (the card asks at the door now), and what it was
   competing with is what is left. */
it("keeps the way out to the keyboard while the mic is open", async () => {
  mic.recording = true;
  const user = await openSheet();

  await user.click(screen.getByRole("button", { name: /type instead/i }));
  expect(mockHandOver).toHaveBeenCalledTimes(1);
});

it("comes back to a box with the mic one press away", async () => {
  await openToBox();
  expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
  /* And nothing about a stored default: the choice is asked at the door and
     never remembered. */
  expect(screen.queryByText("Default")).not.toBeInTheDocument();
});

/* ── KEEP TALKING ──

   Isaac, 2026-08-10: "when you record a message in Claude, you can hit enter,
   then tap the mic again to keep adding."

   The behaviour was already there — every leg appends. What was missing was
   an affordance that said so: with words in the box, the way back to the mic
   was the left half of a switch labelled DEFAULT. A preference control, in
   the strongest position on the row, that happens to start recording. (That
   switch is gone entirely now — the card asks Talk or Type at the door and
   stores nothing.)

   What is pinned here is that the mic never becomes HARDER to reach than it
   was: whichever control is showing, one press starts a leg. */

it("keeps a plain mic on an empty box", async () => {
  await openToBox();
  expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
});

/* KEEP TALKING IS ABOUT THE VOICE, NOT THE BOX (Isaac, 2026-08-18, first walk
   of the door): "if I hit Type instead, when I'm on the typing screen it says
   Keep talking, which isn't correct."

   The label used to read the box, which was the whole truth while every
   capture began at the microphone. With a door on the front a full box is
   just as likely to be one you typed, and the button was inviting people to
   carry on with something they had never started. What is spoken is pinned in
   note-token-cap, where transcripts actually arrive; what is pinned here is
   the half that was wrong. */
it("says Switch to talk over a box that was only ever typed", async () => {
  const user = await openTyping();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");

  expect(screen.getByRole("button", { name: "Switch to talk" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /keep talking/i })).not.toBeInTheDocument();
});

/* A RECORDING THAT SAID NOTHING IS STILL NOTHING SAID. Pressing Talk and then
   Done without a word reaching the box leaves the capture with no voice in
   it, and the mic must not claim otherwise just because the microphone was
   once open. (The fake engine delivers no transcript, which is exactly that
   case.) */
it("says Switch to talk after a recording that produced no words", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");

  expect(screen.getByRole("button", { name: "Switch to talk" })).toBeInTheDocument();
});

/* THE PLACE STILL CHANGES WITH THE BOX (Isaac, 2026-08-10: "just says TALK on
   the left which is not very helpful — change to keep talking and be on the
   right"). The left edge is where this row keeps its settings; once there are
   words the mic is an action and belongs beside Go, whichever of the two
   words it is showing. Pinned via the class that drops the left anchor —
   jsdom cannot measure where flex puts it, but it can prove which rule
   applies. */
it("moves the mic off the settings edge once there are words", async () => {
  const user = await openTyping();
  expect(screen.getByRole("button", { name: "Talk" })).not.toHaveClass("wb2-keeptalk");

  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");
  expect(screen.getByRole("button", { name: "Switch to talk" })).toHaveClass("wb2-keeptalk");
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

  expect(screen.getByLabelText(/what you have said so far/i)).toHaveTextContent(
    "middle rooftop unit tripped again"
  );
});

/* And it is a RECORD, not something to edit mid-sentence — the box you can
   type into is the one you come back to when the recording ends.

   It used to be a read-only TEXTAREA, which is what made the live words
   jumpy: a textarea can only take the sentence as one string, so every
   partial swapped the lot and the per-word glide could not run inside it.
   The record is ink now, so "not editable" is no longer an attribute to
   assert — it is that there is no field on the card at all. */
it("offers nothing to type into while it records", async () => {
  const user = await openToBox();
  await user.type(screen.getByRole("textbox"), "middle rooftop unit tripped again");
  mic.recording = true;
  await user.click(screen.getByRole("button", { name: /talk/i }));

  expect(screen.getByLabelText(/what you have said so far/i).tagName).toBe("P");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
