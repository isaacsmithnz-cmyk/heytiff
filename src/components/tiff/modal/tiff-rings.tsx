"use client";

import type { RefObject } from "react";
import { FlyingRingSvg, TiffMarkDefs } from "@/components/notes/tiff-mark";
import type { FlyRing, RingParts } from "./rings";

/* THE RINGS' LAYERS (./rings has the choreography and the reasons).

   Two layers, either side of the modal on the modal's own layer, so it is
   their order in the body that stacks them:

     under   the fill while it reshapes: the modal's own ink, grown inside
             the rings' outline, before the modal itself takes over.
     over    the outline, the modal's border, and the two flying rings.

   Both are fixed to the viewport and drawn in its pixels, so nothing here
   needs a viewBox or a resize; neither takes a pointer. */

type Key = "a" | "b";
const KEYS: Key[] = ["a", "b"];

export function RingsUnder({ fillRef }: { fillRef: RefObject<SVGSVGElement | null> }) {
  return (
    <svg className="tm-fill" ref={fillRef} aria-hidden="true" focusable="false">
      <path className="tm-fu" />
      <path className="tm-fp" fillRule="evenodd" />
    </svg>
  );
}

/* Every class is written out whole: a class built from a template is one a
   stylesheet sweep cannot see (the dead-CSS sweep deleted `.tiffbtn-sheet`). */
const CLS = {
  a: { line: "tm-line tm-a" },
  b: { line: "tm-line tm-b" },
} as const;

/* A ring, A first then B: `partsOf` finds them in that order. */
function Ring({ k }: { k: Key }) {
  return (
    <div className="tm-fr">
      <div className="tm-fr-pos">
        <div className="tm-fr-gim">
          <div className="tm-fr-size">
            <div className="tm-fr-arc">
              {/* the frame's skin first, then the paper's: `partsOf` finds them in that order */}
              <FlyingRingSvg axis={k} ground="ink" className="tm-sk" />
              <FlyingRingSvg axis={k} ground="paper" className="tm-sk" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RingsOver({ overRef }: { overRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div className="tm-over" ref={overRef} aria-hidden="true">
      <TiffMarkDefs ground="ink" />
      <TiffMarkDefs ground="paper" />
      <svg className="tm-rim" focusable="false">
        {KEYS.map((k) => (
          <path key={k} className={CLS[k].line} />
        ))}
      </svg>
      <div className="tm-fly">
        <Ring k="a" />
        <Ring k="b" />
      </div>
    </div>
  );
}

/** The parts the choreography moves, found in the two layers once they are on the page. */
export function partsOf(fill: SVGSVGElement, over: HTMLDivElement): RingParts | null {
  const q = <E extends Element>(root: ParentNode, sel: string) => root.querySelector<E>(sel);
  const rings = [...over.querySelectorAll<HTMLElement>(".tm-fr")];
  const ring = (k: Key): FlyRing | null => {
    const root = rings[k === "a" ? 0 : 1];
    if (!root) return null;
    const pos = q<HTMLElement>(root, ".tm-fr-pos");
    const gim = q<HTMLElement>(root, ".tm-fr-gim");
    const size = q<HTMLElement>(root, ".tm-fr-size");
    const arc = q<HTMLElement>(root, ".tm-fr-arc");
    const [ink, paper] = [...root.querySelectorAll<SVGSVGElement>(".tm-sk")];
    if (!pos || !gim || !size || !arc || !ink || !paper) return null;
    return {
      root,
      pos,
      gim,
      size,
      arc,
      ink,
      paper,
      rings: [...root.querySelectorAll<SVGElement>(".tiffbtn-ring")],
      runs: [...root.querySelectorAll<SVGElement>(".runarc")],
      runfull: [...root.querySelectorAll<SVGElement>(".runfull")],
    };
  };
  const a = ring("a");
  const b = ring("b");
  const outline = q<SVGSVGElement>(over, ".tm-rim");
  const la = q<SVGPathElement>(over, ".tm-line.tm-a");
  const lb = q<SVGPathElement>(over, ".tm-line.tm-b");
  const fp = q<SVGPathElement>(fill, ".tm-fp");
  const fu = q<SVGPathElement>(fill, ".tm-fu");
  if (!a || !b || !outline || !la || !lb || !fp || !fu) return null;
  return {
    fly: { a, b },
    outline,
    line: { a: la, b: lb },
    fill,
    fp,
    fu,
  };
}
