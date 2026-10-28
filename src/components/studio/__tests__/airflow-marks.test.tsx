/* Airflow marks (airflow-marks.ts, airflow-layer.tsx; Isaac, 2026-10-28:
   "just short arrows … two or three … slightly squiggly", "Blue for supply,
   red for return"): three blue arrows for supply, two red for return, put
   down pointing the way they were pulled; with Select a click picks one and
   a drag moves it. */

import { render, screen, fireEvent } from "@testing-library/react";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import { AIRFLOW_INKS, airflowMark, hitMark, markShapes, pullDeg } from "@/lib/studio/airflow-marks";
import { AirflowLayer } from "../airflow-layer";

function docWith(...marks: ReturnType<typeof airflowMark>[]): DesignDocument {
  const doc = createDesign({ name: "x", mode: "blank" });
  doc.floors[0] = { ...doc.floors[0], scaleMmPerUnit: 10 };
  return { ...doc, objects: [...doc.objects, ...marks] };
}

describe("a mark's shape", () => {
  it("is three arrows for supply and two for return, each a wavy line with a head", () => {
    expect(markShapes({ x: 0, y: 0 }, 0, "supply", 10)).toHaveLength(3);
    const ret = markShapes({ x: 0, y: 0 }, 0, "return", 10);
    expect(ret).toHaveLength(2);
    for (const s of ret) {
      expect(s.line.split(" L").length).toBeGreaterThan(10);
      expect(s.head).toMatch(/^M[\d.-]+ [\d.-]+ L.* Z$/);
    }
    expect(AIRFLOW_INKS).toEqual({ supply: "#2563EB", return: "#EF4444" });
  });

  it("points the way it was pulled; a press that never moved points along the plan", () => {
    expect(pullDeg({ x: 0, y: 0 }, { x: 0, y: 50 }, 8)).toBe(90);
    expect(pullDeg({ x: 0, y: 0 }, { x: -50, y: 0 }, 8)).toBe(180);
    expect(pullDeg({ x: 0, y: 0 }, { x: 3, y: 3 }, 8)).toBe(0);
  });

  it("is hit over its footprint, turned with it", () => {
    const m = airflowMark("f", { x: 0, y: 0 }, 90, "supply");
    // 750 mm long at 10 mm a unit runs ±37.5 along +y once turned; across,
    // three arrows 220 apart with their wave and head reach ±37
    expect(hitMark(m, { x: 0, y: 37 }, 10, 0)).toBe(true);
    expect(hitMark(m, { x: 0, y: 39 }, 10, 0)).toBe(false);
    expect(hitMark(m, { x: 36, y: 0 }, 10, 0)).toBe(true);
    expect(hitMark(m, { x: 39, y: 0 }, 10, 0)).toBe(false);
  });
});

describe("AirflowLayer", () => {
  const draw = (doc: DesignDocument, onSelect = jest.fn(), onMutate = jest.fn(), interactive = true) =>
    render(
      <svg>
        <AirflowLayer
          doc={doc}
          floor={doc.floors[0]}
          zoom={1}
          interactive={interactive}
          selectedId={null}
          draft={null}
          toWorld={(e) => ({ x: e.clientX, y: e.clientY })}
          onSelect={onSelect}
          onMutate={onMutate}
        />
      </svg>
    );

  it("draws every mark on the floor in its ink", () => {
    const doc = docWith(airflowMark("x", { x: 0, y: 0 }, 0, "supply"), airflowMark("x", { x: 0, y: 0 }, 0, "return"));
    doc.objects = doc.objects.map((o) => (o.type === "airflow-mark" ? { ...o, floorId: doc.floors[0].id } : o));
    const { container } = draw(doc);
    expect(screen.getByRole("img", { name: "Supply airflow" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Return airflow" })).toBeInTheDocument();
    expect(container.querySelectorAll(`path[fill="${AIRFLOW_INKS.supply}"]`)).toHaveLength(3);
    expect(container.querySelectorAll(`path[fill="${AIRFLOW_INKS.return}"]`)).toHaveLength(2);
  });

  it("a click picks a mark; a drag moves it and picks it", () => {
    const base = docWith();
    const mark = airflowMark(base.floors[0].id, { x: 100, y: 100 }, 0, "supply");
    const doc = { ...base, objects: [...base.objects, mark] };
    const onSelect = jest.fn();
    const onMutate = jest.fn();
    draw(doc, onSelect, onMutate);
    const el = screen.getByRole("img", { name: "Supply airflow" });
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 101, clientY: 100, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith(mark.id);
    expect(onMutate).not.toHaveBeenCalled();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 140, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 140, clientY: 160, pointerId: 1 });
    const after = onMutate.mock.calls[0][0](doc) as DesignDocument;
    expect(after.objects.find((o) => o.id === mark.id)!.geometry).toEqual({ kind: "point", at: { x: 140, y: 160 }, rotation: 0 });
  });

  it("nothing moves while another tool is armed", () => {
    const base = docWith();
    const doc = { ...base, objects: [...base.objects, airflowMark(base.floors[0].id, { x: 0, y: 0 }, 0, "return")] };
    const onMutate = jest.fn();
    draw(doc, jest.fn(), onMutate, false);
    const el = screen.getByRole("img", { name: "Return airflow" });
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 50, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 0, pointerId: 1 });
    expect(onMutate).not.toHaveBeenCalled();
  });
});
