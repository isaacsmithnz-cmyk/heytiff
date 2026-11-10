/* THE ONE TOKEN, held still.

   What is left of it is what fills a box: the line in a visit sheet, the
   field in every sheet and modal that takes a note.
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
import { Field } from "@/components/parts/field";

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
    mount(<FieldHarness />, { staffFirstNames: ["Lyle"] });
    await userEvent.type(
      screen.getByRole("textbox"),
      "Tell Lyle he needs to order the grilles before Monday"
    );
    expect(screen.queryByText(/something to do in this/)).not.toBeInTheDocument();
  });
});

/* 7 November 2026: the forms' boxes took the microphone (Isaac: "Fix all of
   those"), and a form's box is parts/field's TextArea, tied to its label and
   its error by the Field round it. Standing in a Field the field posture
   wears that box; anywhere else it is the sheets' `.wb2-notes` as ever. */
describe("the field, standing in a form's Field", () => {
  function InForm({ error }: { error?: string }) {
    const [v, setV] = useState("");
    return (
      <Field label="What needs doing" error={error}>
        <NoteToken as="field" label="what needs doing" offer={false} value={v} onChange={setV} box={{ maxLength: 20 }} />
      </Field>
    );
  }

  it("is the phone's box, named by the form's label, with the microphone inside it", async () => {
    mount(<InForm />);
    const box = screen.getByLabelText("What needs doing");
    expect(box).toHaveClass("say-words");
    expect(box.closest(".say-box")).toContainElement(screen.getByRole("button", { name: "Speak instead of typing — what needs doing" }));
    expect(box).toHaveAttribute("maxLength", "20");
    expect(screen.getByRole("button", { name: "Speak instead of typing — what needs doing" })).toBeInTheDocument();
    await userEvent.type(box, "Order the grilles");
    expect(box).toHaveValue("Order the grilles");
  });

  it("wears the Field's red edge and points at why", () => {
    mount(<InForm error="Say what needs doing." />);
    const box = screen.getByLabelText("What needs doing");
    expect(box.closest(".say-box")).toHaveClass("say-box--bad");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription("Say what needs doing.");
  });

  it("is the same box outside a Field, named by its own label", () => {
    mount(<NoteToken as="field" label="access notes" value="" onChange={() => {}} box={{ "aria-label": "Access notes" }} />);
    const box = screen.getByRole("textbox", { name: "Access notes" });
    expect(box).toHaveClass("say-words");
    expect(box).not.toHaveAttribute("aria-invalid");
  });
});
