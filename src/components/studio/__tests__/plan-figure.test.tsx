import { render } from "@testing-library/react";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { createNote, noteLayoutOf, NOTE_LEGACY_FONT_W, type NoteObject } from "@/lib/studio/notes";
import { PlanFigure, planFigureBounds } from "../summary/plan-figure";

/* The static print/export plan figure — a self-contained SVG mirror of the
   canvas. These pin the structural contract the print document and the PNG
   serializer rely on: bounds from content, one <image> per resolvable sheet,
   room/pipe/unit marks, layer gating, and the grayscale filter reaching the
   whole content group (vectors included — the canvas only desaturated
   rasters). */

const rect = (x: number, y: number, w: number, h: number) => ({
  kind: "polygon" as const,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

function fixtureDoc(): DesignDocument {
  const d = createDesign({ name: "Fig", mode: "plan", now: "2026-07-19T00:00:00.000Z" });
  d.floors = [
    {
      id: "f1",
      name: "Ground",
      level: 0,
      scaleMmPerUnit: 10,
      northDeg: 30,
      northPos: { x: 50, y: 60 },
      plans: [
        { id: "s1", imageRef: "ref-a", pageNumber: 1, name: "GF", width: 1000, height: 700, x: 0, y: 0 },
        { id: "s2", imageRef: "ref-missing", pageNumber: 2, name: "GF East", width: 800, height: 600, x: 1000, y: 0 },
      ],
    },
  ];
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: {} },
  ];
  const objs: DesignObject[] = [
    { id: "room1", type: "room", systemId: "sys1", floorId: "f1", geometry: rect(0, 0, 500, 400), plane: "room", props: { name: "Lounge" } },
    { id: "run1", type: "pipe-run", systemId: "sys1", floorId: "f1", geometry: { kind: "polyline", points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] }, plane: "room", props: {} },
    { id: "i1", type: "unit", systemId: "sys1", floorId: "f1", geometry: { kind: "point", at: { x: 200, y: 200 } }, plane: "room", props: { role: "idu", model: "MSZ-AP25VGD", widthMm: 800, depthMm: 300 } },
    { id: "r1", type: "riser", systemId: "sys1", floorId: "f1", geometry: { kind: "point", at: { x: 400, y: 300 } }, plane: "room", props: { group: "A" } },
  ];
  d.objects = objs;
  return d;
}

const ALL = { plan: true, units: true, pipes: true, labels: true };

describe("planFigureBounds", () => {
  it("covers sheets, objects and the north arrow with padding", () => {
    const d = fixtureDoc();
    const b = planFigureBounds(d, d.floors[0])!;
    expect(b).not.toBeNull();
    // sheets span x 0..1800 — bounds must reach both extremes (plus padding)
    expect(b.x).toBeLessThan(0);
    expect(b.x + b.w).toBeGreaterThan(1800);
  });

  it("an empty floor has no bounds", () => {
    const d = createDesign({ name: "E", mode: "blank" });
    d.floors = [{ id: "f", name: "G", level: 0, scaleMmPerUnit: null, northDeg: null, northPos: null, plans: [] }];
    expect(planFigureBounds(d, d.floors[0])).toBeNull();
  });
});

describe("PlanFigure", () => {
  it("draws sheets with URLs, rooms, pipes, units, risers and north", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{ "ref-a": "blob:sheet-a" }} />
    );
    // one <image> — the ref without a URL is skipped, never a broken raster
    expect(container.querySelectorAll("image")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-room polygon")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-pipe polyline")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-unit")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-riser")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-north")).toHaveLength(1);
    // self-contained: the embedded style carries the font
    expect(container.querySelector("style")?.textContent).toContain("Plus Jakarta Sans");
    // calibrated floor gets a scale bar
    expect(container.querySelectorAll(".ds-pf-bar")).toHaveLength(1);
  });

  /* A crop clips the raster; a freeform crop clips it to its outline, so the
     printed sheet shows the same area as the screen. */
  it("clips a cropped sheet to its rectangle, or to its freeform outline", () => {
    const d = fixtureDoc();
    d.floors[0].plans[0].crop = { x: 100, y: 50, w: 400, h: 300 };
    const rectFig = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{ "ref-a": "blob:a" }} />
    );
    expect(rectFig.container.querySelector("clipPath rect")).not.toBeNull();
    expect(rectFig.container.querySelector("clipPath polygon")).toBeNull();
    rectFig.unmount();

    d.floors[0].plans[0].shape = [
      { x: 100, y: 50 },
      { x: 500, y: 50 },
      { x: 100, y: 350 },
    ];
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{ "ref-a": "blob:a" }} />
    );
    expect(container.querySelector("clipPath polygon")!.getAttribute("points")).toBe("100,50 500,50 100,350");
    expect(container.querySelector("clipPath rect")).toBeNull();
    expect(container.querySelector("image")!.getAttribute("clip-path")).toMatch(/url\(#pf-f1-clip-s1\)/);
  });

  /* Units can be turned on the canvas, so the printed sheet has to agree —
     an export that squares everything up is a different drawing. */
  it("prints a turned unit turned", () => {
    const d = fixtureDoc();
    const idu = d.objects.find((o) => o.id === "i1")!;
    idu.geometry = { kind: "point", at: { x: 200, y: 200 }, rotation: 90 };
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    const unit = container.querySelector(".ds-unit")!;
    const turned = unit.querySelector("g[transform]")!;
    expect(turned.getAttribute("transform")).toBe("rotate(90 200 200)");
  });

  it("leaves an unturned unit without a transform at all", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    expect(container.querySelector(".ds-unit g[transform]")).toBeNull();
  });

  it("layer flags gate their groups", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure
        doc={d}
        floor={d.floors[0]}
        layers={{ plan: false, units: false, pipes: false, labels: false }}
        grayscale={false}
        legend={false}
        urls={{ "ref-a": "blob:sheet-a" }}
      />
    );
    expect(container.querySelectorAll("image")).toHaveLength(0);
    expect(container.querySelectorAll(".ds-unit")).toHaveLength(0);
    expect(container.querySelectorAll(".ds-pipe")).toHaveLength(0);
    // rooms always draw; their labels are gated
    expect(container.querySelectorAll(".ds-room polygon")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-room-name")).toHaveLength(0);
  });

  it("grayscale applies a desaturate filter to the whole content group", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale legend={false} urls={{}} />
    );
    const filter = container.querySelector("filter feColorMatrix");
    expect(filter?.getAttribute("type")).toBe("saturate");
    expect(filter?.getAttribute("values")).toBe("0");
    const g = container.querySelector(`g[filter="url(#pf-f1-desat)"]`);
    expect(g).not.toBeNull();
  });

  /* Markup prints. A note is a written instruction to whoever builds this —
     the one thing on the sheet that is worthless if it only exists on screen,
     and the layer switches turn off DERIVED annotation, not what somebody
     chose to write. */
  describe("notes", () => {
    const withNote = (leader = { x: 900, y: 200 }) => {
      const d = fixtureDoc();
      d.objects = [
        ...d.objects,
        createNote({
          floorId: "f1",
          rect: { x: 100, y: 100, w: 200, h: 150 },
          leader,
          text: "Existing unit stays — do not remove",
          id: "note_1",
        }),
      ];
      return d;
    };

    it("prints the cloud, the leader and the words", () => {
      const d = withNote();
      const { container } = render(
        <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
      );
      expect(container.querySelectorAll(".ds-note-cloud")).toHaveLength(1);
      expect(container.querySelectorAll(".ds-note-leader")).toHaveLength(1);
      expect(container.querySelector(".ds-note-text")!.textContent).toContain(
        "Existing unit stays"
      );
    });

    it("prints with the labels layer off", () => {
      const d = withNote();
      const { container } = render(
        <PlanFigure
          doc={d}
          floor={d.floors[0]}
          layers={{ ...ALL, labels: false }}
          grayscale={false}
          legend={false}
          urls={{}}
        />
      );
      expect(container.querySelectorAll(".ds-note-cloud")).toHaveLength(1);
      expect(container.querySelector(".ds-note-text")!.textContent).toContain(
        "Existing unit stays"
      );
    });

    /* the reason bounds needs a second pass: the words are sized to the sheet,
       so a note in the margin widens the very figure that sizes it. Off the
       right-hand edge and they are simply not on the drawing. */
    it("leaves room in the margin for the words", () => {
      const bare = planFigureBounds(fixtureDoc(), fixtureDoc().floors[0])!;
      const d = withNote({ x: 2400, y: 200 });
      const b = planFigureBounds(d, d.floors[0])!;
      expect(b.x + b.w).toBeGreaterThan(bare.x + bare.w);
      expect(b.x + b.w).toBeGreaterThan(2400); // past the leader, not just to it
    });

    /* the words are the note's, not the figure's: pulling them further into
       the margin widens the figure, and must not grow them with it */
    it("prints its words the same size wherever they sit, and inside the figure", () => {
      const printAt = (leader: { x: number; y: number }) => {
        const d = withNote(leader);
        const { container, unmount } = render(
          <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
        );
        const size = Number(container.querySelector(".ds-note-text")!.getAttribute("font-size"));
        unmount();
        return { size, d };
      };
      const near = printAt({ x: 900, y: 200 });
      const far = printAt({ x: 6000, y: 200 });
      expect(far.size).toBeCloseTo(near.size, 6);
      expect(near.size).toBeCloseTo(NOTE_LEGACY_FONT_W, 6);

      // and the frame is measured at the size the words are drawn, not a guess
      const note = far.d.objects.find((o) => o.id === "note_1") as NoteObject;
      const box = noteLayoutOf(note).box;
      const b = planFigureBounds(far.d, far.d.floors[0])!;
      expect(b.x + b.w).toBeGreaterThanOrEqual(box.x + box.w);
    });

    /* a note prints in the ink it was DRAWN in — the whole reason the hex is
       stored on the document rather than a palette id */
    it("prints each note in its own ink", () => {
      const d = fixtureDoc();
      d.objects = [
        ...d.objects,
        createNote({ floorId: "f1", rect: { x: 100, y: 100, w: 120, h: 90 },
          leader: { x: 900, y: 150 }, text: "Query", ink: "#9D174D", id: "n_wine" }),
        createNote({ floorId: "f1", rect: { x: 260, y: 100, w: 120, h: 90 },
          leader: { x: 900, y: 320 }, text: "Note", ink: "#14532D", id: "n_forest" }),
      ];
      const { container } = render(
        <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
      );
      const inks = [...container.querySelectorAll<SVGGElement>(".ds-note")].map(
        (g) => g.style.color
      );
      expect(inks).toEqual(["rgb(157, 23, 77)", "rgb(20, 83, 45)"]);
    });

    /* THE LOCK (job 3375, 2026-10-06): a note prints at the size it was
       WRITTEN at — the world size the canvas stored on it — so it sits on the
       sheet exactly as it sat on the plan. It used to print at the sheet's own
       size, which on a wide plan was four times the size it was written at,
       and its words ran straight across the next note's. */
    it("prints its words at the size they were written", () => {
      const printed = (props: Record<string, unknown>) => {
        const d = withNote();
        const i = d.objects.findIndex((o) => o.id === "note_1");
        d.objects[i] = { ...d.objects[i], props: { ...d.objects[i].props, ...props } };
        const { container, unmount } = render(
          <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
        );
        const size = Number(container.querySelector(".ds-note-text")!.getAttribute("font-size"));
        const lines = container.querySelectorAll(".ds-note-text tspan").length;
        unmount();
        return { size, lines };
      };
      expect(printed({ fontW: 40 }).size).toBeCloseTo(40, 6);
      // a note from before the lock prints at the size the canvas drew it
      expect(printed({}).size).toBeCloseTo(NOTE_LEGACY_FONT_W, 6);
      // the corner grip's scale rides on top; the measure reflows, never scales
      expect(printed({ fontW: 40, textScale: 2 }).size).toBeCloseTo(80, 6);
      expect(printed({ fontW: 40, wrap: 10 }).lines).toBeGreaterThan(printed({ fontW: 40 }).lines);
      expect(printed({ fontW: 40, wrap: 10 }).size).toBeCloseTo(40, 6);
    });

    it("is not counted as a room", () => {
      const d = withNote();
      const { container } = render(
        <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
      );
      expect(container.querySelectorAll(".ds-room polygon")).toHaveLength(1);
    });
  });

  it("legend lists the symbol key and this floor's systems", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend urls={{}} />
    );
    const legend = container.querySelector(".ds-pf-legend");
    expect(legend?.textContent).toContain("Room");
    expect(legend?.textContent).toContain("Riser");
    expect(legend?.textContent).toContain("System 1");
  });
});

/* ── unit callouts on paper ──
   The sheet is where a callout earns its keep: paper cannot be hovered, so
   until now a unit's model was stamped under its footprint whether there was
   room for it or not. A placed callout IS that label, put where somebody
   decided it should go — and it has to print through the same two functions
   the canvas draws it with, or the two surfaces drift. */
describe("unit callouts", () => {
  const withCallout = (at: { x: number; y: number }) => {
    const d = fixtureDoc();
    d.objects = d.objects.map((o) =>
      o.id === "i1" ? { ...o, props: { ...o.props, callout: at } } : o
    );
    return d;
  };

  it("prints the bubble, its leader and the model", () => {
    const d = withCallout({ x: 260, y: -180 });
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    expect(container.querySelectorAll(".ds-callout")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-callout-box")).toHaveLength(1);
    expect(container.querySelectorAll(".ds-callout-leader")).toHaveLength(1);
    expect(container.querySelector(".ds-callout-text")?.textContent).toContain(
      "MSZ-AP25VGD"
    );
  });

  /* PAPER DRAWS WHAT THE CANVAS DRAWS. It used to stamp "IDU"/"ODU" in
     every footprint and the model under it; on a whole-site sheet the words
     piled onto each other and the notes (Isaac, 2026-09-28). A unit is its
     glyph; its callout names it, as on the canvas. */
  it("stamps no role or model on a unit, callout or not", () => {
    const plain = render(
      <PlanFigure doc={fixtureDoc()} floor={fixtureDoc().floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    expect(plain.container.querySelector(".ds-unit")).not.toBeNull();
    expect(plain.container.querySelector(".ds-unit")!.textContent).toBe("");
    plain.unmount();

    const d = withCallout({ x: 260, y: -180 });
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    expect(container.querySelector(".ds-unit")!.textContent).toBe("");
    expect(container.querySelector(".ds-callout-text")?.textContent).toContain("MSZ-AP25VGD");
  });

  it("says nothing at all when nobody has placed one", () => {
    const d = fixtureDoc();
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    expect(container.querySelectorAll(".ds-callout")).toHaveLength(0);
  });

  /* A callout is placed CLEAR of the plan on purpose — the same reason a
     note's words are — so a figure that framed only the drawing would crop
     the very label somebody moved somewhere it could be read. */
  it("is framed by the sheet, however far out it was dragged", () => {
    const far = { x: 2600, y: -1800 };
    const d = withCallout(far);
    const b = planFigureBounds(d, d.floors[0])!;
    const unit = d.objects.find((o) => o.id === "i1")!;
    const at = (unit.geometry as { at: { x: number; y: number } }).at;
    expect(b.x + b.w).toBeGreaterThan(at.x + far.x);
    expect(b.y).toBeLessThan(at.y + far.y);
  });

  /* THE IDENTITY RIDES THE EDGE, NEVER THE WORDS: this prints, so its text is
     text on white paper and the note palette's 4.5:1 floor applies — which
     four of the six system colours fail outright. */
  it("keeps the system colour off the text", () => {
    const d = withCallout({ x: 260, y: -180 });
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    const css = container.querySelector("style")!.textContent!;
    expect(css).toMatch(/\.ds-pf \.ds-callout-box \{[^}]*stroke: currentColor/);
    expect(css).toMatch(/\.ds-pf \.ds-callout-text \{[^}]*fill: #222222/);
    // and the group carries the system colour for the edge to read
    expect(container.querySelector(".ds-callout")!.getAttribute("style")).toContain(
      "rgb(46, 104, 255)"
    );
  });
});
