import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NoteToken } from "../note-token";
import { NoteScopeProvider } from "../note-context";

/* "IS THIS THING HEARING ME?" — asked on every surface, answered on one.

   The meter carries three readings: the sphere turns because the microphone
   is open and grows because you are loud, the clock proves time is passing,
   and a line says the state in words. The third one is the one people
   actually ask for, and until now it existed only on the capture card. The
   three postures that live on a page — a strip beside a job, a dictation bar,
   an add row — showed an orb and a clock and stopped there.

   They render the card's own meter now, compact: same component, laid along a
   line instead of stacked in a hero card.

   WHAT THESE PIN is that all three readings reach all three rows. The layout
   is the stylesheet's and is checked in a browser, not here — jsdom has no
   widths — but WHICH FACTS ARE ON SCREEN is ours, and it is the thing that
   was missing rather than merely small. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

let recording = false;

jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  return {
    ...actual,
    useDictation: () => {
      const react = jest.requireActual("react") as typeof import("react");
      return {
        recording,
        transcribing: false,
        interim: "",
        seconds: 7,
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
  routeNote: jest.fn(),
  applyNote: jest.fn(),
  dismissNote: jest.fn(),
  keepNoteForMe: jest.fn(),
  keepNoteOnJob: jest.fn(),
  answerClarify: jest.fn(),
}));

beforeEach(() => {
  recording = false;
  localStorage.clear();
});
afterEach(cleanup);

const mount = (ui: ReactNode) =>
  render(<NoteScopeProvider voiceEnabled>{ui}</NoteScopeProvider>);

const POSTURES = ["strip", "field", "line"] as const;

describe("a posture with the microphone open", () => {
  /* The meter is one component, so this is really asking whether each row
     mounts it at all — which is exactly what was wrong: three rows had
     hand-written orb-and-clock pairs and no way to grow a third reading. */
  it.each(POSTURES)("gives the %s row all three readings", (as) => {
    recording = true;
    const { container } = mount(<NoteToken as={as} />);

    // the sphere, driven by real samples
    expect(screen.getByLabelText("Listening")).toBeInTheDocument();
    // the clock, proving time is passing at all
    expect(screen.getByText("0:07")).toBeInTheDocument();
    // …and the state, in words — the reading none of these rows had
    expect(screen.getByText("Not hearing anything")).toBeInTheDocument();
    // all three inside the card's own meter, compact
    expect(container.querySelectorAll(".wb2-recwave.compact")).toHaveLength(1);
  });

  it.each(POSTURES)("shows the %s row nothing at all while the mic is shut", (as) => {
    const { container } = mount(<NoteToken as={as} />);

    expect(screen.queryByLabelText("Listening")).not.toBeInTheDocument();
    expect(screen.queryByText(/hearing/i)).not.toBeInTheDocument();
    expect(container.querySelector(".wb2-recwave")).toBeNull();
  });

  /* NEVER CLAIM DEAFNESS IT CANNOT PROVE. `hearing` is false both when the
     room is quiet and when the meter could not start at all, so the silent
     line says only that nothing is arriving — true either way. The wording
     has to stay this careful; "microphone not working" would be a diagnosis
     the engine never made. */
  it("says only that nothing is arriving, never that the mic is broken", () => {
    recording = true;
    mount(<NoteToken as="field" />);

    const said = screen.getByText("Not hearing anything");
    expect(said).toHaveAttribute("aria-live", "polite");
    expect(said.textContent).not.toMatch(/broken|fail|error|not work/i);
  });
});
