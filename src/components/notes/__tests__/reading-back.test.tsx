import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteToken } from "../note-token";
import { NoteScopeProvider } from "../note-context";
import { TiffButton } from "../tiff-button";
import { READING_BACK_NOTE } from "../waits";

/* READING IT BACK, WHEREVER YOU ARE STANDING.

   The gap between the microphone closing and the words arriving is the
   longest silence in a capture — a whole upload and a transcription — and it
   used to be announced by a line of flat grey text. Two different lines, in
   fact: `.wb2-hint` on the capture card, `.wb2-dicthint` on the three
   postures, both the colour of a caption, for the one moment on the screen
   where something is genuinely happening and nothing can be shown for it.

   Every one of them is the same chip now — the orb with the word beside it,
   the same object Tiff's transcript uses while a question is out. Isaac's
   rule: the input section is identical throughout; only where it stands
   changes.

   WHAT THESE PIN is that the wait is announced, in a live region, as text on
   the page — not as an `aria-label` on something decorative, which is what
   the transcript's three dots did and what nobody could see. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

type Cbs = { onTranscript: (t: string, i: { capped: boolean }) => void };
const mockCbs: { current: Cbs | null } = { current: null };
let transcribing = false;

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: (opts: Cbs) => {
      mockCbs.current = opts;
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

jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(async () => ({ ok: false as const, error: "not used here" })),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteForMe: jest.fn(),
  keepNoteOnJob: jest.fn(),
  answerClarify: jest.fn(),
}));

beforeEach(() => {
  transcribing = false;
  mockCbs.current = null;
  localStorage.clear();
});
afterEach(cleanup);

/** Every posture reads voice off the scope, never a prop. */
const mount = (ui: ReactNode) =>
  render(<NoteScopeProvider voiceEnabled>{ui}</NoteScopeProvider>);

/** The chip, wherever it is: one live region carrying the wait as text. */
const chip = () => screen.queryByText(READING_BACK_NOTE);

/* THE CARD KEEPS THE SENTENCE IN ITS RIBBON, so the body shows the sphere and
   nothing else — the same division the recording stage uses, where the ribbon
   says "Recording" and the body shows the clock and the meter without saying
   it again. Giving this stage the postures' full chip was the obvious move
   and it was wrong: rendered, the card read "Reading it back" in the ribbon
   and "Reading it back…" two lines under it. */
describe("the capture sheet", () => {
  const open = async () => {
    mount(<TiffButton where="topbar" />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Ask or tell Tiff/i }));
  };

  /* THE INSTRUMENT IS THE FIELD NOW, and the sentence went with the change:
     nothing on the card names the read-back, because the mark coming apart
     into a cloud is the whole statement. What must NOT go with it is the
     announcement — a field of dots says nothing to a screen reader, so the
     words moved into a live region rather than being deleted. That is the
     distinction this file was written to hold, and it is worth more now than
     it was when the text was visible. */
  it("shows the field in the body and keeps the wait announced, once", async () => {
    transcribing = true;
    await open();

    // the same dots that were the mark, now told to be the cloud
    expect(document.querySelectorAll('.wb2-capfield .dotf[data-stage="cloud"]')).toHaveLength(1);
    // no second instrument underneath it
    expect(document.querySelector(".wb2-waiting")).toBeNull();

    // said once, in a live region, as text on the page — never as a label on
    // something decorative
    expect(screen.getAllByText(READING_BACK_NOTE)).toHaveLength(1);
    expect(chip()!.closest("[role='status']")).not.toBeNull();
    expect(chip()!.closest(".wb2-capribbon")).not.toBeNull();
  });

  it("says nothing about the wait where a sighted reader can see it", async () => {
    transcribing = true;
    await open();
    // the announcement is real, and it is the only copy — so it must be the
    // hidden one, or the sentence is back on the card by another route
    expect(chip()).toHaveClass("wb2-sr");
  });

  it("shows neither while the microphone is not busy", async () => {
    await open();
    expect(document.querySelector(".wb2-waiting")).toBeNull();
    expect(chip()).toBeNull();
  });
});

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
