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

  /* TYPE OR TALK IS THE PERSON'S CALL, MADE ON THE SHEET. The button used to
     start the mic on its own ("no mode to choose first") and that made typing
     second-class: you arrived recording, and reaching the box meant stopping
     a recording you never asked for. Isaac reversed it with the premium sheet
     (2026-08-08). A tap that quietly opened a mic again would be a privacy
     bug wearing a UX decision's clothes — this is the line that catches it. */
  it("opens ready for either — the tap never starts the mic on its own", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    /* Both doors, on the same sheet: the box for typing, Talk for the mic. */
    expect(screen.getByPlaceholderText(/Tell Luke/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk" })).toBeInTheDocument();
  });

  it("opens the same sheet minus the Talk door where the deployment cannot hear", async () => {
    const user = userEvent.setup();
    mount(undefined, false);
    await user.click(btn());

    /* The mic is an enhancement everywhere else in this widget and it is an
       enhancement here: no key means no Talk button, never a dead one. */
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Talk" })).not.toBeInTheDocument();
  });

  /* THE ENTRANCE IS THE BUTTON'S OWN. Only the Tiff button hands the sheet
     `wb2-blossom` — the clip reveal is anchored where the button lives, so
     from anywhere else (a field's nudge, the debrief) it would grow out of
     a corner with nothing in it. jsdom can't see the animation; the class
     is the structural fact it CAN pin. */
  it("blossoms out of its own corner — the sheet carries the entrance class", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("wb2-blossom");
    /* And it opens wearing the dusk skin: capture is the dark half; the
       review, when it comes, hands back to the light work surface. */
    expect(dialog).toHaveClass("wb2-dusk");
  });

  /* IT RENDERS WHERE IT IS PUT. It portalled to body for one commit, when it
     floated bottom-right: inside `.fg` a fixed overlay is unreachable under a
     sheet's scrim at ANY z-index (measured — a probe at 2147483647 still
     loses), so a floating version had to leave the frame.

     Moving it into the topbar dissolved that problem rather than solving it.
     It is chrome now, and chrome dimming under a modal is what chrome does —
     so it renders in place, and only the SHEET it opens still portals. */
  it("renders in place — it is chrome, not an overlay", () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <div className="tbr">
          <TiffButton />
        </div>
      </NoteScopeProvider>
    );
    expect(btn().closest(".tbr")).not.toBeNull();
    expect(btn().parentElement).not.toBe(document.body);
  });

  /* THE SHEET VARIANT. Nothing outside a sheet's scrim can be clicked, so the
     topbar button is unreachable the moment a job opens — which killed the one
     case the context tag exists for. Isaac's fix: a button ON the sheet. It is
     the same component and the same flow; only the ground changes, so only the
     skin does. */
  it("wears the sheet skin, and says what it will be about", () => {
    render(
      <NoteScopeProvider voiceEnabled>
        <NoteScopeScreen target={{ kind: "visit", id: "v-1" }} targetLabel="Server room CRACs" />
        <TiffButton where="sheet" />
      </NoteScopeProvider>
    );
    const el = screen.getByLabelText("Ask or tell Tiff about Server room CRACs");
    expect(el).toHaveClass("tiffbtn-sheet");
    /* The core holds the mark's contrast on a WHITE sheet; the halo is the
       topbar's answer to a black one. Wearing both would be wrong twice. */
    expect(el.querySelector(".tiffbtn-core")).not.toBeNull();
    expect(el.querySelector(".tiffbtn-halo")).toBeNull();
  });

  it("keeps the topbar skin on the topbar — glow, no core", () => {
    mount();
    const el = btn();
    expect(el).toHaveClass("tiffbtn-topbar");
    expect(el.querySelector(".tiffbtn-halo")).not.toBeNull();
    expect(el.querySelector(".tiffbtn-core")).toBeNull();
  });

  it("says what it does rather than naming an icon", () => {
    mount();
    /* No "— starts listening" suffix any more: it doesn't. The name promising
       a recording that no longer happens would be the worse kind of stale. */
    expect(btn()).toHaveAccessibleName("Ask or tell Tiff");
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
