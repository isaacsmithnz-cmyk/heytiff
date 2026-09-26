import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NoteToken } from "../note-token";
import { NoteScopeProvider } from "../note-context";
import { READING_BACK_NOTE } from "../waits";

/* READING IT BACK, WHEREVER YOU ARE STANDING.

   The gap between the microphone closing and the words arriving is the
   longest silence in a capture — a whole upload and a transcription — and it
   used to be announced by a line of flat grey text. Two different lines, in
   fact: `.wb2-hint` on the capture card, `.wb2-dicthint` on the three
   postures, both the colour of a caption, for the one moment on the screen
   where something is genuinely happening and nothing can be shown for it.

   Every one of them is the same chip now — the mark working, with the word
   beside it, the same object Tiff's transcript uses while a question is out.
   Isaac's rule: the input section is identical throughout; only where it
   stands changes. (The capture card itself went with the old capture UI,
   2026-09-27, and its hidden announcement with it.)

   WHAT THESE PIN is that the wait is announced, in a live region, as text on
   the page — not as an `aria-label` on something decorative, which is what
   the transcript's three dots did and what nobody could see. */

let transcribing = false;

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      return {
        recording: false,
        transcribing,
        interim: "",
        seconds: 0,
        hearing: false,
        barsRef: react.createRef(),
        start: jest.fn(),
        stop: jest.fn(),
        handOver: jest.fn(),
        cancel: jest.fn(),
        restart: jest.fn(),
      };
    },
  };
});

beforeEach(() => {
  transcribing = false;
});
afterEach(cleanup);

/** Every posture reads voice off the scope, never a prop. */
const mount = (ui: ReactNode) =>
  render(<NoteScopeProvider voiceEnabled>{ui}</NoteScopeProvider>);

/** The chip, wherever it is: one live region carrying the wait as text. */
const chip = () => screen.queryByText(READING_BACK_NOTE);

describe("the postures on a page", () => {
  /* All three wear the same chip in the same slot the grey line held, so the
     row does not move when the mic closes. `line` is checked as well as
     `field` because it was the one that rendered its hint as a <span> rather
     than a <p> — a difference that meant nothing visually and would have been
     one more thing to keep in step by hand. */
  it.each(["field", "line", "strip"] as const)("names the wait on the %s posture", async (as) => {
    transcribing = true;
    mount(<NoteToken as={as} />);

    const said = chip();
    expect(said).not.toBeNull();
    expect(said!.closest("[role='status']")).not.toBeNull();
  });

  it("says nothing at all while the microphone is not busy", () => {
    mount(<NoteToken as="field" />);
    expect(chip()).toBeNull();
  });

  /* NO PUNCTUATION IN THE STRING. The ellipsis is `.orb-say b::after`, so
     every wait in the app trails off identically and a test matches the
     sentence rather than a particular run of dots. */
  it("carries no ellipsis of its own", () => {
    expect(READING_BACK_NOTE).not.toMatch(/[….]/);
  });
});
