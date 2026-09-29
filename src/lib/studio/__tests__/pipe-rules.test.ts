/* the refrigerant pipes that can't exist (Isaac, 2026-09-29: "refuse the
   pipe"). Walk B drew all of these and the Studio let it. */
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "../document";
import { pipeRefusal } from "../pipe-rules";

const unit = (id: string, role: "idu" | "odu", model: string): DesignObject => ({
  id,
  type: "unit",
  systemId: "s",
  floorId: "f",
  geometry: { kind: "point", at: { x: 0, y: 0 } },
  plane: "room",
  props: { role, model },
});
const pipe = (a: string, b: string, kind = "unit", type = "pipe-run"): DesignObject => ({
  id: `${a}-${b}`,
  type,
  systemId: "s",
  floorId: "f",
  geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  plane: "room",
  props: { startAttach: { kind: "unit", id: a }, endAttach: { kind, id: b } },
});
function docOf(type: DesignSystem["type"], heads: number, objects: DesignObject[] = []): DesignDocument {
  const d = createDesign({ name: "t", mode: "blank" });
  const allocations = [
    { id: "o", role: "odu", model: "ODU" },
    ...Array.from({ length: heads }, (_, i) => ({ id: `h${i}`, role: "idu", model: "HEAD", roomId: `r${i}` })),
  ];
  d.systems = [{ id: "s", type, brand: "b", colour: "#000", name: "S", settings: { allocations } }];
  d.objects = [
    unit("o", "odu", "PUMY-SP140VKMD2-A"),
    ...Array.from({ length: heads }, (_, i) => unit(`h${i}`, "idu", `MSZ-AP2${i}VGD`)),
    ...objects,
  ];
  return d;
}
const U = (id: string) => ({ kind: "unit" as const, id });

describe("pipeRefusal", () => {
  it("a head never feeds another head, in any system", () => {
    for (const type of ["vrf", "multi-split", "split"] as const)
      expect(pipeRefusal(docOf(type, 2), "s", U("h0"), U("h1"))).toMatch(/never feeds another head/);
  });

  it("a head takes one pipe, from either end", () => {
    const d = docOf("vrf", 2, [pipe("h0", "j", "joint")]);
    expect(pipeRefusal(d, "s", U("h0"), null)).toBe("MSZ-AP20VGD already has its pipe");
    expect(pipeRefusal(d, "s", { kind: "joint", id: "j" }, U("h0"))).toBe("MSZ-AP20VGD already has its pipe");
    expect(pipeRefusal(d, "s", { kind: "joint", id: "j" }, U("h1"))).toBeNull();
  });

  it("a VRF outdoor takes one pipe: the next lands on it as a joint", () => {
    const d = docOf("vrf", 2, [pipe("o", "b", "branch-box")]);
    expect(pipeRefusal(d, "s", U("o"), null)).toMatch(/takes one pipe. Land this one on it/);
    expect(pipeRefusal(docOf("vrf", 2), "s", U("o"), null)).toBeNull();
  });

  it("a split outdoor takes one pipe; a multi's takes one per head", () => {
    expect(pipeRefusal(docOf("split", 1, [pipe("o", "h0")]), "s", U("o"), null)).toBe("The outdoor already has its pipe");
    const multi = docOf("multi-split", 2, [pipe("o", "h0")]);
    expect(pipeRefusal(multi, "s", U("o"), U("h1"))).toBeNull();
    const full = docOf("multi-split", 2, [pipe("o", "h0"), pipe("o", "h1")]);
    expect(pipeRefusal(full, "s", U("o"), null)).toBe("The outdoor already has a pipe for every head");
  });

  it("drain and cable runs are not refrigerant and don't count", () => {
    const d = docOf("vrf", 1, [pipe("h0", "x", "unit", "drain-run"), pipe("o", "x", "unit", "cable-run")]);
    expect(pipeRefusal(d, "s", U("h0"), null)).toBeNull();
    expect(pipeRefusal(d, "s", U("o"), null)).toBeNull();
  });

  it("a pipe needs two ends", () => {
    expect(pipeRefusal(docOf("vrf", 1), "s", U("o"), U("o"))).toBe("A pipe needs two ends");
  });
});
