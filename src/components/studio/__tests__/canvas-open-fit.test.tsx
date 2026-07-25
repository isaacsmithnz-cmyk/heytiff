/* Opening a saved drawing frames it (field feedback 2026-07-26: "the plan
   loads much lower than the tool itself").

   The canvas fitted once, on the FIRST size the ResizeObserver reported. That
   box is not the settled one — the editor's rows are still resolving when the
   canvas mounts — so the drawing was centred in a taller box than it ended up
   in and sat below centre for the rest of the session. The view now belongs to
   the content until the user frames it themselves.

   jsdom has no ResizeObserver and no layout, so the harness below supplies
   both: a stub RO whose callback the test fires by hand, and a stubbed
   getBoundingClientRect that returns whatever box the test is pretending the
   canvas has. */

import { render, fireEvent, act } from "@testing-library/react";
import { StudioCanvas } from "../canvas";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";

const floor: Floor = {
  id: "flr",
  name: "G",
  level: 0,
  scaleMmPerUnit: 10,
  northDeg: null,
  northPos: null,
  plans: [],
};

/** a room centred on the world origin, 200 × 200 world units */
const room = (): DesignObject => ({
  id: "rm1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ],
  },
  plane: "room",
  props: { name: "Lounge", shape: "rect", configured: true },
});

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-26T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = [room()];
  return d;
}

/* ── the harness: a resizable, measurable canvas box ── */

let box = { width: 900, height: 900 };
let fireResize: (() => void) | null = null;
let origRO: typeof ResizeObserver;
let origRect: () => DOMRect;

beforeEach(() => {
  box = { width: 900, height: 900 };
  origRO = global.ResizeObserver;
  origRect = Element.prototype.getBoundingClientRect;
  global.ResizeObserver = class {
    constructor(cb: () => void) {
      fireResize = cb;
    }
    observe() {}
    disconnect() {
      fireResize = null;
    }
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = function () {
    return { ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, toJSON: () => {} } as DOMRect;
  };
});

afterEach(() => {
  global.ResizeObserver = origRO;
  Element.prototype.getBoundingClientRect = origRect;
});

function renderCanvas() {
  const utils = render(
    <StudioCanvas
      doc={mkDoc()}
      floor={floor}
      tool="select"
      selectedId={null}
      onSelect={() => {}}
      onMutate={() => {}}
      onToolDone={() => {}}
      activeSystemId="sys1"
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

/** the scene transform, parsed back into zoom + pan */
function view(svg: Element) {
  const t = svg.querySelector("g[transform^='scale']")!.getAttribute("transform")!;
  const [, zoom, x, y] = t.match(/scale\(([\d.]+)\) translate\((-?[\d.]+) (-?[\d.]+)\)/)!;
  return { zoom: Number(zoom), x: Number(x), y: Number(y) };
}

/** where world (0,0) — the room's centre — lands on screen. The transform
    already carries the negated pan (`translate(-vp.x -vp.y)`), so the parsed
    numbers scale straight up. */
const centreOnScreen = (svg: Element) => {
  const v = view(svg);
  return { x: v.x * v.zoom, y: v.y * v.zoom };
};

const resizeTo = (w: number, h: number) => {
  box = { width: w, height: h };
  act(() => fireResize?.());
};

describe("a drawing opens framed, whatever the layout does next", () => {
  it("re-fits when the box settles to a different size", () => {
    const { svg } = renderCanvas();
    act(() => fireResize?.()); // first measure: the tall, unsettled box
    expect(centreOnScreen(svg).y).toBeCloseTo(450, 0);

    // the editor's rows resolve and the canvas ends up shorter
    resizeTo(900, 500);

    // the room is centred in the box the user is actually looking at — it was
    // left at y≈450 (below centre, off the bottom edge) before this fix
    expect(centreOnScreen(svg).y).toBeCloseTo(250, 0);
    expect(centreOnScreen(svg).x).toBeCloseTo(450, 0);
  });

  it("leaves the view alone once the user has panned", () => {
    const { svg } = renderCanvas();
    act(() => fireResize?.());

    const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 1, pointerId: 1 });
    fireEvent.pointerDown(svg, pt(400, 400)); // middle button = pan
    fireEvent.pointerMove(svg, pt(400, 300));
    fireEvent.pointerUp(svg, pt(400, 300));
    const panned = centreOnScreen(svg);
    expect(panned.y).not.toBeCloseTo(450, 0); // the pan took

    resizeTo(900, 500);
    // their framing survives the resize — only the untouched view re-fits
    expect(centreOnScreen(svg)).toEqual(panned);
  });
});
