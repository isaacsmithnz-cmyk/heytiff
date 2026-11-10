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

/** The engine, driveable from the test — `interim` is the whole point here. */
const ctl: { setRecording?: (v: boolean) => void; setInterim?: (v: string) => void; setTranscribing?: (v: boolean) => void } = {};

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      const [recording, setRecording] = react.useState(false);
      const [interim, setInterim] = react.useState("");
      const [transcribing, setTranscribing] = react.useState(false);
      ctl.setRecording = setRecording;
      ctl.setInterim = setInterim;
      ctl.setTranscribing = setTranscribing;
      return {
        recording,
        arming: false,
        transcribing,
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

function Harness({ as, start = "" }: { as: "field" | "line"; start?: string }) {
  const [v, setV] = useState(start);
  return <NoteToken as={as} label="access notes" value={v} onChange={setV} />;
}

const river = () => document.querySelector(".wb2-lwbox");

/* ── THE FORM BOXES ARE THE PHONE'S (heytiff-mobile SayBox.tsx; Isaac, 9
   November 2026: "I want the boxes to pretty much be identical") ──
   Speaking, the words stand on their own over the bar, "Listening" until the
   first; at ■ they go back into the box, grey, until they land. */
describe.each([["line"], ["field"]] as const)("the %s posture", (as) => {
  it("says it is listening until the first word, over the bar", () => {
    mount(<Harness as={as} />);
    act(() => ctl.setRecording!(true));

    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    expect(screen.getByRole("group", { name: "Recording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Throw it away" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the words as they're said, after what was typed", () => {
    mount(<Harness as={as} start="gate code 4417" />);
    act(() => {
      ctl.setRecording!(true);
      ctl.setInterim!("and the roof key is at the desk");
    });

    expect(river()).toHaveTextContent("gate code 4417 and the roof key is at the desk");
    expect(document.querySelector(".wb2-lwsaid")).toHaveTextContent("gate code 4417");
  });

  it("keeps the words in the box, grey, until they land", () => {
    mount(<Harness as={as} />);
    act(() => {
      ctl.setRecording!(true);
      ctl.setInterim!("tell Lyle the grilles");
    });
    act(() => {
      ctl.setRecording!(false);
      ctl.setTranscribing!(true);
    });
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue("tell Lyle the grilles");
    expect(box).toHaveClass("say-words--hearing");
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();

    act(() => {
      ctl.setTranscribing!(false);
      ctl.setInterim!("");
    });
    expect(screen.getByRole("textbox")).not.toHaveClass("say-words--hearing");
  });
});
