import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteScopeProvider } from "../note-context";
import { CaptureDoor } from "./fixtures/capture-door";

/* THE CAPTURE SHEET, FROM ITS DOOR.

   These were the Tiff button's tests while it opened the sheet. It opens the
   Tiff modal now (the new Home's, everyone's since 2026-09-26), and the
   modal's own tests hold what a press does; what these hold is the sheet,
   which is still what a field's and a strip's "Have a look" open until the
   old capture UI goes. The door is ./fixtures/capture-door: the button's old
   press, kept to the letter. */

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

const mount = (voiceEnabled = true) =>
  render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <CaptureDoor />
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

describe("the door", () => {
  /* IT OPENED THE WAY YOU LEFT IT, and this line was rewritten twice because
     the answer genuinely changed twice.

     v1 always started the mic ("no mode to choose first"), which made typing
     second-class. v2 never did, and made talking — the common case — cost an
     extra press every time. v3 was your last choice, remembered behind a
     DEFAULT switch. v4 ASKS, every time (Isaac, 2026-08-18): pressing the
     button was a recording before anybody had decided anything, so a mis-tap
     was a live microphone, and the control that could change it was a
     preference sitting in the middle of a capture.

     What still MUST hold, and what these guard, is that the sheet's mic only
     ever opens because somebody pressed a button that says Talk. A tap that
     starts listening for any other reason — or when the deployment cannot
     hear at all — is a privacy bug wearing a UX decision's clothes. */
  it("opens on the choice — pressing the door never starts the mic", async () => {
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
    mount(false);
    await user.click(btn());

    expect(start).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/Tell Luke/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Talk" })).not.toBeInTheDocument();
  });

  /* THE ENTRANCE IS THE DOOR'S OWN. Only the door hands the sheet
     `wb2-blossom` — the clip reveal is anchored where the button lives, so
     from anywhere else (a field's nudge) it would grow out of a corner with
     nothing in it. jsdom can't see the animation; the class is the
     structural fact it CAN pin. */
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
