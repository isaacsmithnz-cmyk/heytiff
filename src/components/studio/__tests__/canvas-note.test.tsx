/* The note tool — two gestures, one object.

   Cloud what you are talking about, then say where the words go. Nothing
   reaches the document until the SECOND gesture: a cloud with nowhere to point
   is not a note, and a half-made one must leave no trace to undo.

   jsdom has no layout: blank floor (10 mm/unit -> grid 100) opens at zoom
   0.56, world origin at screen centre (400,300). 56 screen px = 100 world
   units = 1 m. */

import { render, fireEvent, screen } from "@testing-library/react";
import { StudioCanvas, type CanvasTool } from "../canvas";
import { createDesign, type DesignDocument, type Floor } from "@/lib/studio/document";
import {
  createNote,
  isNote,
  noteLeader,
  noteRect,
  noteInkOf,
  noteText,
  noteTextLayout,
  DEFAULT_NOTE_INK,
  NOTE_INKS,
} from "@/lib/studio/notes";

/* the margin text's world size at these fixtures' zoom. Notes hold a constant
   SCREEN size (13px), and below 1:1 the canvas clamps that divisor to 1 — so
   at every zoom in this file a note's font is 13 world units. */
const NOTE_FONT_W = 13;

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-08-25T00:00:00.000Z" });
  d.floors = [{ ...floor }];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [];
  return d;
}

/** a live canvas whose document actually changes, so a two-gesture flow can
    be followed end to end */
function renderCanvas(opts: {
  tool?: CanvasTool;
  doc?: DesignDocument;
  activeSystemId?: string | null;
  selectedId?: string | null;
  armedInk?: string;
} = {}) {
  let doc = opts.doc ?? mkDoc();
  const onMutate = jest.fn((fn: (d: DesignDocument) => DesignDocument) => {
    doc = fn(doc);
    utils.rerender(tree(doc));
  });
  const onSelect = jest.fn();
  const tree = (d: DesignDocument) => (
    <StudioCanvas
      doc={d}
      floor={d.floors[0]}
      tool={opts.tool ?? "note"}
      selectedId={opts.selectedId ?? null}
      onSelect={onSelect}
      onMutate={onMutate}
      onToolDone={() => {}}
      activeSystemId={opts.activeSystemId === undefined ? "sys1" : opts.activeSystemId}
      armedInk={opts.armedInk}
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  const utils = render(tree(doc));
  return {
    ...utils,
    onMutate,
    onSelect,
    get doc() {
      return doc;
    },
    get notes() {
      return doc.objects.filter(isNote);
    },
    svg: utils.container.querySelector("svg")!,
  };
}

const clouds = (c: HTMLElement) => c.querySelectorAll(".ds-note-cloud");

/* Every gesture below is written in WORLD units and converted through the
   canvas's OWN viewport, read back off the scene transform. Hard-coded screen
   pixels would pin these tests to one framing — and the canvas re-frames
   itself whenever what is on the floor changes, which is exactly what adding
   a note does. */
function world(svg: Element, x: number, y: number) {
  const t = svg.querySelector("g[transform]")!.getAttribute("transform")!;
  const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)!;
  const [zoom, tx, ty] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { clientX: (x + tx) * zoom, clientY: (y + ty) * zoom, button: 0, pointerId: 1 };
}

/** gesture one: drag a cloud over world (0,0)–(200,100) */
function dragCloud(svg: Element) {
  fireEvent.pointerDown(svg, world(svg, 0, 0));
  fireEvent.pointerMove(svg, world(svg, 200, 100));
  fireEvent.pointerUp(svg, world(svg, 200, 100));
}

/** gesture two: say where the words go */
function placeWords(svg: Element, x = 600, y = 0) {
  fireEvent.pointerDown(svg, world(svg, x, y));
  fireEvent.pointerUp(svg, world(svg, x, y));
}

describe("the note tool", () => {
  it("draws the cloud as you drag it, and writes nothing yet", () => {
    const v = renderCanvas();
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0));
    fireEvent.pointerMove(v.svg, world(v.svg, 200, 100));

    expect(clouds(v.container)).toHaveLength(1);
    expect(v.onMutate).not.toHaveBeenCalled();
  });

  /* the whole two-gesture design: the cloud stays up, waiting to be told where
     its words go, and the document is still untouched */
  it("holds the cloud open for its leader, still writing nothing", () => {
    const v = renderCanvas();
    dragCloud(v.svg);

    expect(clouds(v.container)).toHaveLength(1);
    expect(v.onMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("where the words go");
  });

  it("commits on the second click, with the leader where it landed", () => {
    const v = renderCanvas();
    dragCloud(v.svg);
    placeWords(v.svg);

    expect(v.notes).toHaveLength(1);
    const n = v.notes[0];
    // 400,300 → world 0,0; 112 px = 200 units; 336 px = 600 units
    expect(noteRect(n)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(noteLeader(n)).toEqual({ x: 600, y: 0 });
    expect(n.systemId).toBeNull();
  });

  it("opens the words straight away — a cloud with nothing to say is not a note", () => {
    const v = renderCanvas();
    dragCloud(v.svg);
    placeWords(v.svg);

    expect(screen.getByRole("dialog", { name: "Note" })).toBeInTheDocument();
  });

  it("puts the typed words on the drawing", () => {
    const v = renderCanvas();
    dragCloud(v.svg);
    placeWords(v.svg);

    fireEvent.change(screen.getByLabelText("Note text"), {
      target: { value: "Check bulkhead depth on site" },
    });
    fireEvent.click(screen.getByText("Done"));

    expect(noteText(v.notes[0])).toBe("Check bulkhead depth on site");
    expect(v.container.querySelector(".ds-note-text")!.textContent).toContain(
      "Check bulkhead"
    );
  });

  /* a leader pointing at an empty margin is a mystery, not markup */
  it("takes an empty note back off the drawing", () => {
    const v = renderCanvas();
    dragCloud(v.svg);
    placeWords(v.svg);
    expect(v.notes).toHaveLength(1);

    fireEvent.click(screen.getByText("Done"));
    expect(v.notes).toHaveLength(0);
  });

  it("ignores a stray click that never became a cloud", () => {
    const v = renderCanvas();
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0));
    fireEvent.pointerMove(v.svg, world(v.svg, 5, 4));
    fireEvent.pointerUp(v.svg, world(v.svg, 5, 4));

    expect(clouds(v.container)).toHaveLength(0);
    placeWords(v.svg);
    expect(v.onMutate).not.toHaveBeenCalled();
  });

  it("drops a pinned cloud on Escape", () => {
    const v = renderCanvas();
    dragCloud(v.svg);
    expect(clouds(v.container)).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(clouds(v.container)).toHaveLength(0);
    expect(v.onMutate).not.toHaveBeenCalled();
  });
});

describe("a note on the drawing", () => {
  const withNote = (leader = { x: 600, y: 0 }) => {
    const d = mkDoc();
    d.objects = [
      createNote({
        floorId: "flr",
        rect: { x: 0, y: 0, w: 200, h: 100 },
        leader,
        text: "Existing unit stays",
        id: "note_1",
      }),
    ];
    return d;
  };

  /* markup belongs to the DRAWING: switching the canvas to another system —
     or to none — must never take somebody's note off the plan */
  it("shows whatever system the canvas is on", () => {
    for (const activeSystemId of ["sys1", "sys2", null]) {
      const v = renderCanvas({ tool: "select", doc: withNote(), activeSystemId });
      expect(clouds(v.container)).toHaveLength(1);
      v.unmount();
    }
  });

  it("is grabbed by its outline", () => {
    const v = renderCanvas({ tool: "select", doc: withNote() });
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0)); // the cloud's top-left corner
    expect(v.onSelect).toHaveBeenCalledWith("note_1");
  });

  /* the reason the middle is not a target: a note is drawn AROUND rooms and
     units, and those still have to be clickable through it */
  it("lets a click through its middle to the drawing beneath", () => {
    const v = renderCanvas({ tool: "select", doc: withNote() });
    fireEvent.pointerDown(v.svg, world(v.svg, 100, 50)); // dead centre of the cloud
    expect(v.onSelect).toHaveBeenCalledWith(null);
  });

  it("slides whole when its cloud is dragged", () => {
    const v = renderCanvas({ tool: "select", doc: withNote() });
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0));
    fireEvent.pointerMove(v.svg, world(v.svg, 100, 0));
    fireEvent.pointerUp(v.svg, world(v.svg, 100, 0));

    expect(noteRect(v.notes[0])).toEqual({ x: 100, y: 0, w: 200, h: 100 });
    expect(noteLeader(v.notes[0])).toEqual({ x: 700, y: 0 });
  });

  it("re-places just its words when the margin end is dragged", () => {
    const v = renderCanvas({ tool: "select", doc: withNote() });
    // grab the words themselves, wherever the layout put them
    const grab = noteTextLayout(
      { x: 0, y: 0, w: 200, h: 100 },
      { x: 600, y: 0 },
      "Existing unit stays",
      NOTE_FONT_W
    ).box;
    fireEvent.pointerDown(v.svg, world(v.svg, grab.x + 2, grab.y + 2));
    fireEvent.pointerMove(v.svg, world(v.svg, grab.x + 2, grab.y + 202));
    fireEvent.pointerUp(v.svg, world(v.svg, grab.x + 2, grab.y + 202));

    expect(noteLeader(v.notes[0])).toEqual({ x: 600, y: 200 });
    expect(noteRect(v.notes[0])).toEqual({ x: 0, y: 0, w: 200, h: 100 }); // cloud stayed
  });

  it("opens its words on a double-click", () => {
    const v = renderCanvas({ tool: "select", doc: withNote() });
    fireEvent.doubleClick(v.svg, world(v.svg, 0, 0));
    expect(screen.getByLabelText("Note text")).toHaveValue("Existing unit stays");
  });

  it("is drawn in its own ink, not the group's fallback", () => {
    const d = mkDoc();
    d.objects = [
      createNote({
        floorId: "flr",
        rect: { x: 0, y: 0, w: 200, h: 100 },
        leader: { x: 600, y: 0 },
        text: "Query",
        ink: "#9D174D",
        id: "note_1",
      }),
    ];
    const v = renderCanvas({ tool: "select", doc: d });
    expect(v.container.querySelector<SVGGElement>(".ds-note")!.style.color).toBe(
      "rgb(157, 23, 77)"
    );
  });

  it("erases whole — half a note is a leader pointing at nothing", () => {
    const v = renderCanvas({ tool: "erase", doc: withNote() });
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0));
    fireEvent.pointerUp(v.svg, world(v.svg, 0, 0));
    expect(v.notes).toHaveLength(0);
  });
});

/* The ink is armed on the bench and lands on the note; the note keeps it, and
   the editor can change it afterwards. */
describe("choosing the ink", () => {
  const make = (v: ReturnType<typeof renderCanvas>) => {
    dragCloud(v.svg);
    placeWords(v.svg);
  };

  it("draws the next note in the armed ink", () => {
    const v = renderCanvas({ armedInk: "#14532D" });
    make(v);
    expect(noteInkOf(v.notes[0])).toBe("#14532D");
  });

  it("defaults to the ink notes shipped in", () => {
    const v = renderCanvas();
    make(v);
    expect(noteInkOf(v.notes[0])).toBe(DEFAULT_NOTE_INK);
  });

  /* what you are about to draw is drawn in what you picked — the draft is not
     a grey preview of a coloured thing */
  it("shows the armed ink on the cloud being dragged", () => {
    const v = renderCanvas({ armedInk: "#C2410C" });
    fireEvent.pointerDown(v.svg, world(v.svg, 0, 0));
    fireEvent.pointerMove(v.svg, world(v.svg, 200, 100));
    expect(v.container.querySelector<SVGGElement>(".ds-note.draft")!.style.color).toBe(
      "rgb(194, 65, 12)"
    );
  });

  it("offers every ink in the editor, and recolours on a press", () => {
    const v = renderCanvas();
    make(v);
    const swatches = screen.getAllByRole("radio");
    expect(swatches).toHaveLength(NOTE_INKS.length);
    expect(swatches[0]).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Wine" }));
    expect(noteInkOf(v.notes[0])).toBe("#9D174D");
    expect(screen.getByRole("radio", { name: "Wine" })).toBeChecked();
  });

  /* recolouring must not eat the words somebody has already typed */
  it("keeps the text through a recolour", () => {
    const v = renderCanvas();
    make(v);
    fireEvent.change(screen.getByLabelText("Note text"), {
      target: { value: "Existing unit stays" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Petrol" }));
    fireEvent.click(screen.getByText("Done"));

    expect(noteText(v.notes[0])).toBe("Existing unit stays");
    expect(noteInkOf(v.notes[0])).toBe("#155E75");
  });
});
