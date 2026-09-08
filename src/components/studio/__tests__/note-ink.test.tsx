/* The ink the NEXT note is drawn in.

   It used to be `useState` in the editor, which meant two things Isaac hit:
   choosing a colour from the swatch row inside an open note told the bench
   nothing, so the following note came out graphite again — and the whole thing
   died on any reload, which for a design surface somebody sits in for an hour
   is a deploy away.

   These pin the STORE. The two doors that write to it are pinned where each
   one lives: the bench's in `canvas-note.test.tsx` ("draws the next note in
   the armed ink"), the editor's beside it ("arms the picked ink for the NEXT
   note"). The last test here is the seam between them — that the bench asks
   this store rather than remembering on its own. */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useArmedInk, setArmedInk } from "../note-ink";
import { Studio } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { DEFAULT_NOTE_INK, NOTE_INKS } from "@/lib/studio/notes";

const PLUM = NOTE_INKS.find((k) => k.id === "plum")!;
const WINE = NOTE_INKS.find((k) => k.id === "wine")!;

function Harness() {
  return <output data-testid="ink">{useArmedInk()}</output>;
}

beforeEach(() => {
  localStorage.clear();
});

describe("the armed ink", () => {
  /* Graphite is the HUELESS one, and that is the point of it being the
     default: it cannot read as any system's pipework, however many colours a
     design grows. Asserted as the palette's first entry rather than as a hex
     so a retune of the ladder does not have to come here. */
  it("starts at the default, which is the head of the palette", () => {
    render(<Harness />);
    expect(screen.getByTestId("ink")).toHaveTextContent(DEFAULT_NOTE_INK);
    expect(DEFAULT_NOTE_INK).toBe(NOTE_INKS[0].hex);
  });

  it("survives the reload that used to lose it", () => {
    setArmedInk(PLUM.hex);
    expect(localStorage.getItem("ht-note-ink")).toBe(PLUM.hex);

    render(<Harness />); // a fresh mount is what a reload looks like from here
    expect(screen.getByTestId("ink")).toHaveTextContent(PLUM.hex);
  });

  /* Deliberately the OPPOSITE of `noteInkOf`, which validates well-formedness
     only so a note printed a year from now keeps the colour it was drawn in. A
     drawn note is a record; the armed ink is a control, and a control cannot
     light up a swatch that is no longer in the row. */
  it("falls back when the stored colour has left the palette", () => {
    localStorage.setItem("ht-note-ink", "#123456");
    render(<Harness />);
    expect(screen.getByTestId("ink")).toHaveTextContent(DEFAULT_NOTE_INK);
  });

  it("falls back on junk rather than arming it", () => {
    localStorage.setItem("ht-note-ink", "not a colour");
    render(<Harness />);
    expect(screen.getByTestId("ink")).toHaveTextContent(DEFAULT_NOTE_INK);
  });

  it("follows the same choice made in another tab", () => {
    render(<Harness />);
    expect(screen.getByTestId("ink")).toHaveTextContent(DEFAULT_NOTE_INK);

    act(() => {
      localStorage.setItem("ht-note-ink", WINE.hex);
      window.dispatchEvent(new StorageEvent("storage", { key: "ht-note-ink" }));
    });

    expect(screen.getByTestId("ink")).toHaveTextContent(WINE.hex);
  });
});

/* THE SEAM. Everything above is the store and everything in canvas-note.test
   is the canvas; this is the one assertion that the bench actually asks the
   store instead of keeping its own copy — which is exactly what it did before,
   and exactly why a reload lost the colour. */
describe("the bench", () => {
  it("opens armed in the ink this machine last chose", async () => {
    localStorage.setItem("ht-note-ink", WINE.hex);
    const user = userEvent.setup();
    render(<Studio store={new LocalDesignStore(window.localStorage)} />);

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByPlaceholderText(/Design name/), "Ink seam");
    await user.click(screen.getByRole("button", { name: /Continue/ }));
    await user.click(screen.getByText("Blank canvas"));
    await user.click(await screen.findByRole("button", { name: "Design" }));
    await user.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));

    await user.click(screen.getByRole("button", { name: "Note" })); // arms
    await user.click(screen.getByRole("button", { name: "Note" })); // ink row

    expect(
      screen.getByRole("menuitemradio", { name: WINE.label }).getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("menuitemradio", { name: PLUM.label }).getAttribute("aria-checked")
    ).toBe("false");
  });
});
