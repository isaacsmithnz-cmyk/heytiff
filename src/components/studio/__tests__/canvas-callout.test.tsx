/* Clicking a unit puts its name on the drawing, and dragging it is what makes
   that permanent.

   Isaac: "when you click on a unit, display the unit information as if it were
   a cloud note — a line coming off that unit... Part of the drawing. That way
   you can move the unit information to somewhere that you want to yourself."

   THE DRAG IS THE COMMIT, and that ordering is the whole design. The bubble a
   selected unit shows is a PREVIEW: drawn, but nowhere in the document. It is
   the note tool's own lesson inverted — a note reached the document at the
   leader click, before its words existed, so anything that killed the editor
   another way left a cloud pointing at nothing and it took a repair pass on
   load to sweep them (#541). Nothing here can be left behind, because nothing
   is written until somebody moves it.

   callouts.test.ts pins the ARITHMETIC. This pins the WIRING: that the preview
   is free, that the drag costs exactly one undo step, and that a press which
   goes nowhere costs none. */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "@/lib/studio/document";
import { calloutOf } from "@/lib/studio/callouts";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

const UNIT: DesignObject = {
  id: "u1",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  plane: "room",
  props: { role: "idu", model: "MSZ-AP25VGD", widthMm: 800, depthMm: 300 },
};

function mkDoc(unit: DesignObject = UNIT): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-28T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [unit];
  return d;
}

function renderCanvas(opts: { doc?: DesignDocument; selectedId?: string | null } = {}) {
  let doc = opts.doc ?? mkDoc();
  const onMutate = jest.fn((fn: (d: DesignDocument) => DesignDocument) => {
    doc = fn(doc);
    utils.rerender(tree(doc));
  });
  const tree = (d: DesignDocument) => (
    <StudioCanvas
      doc={d}
      floor={d.floors[0]}
      tool="select"
      selectedId={opts.selectedId === undefined ? "u1" : opts.selectedId}
      onSelect={() => {}}
      onMutate={onMutate}
      onToolDone={() => {}}
      activeSystemId="sys1"
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
    get unit() {
      return doc.objects.find((o) => o.id === "u1")!;
    },
    svg: utils.container.querySelector("svg")!,
  };
}

/* Gestures are written in WORLD units and converted through the canvas's own
   viewport, read back off the scene transform — the canvas re-frames itself
   whenever the floor changes, and adding a callout is exactly that. */
function world(svg: Element, x: number, y: number) {
  const t = [...svg.querySelectorAll("g")]
    .map((g) => g.getAttribute("transform") ?? "")
    .find((v) => v.startsWith("scale("))!;
  const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t)!;
  const [zoom, tx, ty] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { clientX: (x + tx) * zoom, clientY: (y + ty) * zoom, button: 0, pointerId: 1 };
}

/** the canvas's current zoom, read off the scene transform */
function zoomOf(svg: Element) {
  const t = [...svg.querySelectorAll("g")]
    .map((g) => g.getAttribute("transform") ?? "")
    .find((v) => v.startsWith("scale("))!;
  return Number(/scale\(([-\d.e]+)\)/.exec(t)![1]);
}

/** the bubble as DRAWN — grabbing what is on screen rather than recomputing
    the layout, which would only test the geometry module twice */
function bubble(c: HTMLElement) {
  const r = c.querySelector(".ds-callout-box");
  if (!r) return null;
  const n = (k: string) => Number(r.getAttribute(k));
  return { x: n("x"), y: n("y"), w: n("width"), h: n("height") };
}
const centre = (b: { x: number; y: number; w: number; h: number }) => ({
  x: b.x + b.w / 2,
  y: b.y + b.h / 2,
});

/** press, travel, release — one placement gesture */
function dragBubble(v: ReturnType<typeof renderCanvas>, dx: number, dy: number) {
  const from = centre(bubble(v.container)!);
  fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
  fireEvent.pointerMove(v.svg, world(v.svg, from.x + dx, from.y + dy));
  fireEvent.pointerUp(v.svg, world(v.svg, from.x + dx, from.y + dy));
}

describe("the preview a selected unit shows", () => {
  it("appears on selection, saying the model", () => {
    const v = renderCanvas();
    expect(bubble(v.container)).not.toBeNull();
    expect(v.container.querySelector(".ds-callout-line")!.textContent).toBe("MSZ-AP25VGD");
  });

  /* THE POINT OF THE WHOLE ORDERING. Nothing is on the document, so nothing
     can be left behind by a reload, a floor switch or a deploy. */
  it("is nowhere in the document", () => {
    const v = renderCanvas();
    expect(calloutOf(v.unit)).toBeNull();
    expect(v.onMutate).not.toHaveBeenCalled();
  });

  it("says so in its own class, rather than looking placed", () => {
    const v = renderCanvas();
    expect(v.container.querySelector(".ds-callout")!.classList).toContain("pre");
  });

  it("is not offered on a unit nobody has selected", () => {
    const v = renderCanvas({ selectedId: null });
    expect(bubble(v.container)).toBeNull();
  });

  it("goes away again when the selection does", () => {
    const v = renderCanvas();
    expect(bubble(v.container)).not.toBeNull();
    v.rerender(
      <StudioCanvas
        doc={mkDoc()}
        floor={floor}
        tool="select"
        selectedId={null}
        onSelect={() => {}}
        onMutate={() => {}}
        onToolDone={() => {}}
        activeSystemId="sys1"
        component={null}
        iduSpec={() => null}
        onPlaced={() => {}}
        onRoomCreated={() => {}}
        onRemarkConsumed={() => {}}
      />
    );
    expect(bubble(v.container)).toBeNull();
  });
});

describe("dragging it is what makes it part of the drawing", () => {
  it("writes the placement onto the unit", () => {
    const v = renderCanvas();
    expect(calloutOf(v.unit)).toBeNull();

    dragBubble(v, 160, 90);

    const placed = calloutOf(v.unit);
    expect(placed).not.toBeNull();
    expect(v.onMutate).toHaveBeenCalledTimes(1);
  });

  it("moves it by the travel, not to the cursor — no jump on pixel one", () => {
    const v = renderCanvas();
    dragBubble(v, 200, 0);
    const first = calloutOf(v.unit)!;

    dragBubble(v, 100, 0);
    expect(calloutOf(v.unit)!.x - first.x).toBeCloseTo(100, 6);
  });

  it("stops looking like a preview once it is placed", () => {
    const v = renderCanvas();
    dragBubble(v, 160, 90);
    expect(v.container.querySelector(".ds-callout")!.classList).not.toContain("pre");
  });

  /* onMutate lands an undo step whether or not the objects come back changed,
     so the did-anything-change test has to run BEFORE the call. A bubble
     pressed and let go is a selection, not an edit. */
  it("costs no undo step when the gesture never moves", () => {
    const v = renderCanvas();
    const from = centre(bubble(v.container)!);
    fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerUp(v.svg, world(v.svg, from.x, from.y));
    expect(v.onMutate).not.toHaveBeenCalled();
    expect(calloutOf(v.unit)).toBeNull();
  });

  /* AND THE HARDER HALF. A press that travels and comes back has a live
     placement to compare, so it is the one that actually exercises the
     did-anything-change test — without it, dropping that test still passes the
     no-travel case above and the undo stack quietly grows a step per fidget. */
  it("costs no undo step when the gesture travels and returns", () => {
    const v = renderCanvas();
    const from = centre(bubble(v.container)!);
    fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x + 90, from.y + 40));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerUp(v.svg, world(v.svg, from.x, from.y));

    expect(v.onMutate).not.toHaveBeenCalled();
    expect(calloutOf(v.unit)).toBeNull();
  });

  /* the same rule on a callout that is already placed: nudging it back to
     where it was is not an edit either */
  it("costs no undo step when a placed one is put back where it was", () => {
    const v = renderCanvas({
      doc: mkDoc({ ...UNIT, props: { ...UNIT.props, callout: { x: 200, y: -100 } } }),
    });
    const from = centre(bubble(v.container)!);
    fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x + 50, from.y));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerUp(v.svg, world(v.svg, from.x, from.y));

    expect(v.onMutate).not.toHaveBeenCalled();
    expect(calloutOf(v.unit)).toEqual({ x: 200, y: -100 });
  });

  /* A SLOP, and it is not the same guard as the comparison above. The FIRST
     placement has no stored value to differ from, so a press that rolled two
     pixels on a trackpad would write a callout to the document and cost an
     undo step — the exact bug TAP_SLOP_PX exists for, and why it was raised
     from 4 to 10. */
  it("treats a press that only rolls a couple of pixels as a click", () => {
    const v = renderCanvas();
    const from = centre(bubble(v.container)!);
    const px = 4 / zoomOf(v.svg); // 4 screen px, under the 10px slop

    fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x + px, from.y + px));
    fireEvent.pointerUp(v.svg, world(v.svg, from.x + px, from.y + px));

    expect(v.onMutate).not.toHaveBeenCalled();
    expect(calloutOf(v.unit)).toBeNull();
  });

  it("but takes a deliberate travel past it", () => {
    const v = renderCanvas();
    const from = centre(bubble(v.container)!);
    const px = 24 / zoomOf(v.svg);

    fireEvent.pointerDown(v.svg, world(v.svg, from.x, from.y));
    fireEvent.pointerMove(v.svg, world(v.svg, from.x + px, from.y));
    fireEvent.pointerUp(v.svg, world(v.svg, from.x + px, from.y));

    expect(calloutOf(v.unit)).not.toBeNull();
  });

  it("is still on the plan with nothing selected once placed", () => {
    const v = renderCanvas();
    dragBubble(v, 160, 90);
    const placed = calloutOf(v.unit)!;

    const v2 = renderCanvas({ doc: mkDoc({ ...UNIT, props: { ...UNIT.props, callout: placed } }), selectedId: null });
    expect(bubble(v2.container)).not.toBeNull();
  });
});

describe("a callout belongs to its unit", () => {
  /* It is an OFFSET, not a position, so the bubble travels with the thing it
     names for free — the plenum precedent. Nothing has to re-anchor it. */
  it("travels when the unit moves", () => {
    const at = { x: 500, y: 400 };
    const v = renderCanvas({
      doc: mkDoc({
        ...UNIT,
        geometry: { kind: "point", at },
        props: { ...UNIT.props, callout: { x: 200, y: -100 } },
      }),
    });
    const b = bubble(v.container)!;
    // the bubble sits relative to the unit, not at the world origin
    expect(b.x).toBeGreaterThan(at.x);
    expect(b.y).toBeLessThan(at.y);
  });

  it("cannot outlive it — no unit, no callout", () => {
    const v = renderCanvas({ doc: mkDoc({ ...UNIT, props: { ...UNIT.props, callout: { x: 200, y: -100 } } }) });
    expect(bubble(v.container)).not.toBeNull();

    const empty = mkDoc();
    empty.objects = [];
    v.rerender(
      <StudioCanvas
        doc={empty}
        floor={floor}
        tool="select"
        selectedId={null}
        onSelect={() => {}}
        onMutate={() => {}}
        onToolDone={() => {}}
        activeSystemId="sys1"
        component={null}
        iduSpec={() => null}
        onPlaced={() => {}}
        onRoomCreated={() => {}}
        onRemarkConsumed={() => {}}
      />
    );
    expect(bubble(v.container)).toBeNull();
  });
});

describe("taking one back off", () => {
  it("offers a remove mark only on a PLACED callout, and only while selected", () => {
    const preview = renderCanvas();
    expect(preview.container.querySelector(".ds-callout-x")).toBeNull();

    const placed = mkDoc({ ...UNIT, props: { ...UNIT.props, callout: { x: 200, y: -100 } } });
    const sel = renderCanvas({ doc: placed });
    expect(sel.container.querySelector(".ds-callout-x")).not.toBeNull();

    const unsel = renderCanvas({ doc: placed, selectedId: null });
    expect(unsel.container.querySelector(".ds-callout-x")).toBeNull();
  });

  it("clears the placement, leaving the unit otherwise untouched", () => {
    const v = renderCanvas({
      doc: mkDoc({ ...UNIT, props: { ...UNIT.props, callout: { x: 200, y: -100 } } }),
    });
    const b = bubble(v.container)!;
    // the mark rides the bubble's outer top corner
    fireEvent.pointerDown(v.svg, world(v.svg, b.x + b.w, b.y));
    fireEvent.pointerUp(v.svg, world(v.svg, b.x + b.w, b.y));

    expect(calloutOf(v.unit)).toBeNull();
    expect(v.unit.props.model).toBe("MSZ-AP25VGD");
  });
});
