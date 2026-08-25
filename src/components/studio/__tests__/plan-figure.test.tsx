import { render } from "@testing-library/react";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { createNote } from "@/lib/studio/notes";
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

  /* Units can be turned on the canvas, so the printed sheet has to agree —
     an export that squares everything up is a different drawing. */
  it("prints a turned unit turned, with its labels left upright", () => {
    const d = fixtureDoc();
    const idu = d.objects.find((o) => o.id === "i1")!;
    idu.geometry = { kind: "point", at: { x: 200, y: 200 }, rotation: 90 };
    const { container } = render(
      <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
    );
    const unit = container.querySelector(".ds-unit")!;
    const turned = unit.querySelector("g[transform]")!;
    expect(turned.getAttribute("transform")).toBe("rotate(90 200 200)");
    // the model / role text is a sibling of the turned group, not inside it
    expect(turned.querySelector(".ds-unit-model")).toBeNull();
    expect(unit.querySelector(".ds-unit-model")).not.toBeNull();
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

    /* a note prints in the ink it was DRAWN in — the whole reason the hex is
       stored on the document rather than a palette id */
    it("prints each note in its own ink", () => {
      const d = fixtureDoc();
      d.objects = [
        ...d.objects,
        createNote({ floorId: "f1", rect: { x: 100, y: 100, w: 120, h: 90 },
          leader: { x: 900, y: 150 }, text: "Query", ink: "#C81E3C", id: "n_red" }),
        createNote({ floorId: "f1", rect: { x: 260, y: 100, w: 120, h: 90 },
          leader: { x: 900, y: 320 }, text: "Note", ink: "#15803D", id: "n_green" }),
      ];
      const { container } = render(
        <PlanFigure doc={d} floor={d.floors[0]} layers={ALL} grayscale={false} legend={false} urls={{}} />
      );
      const inks = [...container.querySelectorAll<SVGGElement>(".ds-note")].map(
        (g) => g.style.color
      );
      expect(inks).toEqual(["rgb(200, 30, 60)", "rgb(21, 128, 61)"]);
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
