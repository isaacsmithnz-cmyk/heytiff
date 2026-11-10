import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NoteToken } from "../note-token";
import { NoteScopeProvider } from "../note-context";

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

/** The old "Thinking" chip: it went with the strip (10 November 2026), and
    no box on a page says it now. */
const chip = () => screen.queryByText("Thinking");

describe("the postures on a page", () => {
  /* The phone's box in a form (Isaac, 9 November 2026: "I want the boxes to
     pretty much be identical"): the words stay in the box, grey, and nothing
     says "Thinking"; only a read-back that takes a while says it's fixing
     the wording, as the phone's does. */
  it.each(["field", "line"] as const)("keeps quiet on the %s posture, then says it's fixing the wording", (as) => {
    jest.useFakeTimers();
    try {
      transcribing = true;
      mount(<NoteToken as={as} />);
      expect(chip()).toBeNull();
      expect(screen.queryByText("Fixing the wording")).not.toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1200);
      });
      expect(screen.getByRole("status")).toHaveTextContent("Fixing the wording");
    } finally {
      jest.useRealTimers();
    }
  });

  it("says nothing at all while the microphone is not busy", () => {
    mount(<NoteToken as="field" />);
    expect(chip()).toBeNull();
  });
});
