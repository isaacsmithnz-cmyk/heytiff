import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TiffButton } from "../tiff-button";
import { NoteScopeProvider, NoteScopeScreen, useNoteScope } from "../note-context";

/* ONE WAY IN, IN THE SAME CORNER OF EVERY SCREEN.

   The button is the second half of the argument PR #287 started. That one
   collapsed five CONTROLS into one; this collapses the places you can reach
   it into one, and the interesting consequence is a reversal: the token used
   to sit inside the screen that configured it, and now it sits in the frame
   ABOVE every screen, so screens report up instead of wrapping it.

   That reversal is what these guard. A button that renders perfectly while
   pointed at nothing looks completely fine and quietly files every note
   against the wrong thing — or against nothing at all. */

const start = jest.fn();
jest.mock("../dictation", () => {
  const actual = jest.requireActual("../dictation");
  const react = jest.requireActual("react") as typeof import("react");
  return {
    ...actual,
    useDictation: () => ({
      recording: false,
      transcribing: false,
      interim: "",
      seconds: 0,
      barsRef: react.createRef(),
      start,
      stop: jest.fn(),
      cancel: jest.fn(),
    }),
  };
});

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

const job = (id: string) => ({
  kind: "visit" as const,
  id,
  clientName: "Meridian Data",
  label: "Server room CRACs",
  siteLabel: null,
  jobNumber: "1042",
});

function Probe() {
  const s = useNoteScope();
  return <span data-testid="scope">{`${s.target.kind}|${s.targetLabel ?? "-"}|${s.jobs.length}`}</span>;
}

const mount = (ui?: React.ReactNode, voiceEnabled = true) =>
  render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <Probe />
      {ui}
      <TiffButton />
    </NoteScopeProvider>
  );

const btn = () => screen.getByLabelText(/Ask or tell Tiff/);

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

describe("the button itself", () => {
  it("is one control, not a capsule — it takes anything, so it offers one way in", () => {
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    /* The keyboard|mic pair belonged to the corner capsule this replaced.
       Typing is not hidden by that: the sheet it opens has a textarea in it. */
    expect(document.querySelector(".wb2-tok")).toBeNull();
  });

  it("starts listening the moment it is tapped — there is no mode to pick first", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());

    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the same sheet for typing where the deployment cannot hear", async () => {
    const user = userEvent.setup();
    mount(undefined, false);
    await user.click(btn());

    /* The mic is an enhancement everywhere else in this widget and it is an
       enhancement here: no key means no recording, never a dead button. */
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says what it does rather than naming an icon", () => {
    mount();
    expect(btn()).toHaveAccessibleName("Ask or tell Tiff — starts listening");
    mount(undefined, false);
    expect(screen.getAllByLabelText("Ask or tell Tiff")[0]).toBeInTheDocument();
  });
});

describe("what it is pointed at", () => {
  it("is a universal note taker when nothing has reported in", () => {
    mount();
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|0");
  });

  it("picks up the screen underneath, which is above it in nothing and below it in the tree", () => {
    mount(
      <NoteScopeScreen
        target={{ kind: "project", id: "p-1" }}
        targetLabel="Smith St change-over"
        jobs={[job("v-1"), job("v-2")]}
      />
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("project|Smith St change-over|2");
  });

  /* THE BUG THE TWO SLOTS EXIST FOR. A screen reports its job list; a sheet
     opens over it and reports a target. With one slot the second push replaced
     the first, the job list vanished, and a note taken from the button could
     no longer be pinned to anything on the board behind it. */
  it("lets a sheet re-aim it WITHOUT losing the board's job list", () => {
    const Sheet = () => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-9" }, targetLabel: "Meridian · CRACs" });
        return () => pushFocus(null);
      }, [pushFocus]);
      return null;
    };
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "none" }} jobs={[job("v-1"), job("v-2")]} />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|2");

    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "none" }} jobs={[job("v-1"), job("v-2")]} />
        <Sheet />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|Meridian · CRACs|2");
  });

  it("falls back to the screen when the sheet closes, not to nothing", () => {
    const Sheet = () => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-9" }, targetLabel: "Meridian · CRACs" });
        return () => pushFocus(null);
      }, [pushFocus]);
      return null;
    };
    const tree = (withSheet: boolean) => (
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "project", id: "p-1" }} targetLabel="Smith St" />
        {withSheet && <Sheet />}
        <TiffButton />
      </NoteScopeProvider>
    );
    const { rerender } = render(tree(true));
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|Meridian · CRACs");

    rerender(tree(false));
    expect(screen.getByTestId("scope")).toHaveTextContent("project|Smith St");
  });

  it("stops holding a board once its screen goes away", () => {
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <NoteScopeScreen target={{ kind: "project", id: "p-1" }} jobs={[job("v-1")]} />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("project|-|1");

    /* Navigation, in the shape the frame actually sees it: the screen
       unmounts and the button does not. Leaving the last board's jobs behind
       would offer to pin a note to a job that is no longer on screen. */
    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <TiffButton />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("none|-|0");
  });

  it("does not name a job it was not given — a stale label is worse than none", () => {
    const Aim = ({ label }: { label?: string }) => {
      const { pushFocus } = useNoteScope();
      React.useEffect(() => {
        pushFocus({ target: { kind: "visit", id: "v-1" }, targetLabel: label });
      }, [pushFocus, label]);
      return null;
    };
    const { rerender } = render(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <Aim label="Meridian · CRACs" />
      </NoteScopeProvider>
    );
    expect(screen.getByTestId("scope")).toHaveTextContent("Meridian · CRACs");

    rerender(
      <NoteScopeProvider voiceEnabled>
        <Probe />
        <Aim />
      </NoteScopeProvider>
    );
    act(() => {});
    expect(screen.getByTestId("scope")).toHaveTextContent("visit|-|0");
  });
});
