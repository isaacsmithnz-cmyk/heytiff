/* The Draw tools (pipe soft/hard · drain · cable) — canvas wiring.

   geometry.test.ts covers the spline math; this file covers what only the
   mounted canvas can prove: that the armed DrawOptions decide WHAT a finished
   line commits as (type + picked-at-draw props), that the curved tools place
   free dots while the straight ones ortho-snap, and that each family renders
   its own mark (pipe solid, drain dashed polyline, cable dash-dot path).

   jsdom has no layout: the blank floor (scale 10 mm/unit → grid 100) opens at
   zoom 0.56 with the world origin at screen centre (400,300), so client
   coords map straight to screen — world x → 400 + x*0.56 (canvas.test.tsx). */

import { render, fireEvent } from "@testing-library/react";
import { StudioCanvas, type DrawOptions } from "../canvas";
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

const sx = (x: number) => 400 + x * 0.56;
const sy = (y: number) => 300 + y * 0.56;
const pt = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

function mkDoc(objects: DesignObject[] = []): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-19T00:00:00.000Z" });
  d.floors = [floor];
  d.systems = [
    { id: "sys1", type: "split", brand: "me", colour: "#2E68FF", name: "S1", settings: {} },
  ];
  d.objects = objects;
  return d;
}

const runLine = (
  id: string,
  type: string,
  props: Record<string, unknown> = {}
): DesignObject => ({
  id,
  type,
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 40 },
      { x: 240, y: 10 },
    ],
  },
  plane: "room",
  props,
});

function renderCanvas(opts: {
  doc: DesignDocument;
  tool: Parameters<typeof StudioCanvas>[0]["tool"];
  draw?: DrawOptions;
  runSizes?: ReadonlyMap<string, { liquidMm: number; gasMm: number }>;
  onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
}) {
  const utils = render(
    <StudioCanvas
      doc={opts.doc}
      floor={floor}
      tool={opts.tool}
      selectedId={null}
      onSelect={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      onToolDone={() => {}}
      activeSystemId="sys1"
      component={null}
      iduSpec={() => null}
      onPlaced={() => {}}
      onRoomCreated={() => {}}
      onRemarkConsumed={() => {}}
      reshapeRoomId={null}
      onReshapeConsumed={() => {}}
      draw={opts.draw}
      runSizes={opts.runSizes}
    />
  );
  return { ...utils, svg: utils.container.querySelector("svg")! };
}

/** click (tap-pan: down + up in place) */
const click = (svg: Element, x: number, y: number) => {
  fireEvent.pointerDown(svg, pt(x, y));
  fireEvent.pointerUp(svg, pt(x, y));
};

/** draw a line through world points and finish it open (double-click) */
function drawLine(svg: Element, pts: { x: number; y: number }[]) {
  for (const p of pts) click(svg, sx(p.x), sy(p.y));
  fireEvent.doubleClick(svg);
}

function captureCommit(doc: DesignDocument) {
  let committed: DesignDocument = doc;
  const onMutate = (fn: (d: DesignDocument) => DesignDocument) => {
    committed = fn(committed);
  };
  return { onMutate, get: () => committed };
}

const lastObj = (d: DesignDocument) => d.objects[d.objects.length - 1];

describe("Draw tools — what a finished line commits as", () => {
  it("drain: commits a drain-run carrying the armed size, ortho-snapped", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "drain",
      draw: { pipeForm: "hard", drainMm: 32, cableKind: "power" },
      onMutate: c.onMutate,
    });
    drawLine(svg, [
      { x: 0, y: 0 },
      { x: 200, y: 30 }, // off-axis on purpose — the drain snaps it
    ]);
    const o = lastObj(c.get());
    expect(o.type).toBe("drain-run");
    expect(o.props.sizeMm).toBe(32);
    const pts = (o.geometry as { points: { x: number; y: number }[] }).points;
    expect(pts).toHaveLength(2);
    // ortho snap: the second point lands on the first's axis
    expect(pts[1].y).toBeCloseTo(pts[0].y, 3);
  });

  it("cable: commits a cable-run carrying the armed kind, dots placed free", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "cable",
      draw: { pipeForm: "hard", drainMm: 25, cableKind: "data" },
      onMutate: c.onMutate,
    });
    drawLine(svg, [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 220, y: 20 },
    ]);
    const o = lastObj(c.get());
    expect(o.type).toBe("cable-run");
    expect(o.props.kind).toBe("data");
    const pts = (o.geometry as { points: { x: number; y: number }[] }).points;
    expect(pts).toHaveLength(3);
    // free dots: nothing was ortho-snapped
    expect(pts[1].y).not.toBeCloseTo(pts[0].y, 1);
  });

  it("soft-drawn pipe commits form: soft with free dots; hard stays default", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "pipe",
      draw: { pipeForm: "soft", drainMm: 25, cableKind: "power" },
      onMutate: c.onMutate,
    });
    drawLine(svg, [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ]);
    const soft = lastObj(c.get());
    expect(soft.type).toBe("pipe-run");
    expect(soft.props.form).toBe("soft");
    const pts = (soft.geometry as { points: { x: number; y: number }[] }).points;
    expect(pts[1].y).not.toBeCloseTo(pts[0].y, 1);
  });

  it("hard-drawn pipe commits with no form word (the pre-Draw default)", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "pipe",
      draw: { pipeForm: "hard", drainMm: 25, cableKind: "power" },
      onMutate: c.onMutate,
    });
    drawLine(svg, [
      { x: 0, y: 0 },
      { x: 100, y: 60 },
    ]);
    const o = lastObj(c.get());
    expect(o.type).toBe("pipe-run");
    expect(o.props.form).toBeUndefined();
  });
});

describe("Draw tools — each family renders its own mark", () => {
  it("drain renders dashed polyline + size label; cable renders a curved path + kind", () => {
    const doc = mkDoc([
      runLine("d1", "drain-run", { sizeMm: 40 }),
      runLine("c1", "cable-run", { kind: "data" }),
    ]);
    const { svg } = renderCanvas({ doc, tool: "select" });
    expect(svg.querySelector("g.ds-drain polyline")).toBeTruthy();
    const cablePath = svg.querySelector("g.ds-cable path");
    expect(cablePath).toBeTruthy();
    expect(cablePath!.getAttribute("d")).toMatch(/^M .* C /);
    const labels = [...svg.querySelectorAll("text.ds-pipe-len")].map((t) => t.textContent);
    expect(labels.some((l) => l?.includes("Ø40 drain"))).toBe(true);
    expect(labels.some((l) => l?.includes("Data"))).toBe(true);
  });

  it("a soft pipe renders the smoothed path; a hard one keeps the polyline", () => {
    const doc = mkDoc([
      runLine("p1", "pipe-run", { form: "soft" }),
      runLine("p2", "pipe-run"),
    ]);
    const { svg } = renderCanvas({ doc, tool: "select" });
    expect(svg.querySelector("g.ds-pipe path")).toBeTruthy();
    expect(svg.querySelector("g.ds-pipe polyline")).toBeTruthy();
  });

  it("pipe labels autosize from the pairing's line sizes; per-run props win", () => {
    const doc = mkDoc([
      runLine("p1", "pipe-run"),
      runLine("p2", "pipe-run", { liquidMm: 9.5, gasMm: 15.9 }),
    ]);
    const { svg } = renderCanvas({
      doc,
      tool: "select",
      runSizes: new Map([["sys1", { liquidMm: 6.4, gasMm: 12.7 }]]),
    });
    const labels = [...svg.querySelectorAll("text.ds-pipe-len")].map((t) => t.textContent);
    expect(labels.some((l) => l?.includes("Ø6.4/12.7"))).toBe(true);
    expect(labels.some((l) => l?.includes("Ø9.5/15.9"))).toBe(true);
  });
});

/* ── ending a line: the double-click's own click must not leave a stub, and
   Enter ends it with no click at all (Isaac, 2026-08-24 walk) ── */
describe("Draw tools — ending a line", () => {
  it("double-click collapses its own trailing duplicate dots before commit", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "cable",
      draw: { pipeForm: "hard", drainMm: 25, cableKind: "power" },
      onMutate: c.onMutate,
    });
    // two real dots, then the double-click's own click lands 2px away — the
    // browser fires click, click, dblclick at nearly the same spot
    click(svg, sx(0), sy(0));
    click(svg, sx(200), sy(80));
    click(svg, sx(200), sy(82)); // the dblclick's first click
    fireEvent.doubleClick(svg);
    const o = lastObj(c.get());
    expect(o.type).toBe("cable-run");
    const pts = (o.geometry as { points: { x: number; y: number }[] }).points;
    expect(pts).toHaveLength(2); // no tiny stub
  });

  it("a double-click that never travelled keeps drafting instead of committing a dot", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "cable",
      draw: { pipeForm: "hard", drainMm: 25, cableKind: "power" },
      onMutate: c.onMutate,
    });
    click(svg, sx(0), sy(0));
    click(svg, sx(0), sy(2));
    fireEvent.doubleClick(svg);
    expect(c.get().objects).toHaveLength(0);
  });

  it("Enter ends the line without adding anything", () => {
    const doc = mkDoc();
    const c = captureCommit(doc);
    const { svg } = renderCanvas({
      doc,
      tool: "pipe",
      draw: { pipeForm: "soft", drainMm: 25, cableKind: "power" },
      onMutate: c.onMutate,
    });
    click(svg, sx(0), sy(0));
    click(svg, sx(150), sy(90));
    fireEvent.keyDown(window, { key: "Enter" });
    const o = lastObj(c.get());
    expect(o.type).toBe("pipe-run");
    expect(o.props.form).toBe("soft");
    expect((o.geometry as { points: unknown[] }).points).toHaveLength(2);
  });
});

/* ── right-click disarms: any tool drops back to Select, drafts discarded ── */
describe("right-click disarms the armed tool", () => {
  function renderWithDone(tool: Parameters<typeof StudioCanvas>[0]["tool"]) {
    const doc = mkDoc();
    const c = captureCommit(doc);
    let done = 0;
    const utils = render(
      <StudioCanvas
        doc={doc}
        floor={floor}
        tool={tool}
        selectedId={null}
        onSelect={() => {}}
        onMutate={c.onMutate}
        onToolDone={() => done++}
        activeSystemId="sys1"
        component={null}
        iduSpec={() => null}
        onPlaced={() => {}}
        onRoomCreated={() => {}}
        onRemarkConsumed={() => {}}
        reshapeRoomId={null}
        onReshapeConsumed={() => {}}
      />
    );
    return { svg: utils.container.querySelector("svg")!, c, doneCount: () => done };
  }

  it("mid-draft: discards the dots and returns to Select without committing", () => {
    const { svg, c, doneCount } = renderWithDone("pipe");
    click(svg, sx(0), sy(0));
    click(svg, sx(150), sy(0));
    fireEvent.contextMenu(svg);
    expect(doneCount()).toBe(1);
    expect(c.get().objects).toHaveLength(0); // nothing committed
    // the draft is gone: a later double-click has nothing to finish
    fireEvent.doubleClick(svg);
    expect(c.get().objects).toHaveLength(0);
  });

  it("an armed tool with no draft still hands back to Select", () => {
    const { doneCount, svg } = renderWithDone("erase");
    fireEvent.contextMenu(svg);
    expect(doneCount()).toBe(1);
  });

  it("a resting Select keeps the browser's own menu", () => {
    const { svg, doneCount } = renderWithDone("select");
    const e = fireEvent.contextMenu(svg);
    expect(doneCount()).toBe(0);
    expect(e).toBe(true); // not prevented — fireEvent returns !defaultPrevented
  });
});
