import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { NoteScopeProvider } from "../note-context";
import { NoteToken } from "../note-token";

/* ── THE FIELD MICS HAND THEIR BOX TO THE RIVER ──

   Same fault as the capture card had, in three more places and worse in two
   of them: a field can only take the sentence as ONE STRING, so every partial
   swapped the lot — and on the two postures that are ONE LINE, a disabled
   input never scrolls, so the words being spoken sat off the right-hand edge
   where nobody could read them at all.

   What replaces the field is a `LiveWords` river wearing the FIELD'S OWN
   CLASS, which is what makes the swap invisible: same width, font, padding
   and border as the box that was there a frame earlier. jsdom cannot measure
   that — it is measured in a browser against the real sheet — so what these
   assert is the half jsdom CAN see: that the box is handed over at the right
   moment, that it carries the field's class, and that it is handed BACK.

   The field is reached by ROLE, not by label: the block posture's textarea is
   named by a wrapping `<label className="wb2-fl">` at every call site, so it
   carries no `aria-label` of its own. The river has to carry one — a wrapping
   label names a form control and gives a paragraph nothing. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: jest.fn() }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteOnJob: jest.fn(),
  keepNoteForMe: jest.fn(),
  answerClarify: jest.fn(),
}));

/** The engine, driveable from the test — `interim` is the whole point here. */
const ctl: { setRecording?: (v: boolean) => void; setInterim?: (v: string) => void } = {};

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      const [recording, setRecording] = react.useState(false);
      const [interim, setInterim] = react.useState("");
      ctl.setRecording = setRecording;
      ctl.setInterim = setInterim;
      return {
        recording,
        arming: false,
        transcribing: false,
        handing: false,
        interim,
        seconds: 3,
        barsRef: react.createRef(),
        start: () => setRecording(true),
        stop: () => setRecording(false),
        handOver: jest.fn(),
        cancel: jest.fn(),
        restart: jest.fn(),
      };
    },
  };
});

afterEach(cleanup);

const mount = (ui: React.ReactElement) =>
  render(<NoteScopeProvider voiceEnabled>{ui}</NoteScopeProvider>);

function Harness({ as, start = "" }: { as: "strip" | "field" | "line"; start?: string }) {
  const [v, setV] = useState(start);
  return <NoteToken as={as} label="access notes" value={v} onChange={setV} />;
}

const river = () => document.querySelector(".wb2-lwbox");

describe.each([
  ["strip", "wb2-stripin", true],
  ["line", "wb2-fi", true],
  ["field", "wb2-notes", false],
] as const)("the %s posture", (as, fieldClass, oneLine) => {
  it("keeps the field while nothing has been heard — the placeholder is the only thing saying it is listening", () => {
    mount(<Harness as={as} />);
    act(() => ctl.setRecording!(true));

    expect(river()).toBeNull();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("hands the box to the river at the first word, in the field's own class", () => {
    mount(<Harness as={as} />);
    act(() => {
      ctl.setRecording!(true);
      ctl.setInterim!("tell Luke the grilles");
    });

    const box = river()!;
    expect(box.className).toContain(fieldClass);
    expect(box.className.includes("one")).toBe(oneLine);
    expect(box).toHaveTextContent("tell Luke the grilles");
    /* And the words are SHOWN, never held — the field is gone, so there is
       nothing left that could commit a half-heard sentence. */
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps what was already typed in front of the words arriving", () => {
    mount(<Harness as={as} start="gate code 4417" />);
    act(() => {
      ctl.setRecording!(true);
      ctl.setInterim!("and the roof key is at the desk");
    });

    expect(river()).toHaveTextContent("gate code 4417 and the roof key is at the desk");
    expect(document.querySelector(".wb2-lwsaid")).toHaveTextContent("gate code 4417");
  });

  /* The words stay on screen through the read-back — `interim` outlasts
     `recording` by the length of the flush. Swapping back to the field for
     that second and then forward again is two moves where the design has
     none. */
  it("holds the river through the read-back, and gives the box back when the words land", () => {
    mount(<Harness as={as} />);
    act(() => {
      ctl.setRecording!(true);
      ctl.setInterim!("tell Luke the grilles");
    });
    act(() => ctl.setRecording!(false));
    expect(river()).not.toBeNull();

    act(() => ctl.setInterim!(""));
    expect(river()).toBeNull();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
