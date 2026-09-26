/* THE ONE TOKEN, held still.

   What is left of it is what fills a box: the strip on a job card, the line
   in a visit sheet, the field in every sheet and modal that takes a note.
   The capture card it used to open — the door, the review, the cascade and
   the Diary's entry row — went with the old capture UI (2026-09-27); the
   Tiff modal's own suite holds what Tiff does with words now. These hold
   the two things the postures still promise:

     · the STRIP commits instantly. A job card's note row must never make
       somebody wait for Tiff to write down a gate code.
     · the OFFER is an offer. Words that smell like work get a quiet line,
       and only "Have a look" hands them to Tiff — the modal, opened on
       them. */

import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoteToken } from "../note-token";
import { NoteScopeProvider, NoteScopeScreen } from "../note-context";
import { TiffContext, type TiffApi, type TiffOpen } from "@/components/tiff/modal/tiff-context";

/** The modal's door, as every Tiff button and offer reaches it. */
const open = jest.fn((_o: TiffOpen) => true);
const tiff: TiffApi = { open: (o) => open(o), openedBy: null, isOpen: false, landed: null };

/* The app's real shape: the layout provides the scope once, and the screen
   underneath REPORTS UP into it; the Tiff modal's host is mounted round every
   screen in the same frame. */
function mount(
  ui: React.ReactElement,
  scope: Partial<React.ComponentProps<typeof NoteScopeScreen>> & { voiceEnabled?: boolean } = {}
) {
  const { voiceEnabled = true, ...screen } = scope;
  return render(
    <NoteScopeProvider voiceEnabled={voiceEnabled}>
      <TiffContext.Provider value={tiff}>
        <NoteScopeScreen {...screen} />
        {ui}
      </TiffContext.Provider>
    </NoteScopeProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  open.mockImplementation(() => true);
});

describe("the line — a visit's one-line note", () => {
  function Line() {
    const [v, setV] = useState("");
    const committed = useRef<string[]>([]);
    return (
      <>
        <NoteToken
          as="line"
          label="a packing item"
          value={v}
          onChange={setV}
          onCommit={() => {
            committed.current.push(v);
            setV("");
          }}
        />
        <output data-testid="committed">{committed.current.join("|")}</output>
      </>
    );
  }

  /* the strip's rule, in the other one-line posture: never a + that won't press */
  it("puts the cursor in the field when + is pressed empty, and adds once there are words", async () => {
    mount(<Line />);
    const add = screen.getByLabelText("Add — a packing item");
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(screen.getByLabelText("a packing item")).toHaveFocus();
    expect(screen.getByTestId("committed")).toHaveTextContent("");

    await userEvent.type(screen.getByLabelText("a packing item"), "Isolator 20A");
    await userEvent.click(add);
    expect(screen.getByTestId("committed")).toHaveTextContent("Isolator 20A");
  });
});

describe("the strip — a job card's note row", () => {
  function Harness() {
    const [v, setV] = useState("");
    const committed = useRef<string[]>([]);
    return (
      <>
        <NoteToken
          as="strip"
          label="a note for this visit"
          value={v}
          onChange={setV}
          onCommit={() => {
            committed.current.push(v);
            setV("");
          }}
        />
        <output data-testid="committed">{committed.current.join("|")}</output>
      </>
    );
  }

  const WORK = "Tell Luke he needs to order the grilles before Monday";

  it("COMMITS INSTANTLY — writing a gate code must never wait on Tiff", async () => {
    mount(<Harness />);
    await userEvent.type(screen.getByLabelText("a note for this visit"), "Gate code 4417");
    await userEvent.click(screen.getByLabelText("Add a note for this visit"));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByTestId("committed")).toHaveTextContent("Gate code 4417");
  });

  /* The + was disabled until something was typed, and a + beside a
     microphone that won't press reads as broken — Isaac, on the job card's
     diary: "it doesn't let me select it". Pressed empty, it puts the cursor
     where the note goes and adds nothing. */
  it("answers a press with nothing typed by putting the cursor in the field", async () => {
    mount(<Harness />);
    const add = screen.getByLabelText("Add a note for this visit");
    expect(add).toBeEnabled();
    expect(add).not.toHaveClass("go");
    await userEvent.click(add);
    expect(screen.getByLabelText("a note for this visit")).toHaveFocus();
    expect(screen.getByTestId("committed")).toHaveTextContent("");

    /* and it says it's ready the moment there is something to add */
    await userEvent.type(screen.getByLabelText("a note for this visit"), "Gate code 4417");
    expect(add).toHaveClass("go");
  });

  it("Enter commits too, and still doesn't open Tiff", async () => {
    mount(<Harness />);
    await userEvent.type(screen.getByLabelText("a note for this visit"), "Roof key at the desk{Enter}");
    expect(screen.getByTestId("committed")).toHaveTextContent("Roof key at the desk");
    expect(open).not.toHaveBeenCalled();
  });

  it("offers Tiff only once the words look like a job for somebody", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(screen.getByLabelText("a note for this visit"), `${WORK}{Enter}`);
    expect(await screen.findByText(/something to do in this/)).toBeInTheDocument();
    /* Still nothing opened — the offer is an offer. */
    expect(open).not.toHaveBeenCalled();
  });

  it("ignoring the offer costs nothing and leaves nothing behind", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(screen.getByLabelText("a note for this visit"), `${WORK}{Enter}`);
    await screen.findByText(/something to do in this/);
    await userEvent.click(screen.getByLabelText(/leave it as a note/));
    expect(screen.queryByText(/something to do in this/)).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  /* (F) It opened the capture card's review on the words until that went;
     it opens the Tiff modal on them now, with the same words as its first
     turn, and focus comes back to the field the offer stood under. */
  it("taking the offer opens the Tiff modal on the committed words", async () => {
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(screen.getByLabelText("a note for this visit"), `${WORK}{Enter}`);
    await screen.findByText(/something to do in this/);
    const look = screen.getByRole("button", { name: "Have a look" });
    await userEvent.click(look);

    expect(open).toHaveBeenCalledTimes(1);
    /* One by one, by identity: a matcher that walks a DOM node's properties
       walks the whole document behind it. */
    const o = open.mock.calls[0][0];
    expect(o.words).toBe(WORK);
    expect(o.from).toBe(look);
    expect(o.back).toBe(screen.getByLabelText("a note for this visit"));
    expect(o.keyboard).toBe(false);
    // the offer is taken, so it goes
    expect(screen.queryByText(/something to do in this/)).toBeNull();
  });

  it("keeps the offer when the modal could not open", async () => {
    /* One is already open: nothing took the words, so nothing is lost. */
    open.mockImplementation(() => false);
    mount(<Harness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(screen.getByLabelText("a note for this visit"), `${WORK}{Enter}`);
    await userEvent.click(await screen.findByRole("button", { name: "Have a look" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/something to do in this/)).toBeInTheDocument();
  });
});

describe("the field", () => {
  function FieldHarness() {
    const [v, setV] = useState("");
    return <NoteToken as="field" label="access notes" value={v} onChange={setV} />;
  }

  it("is a plain box you can type into, mic or no mic", async () => {
    mount(<FieldHarness />, { voiceEnabled: false });
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "Gate code 4417");
    expect(box).toHaveValue("Gate code 4417");
    expect(screen.queryByLabelText(/Dictate/)).not.toBeInTheDocument();
  });

  it("says nothing about typed words — the sieve is for dictation", async () => {
    mount(<FieldHarness />, { staffFirstNames: ["Luke"] });
    await userEvent.type(
      screen.getByRole("textbox"),
      "Tell Luke he needs to order the grilles before Monday"
    );
    expect(screen.queryByText(/something to do in this/)).not.toBeInTheDocument();
  });
});
