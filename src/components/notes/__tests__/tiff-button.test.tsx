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
      handOver: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  /* The capture default is stored, so it outlives a test. Left uncleared,
     one test's "type" decides another test's opening mode and the order of
     the file becomes load-bearing. */
  localStorage.clear();
});
afterEach(cleanup);

describe("the button itself", () => {
  it("is one control, not a capsule — it takes anything, so it offers one way in", () => {
    mount();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    /* The keyboard|mic pair belonged to the corner capsule this replaced.
       Typing is not hidden by that: the sheet it opens has a textarea in it. */
    expect(document.querySelector(".wb2-tok")).toBeNull();
  });

  /* IT OPENS THE WAY YOU LEFT IT, and this line has now been rewritten twice
     because the answer genuinely changed twice.

     v1 always started the mic ("no mode to choose first"), which made typing
     second-class. v2 never did, and made talking — the common case — cost an
     extra press every time. v3 was your last choice, remembered behind a
     DEFAULT switch. v4 ASKS, every time (Isaac, 2026-08-18): pressing the
     button was a recording before anybody had decided anything, so a mis-tap
     was a live microphone, and the control that could change it was a
     preference sitting in the middle of a capture.

     What still MUST hold, and what these guard, is that the mic only ever
     opens because somebody pressed a button that says Talk. A tap that
     starts listening for any other reason — or when the deployment cannot
     hear at all — is a privacy bug wearing a UX decision's clothes. */
  it("opens on the choice — pressing the button never starts the mic", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Type" })).toBeInTheDocument();
    /* Nothing else is on the card yet: no box to type in, nothing to send. */
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
  });

  /* THE MARK STANDS ON THE DOOR (Isaac, 2026-08-18, first walk of it): "I've
     got no animation in there — we should have the chevron animation, like we
     do on the talking screen."

     Two buttons over an empty card was half the fault; the other half was
     that the instrument got BUILT by the press, so choosing Talk grew 268px
     of card under your thumb at the same moment the microphone opened. What
     this pins is the fix for both: the same element, in the same stage, on
     either side of the press — which is the rule the whole field is built on
     (see `stageField` in ../note-token). If a later tidy-up scopes the mark
     back to `recording`, the door goes blank and the press starts jumping
     again.

     THE OTHER SIDE OF THE PRESS IS PINNED IN note-token-go, because it needs
     an engine that actually opens: this file's fake reports `recording:false`
     forever, so a Talk here lands on the box rather than the microphone. */
  it("stands the mark on the door", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());

    /* AND IT ARRIVES RATHER THAN APPEARS (Isaac, 2026-08-18): the dots come
       out of the button you just pressed and fly to their seats, which is the
       `gather` stage. It becomes the resting `mark` when the last one lands —
       see dot-field-gather for the hand-over. */
    expect(document.querySelector('.dotf[data-stage="gather"]')).not.toBeNull();
  });

  /* THE BUTTON HANDS ITS MARK OVER, and cannot still be wearing one while the
     card holds it — two chevrons on screen at once turns a journey into a
     copy. The drain itself is CSS, keyed on `aria-expanded`, which is the
     structural fact jsdom can hold: the attribute is true for exactly as long
     as the sheet is open, so the button empties and refills with it and there
     is no second piece of state to fall out of step. */
  it("reports itself expanded while the sheet has its mark", async () => {
    const user = userEvent.setup();
    mount();
    expect(btn()).toHaveAttribute("aria-expanded", "false");

    await user.click(btn());
    expect(btn()).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByTitle("Discard"));
    expect(btn()).toHaveAttribute("aria-expanded", "false");
  });

  it("Talk opens the microphone in the same press", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Talk" }));

    /* One press, not two. A Talk that only sets a mode and waits is the tax
       the remembered default was invented to avoid. */
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("Type hands over the box, and nothing listens", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Type" }));

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/Tell Luke/)).toBeInTheDocument();
    /* The way back to the microphone stays on the row — changing your mind
       must not cost a close and a re-open. */
    expect(screen.getByRole("button", { name: /talk/i })).toBeInTheDocument();
  });

  it("asks again next time — there is nothing stored to be surprised by", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Type" }));
    await user.click(screen.getByTitle("Discard"));
    await user.click(btn());

    expect(screen.getByRole("button", { name: "Talk" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("skips the door where the deployment cannot hear — a choice with one option is furniture", async () => {
    const user = userEvent.setup();
    mount(undefined, false);
    await user.click(btn());

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/Tell Luke/)).toBeInTheDocument();
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

  /* THE GROW IS MEASURED, NOT GUESSED. It was a clip circle at a hardcoded
     `86% -48px` — right for one viewport width and one card position, and
     wrong the moment the card moved to the middle. The button now measures
     itself and hands the offset in; the keyframe translates the card's
     centre onto the button by exactly that much, so the motion holds at any
     width and wherever the button lives next.

     jsdom renders no animation, but these two numbers ARE the animation's
     input — wrong here and the sheet grows from the wrong place on every
     screen. Everything else about the entrance is already pinned above. */
  it("hands the button's own position to the sheet it grows into", async () => {
    const user = userEvent.setup();
    mount();

    // a 44px button near the top-right, on a 1000×800 window
    window.innerWidth = 1000;
    window.innerHeight = 800;
    btn().getBoundingClientRect = () =>
      ({ left: 900, top: 20, width: 44, height: 44 }) as DOMRect;

    await user.click(btn());

    const dialog = screen.getByRole("dialog");
    // centre (922, 42) minus the viewport centre (500, 400)
    expect(dialog).toHaveStyle({ "--cap-dx": "422px", "--cap-dy": "-358px" });
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

/* ── THE ACTIONS ROW ──
   Three changes Isaac asked for on 2026-08-10, all of them removals of
   something that was in the way. */
describe("the sheet's actions", () => {
  /* There were TWO ways to discard and they did the identical thing —
     `flow.close` — but only one of them was in every stage. The ribbon's ×
     is already labelled "Discard", so this asserts the count rather than
     the absence: exactly one, and it is the × rather than a button in the
     actions row. */
  it("offers exactly one discard, and it is the ribbon's ×", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Type" }));

    const discards = screen.getAllByRole("button", { name: "Discard" });
    expect(discards).toHaveLength(1);
    expect(discards[0]).toHaveClass("wb2-ico");
    expect(discards[0]).not.toHaveClass("pbtn");
  });

  it("holds Go back until there is something to sort", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Type" }));

    /* Absent, not disabled: a dead control is a question you answer every
       time you look at it. */
    expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "chase the grilles");
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("does not count whitespace as something to sort", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(btn());
    await user.click(screen.getByRole("button", { name: "Type" }));

    await user.type(screen.getByRole("textbox"), "   ");
    expect(screen.queryByRole("button", { name: "Go" })).not.toBeInTheDocument();
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
