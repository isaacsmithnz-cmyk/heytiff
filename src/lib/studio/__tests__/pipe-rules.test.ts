/* the refrigerant pipes that can't exist (Isaac, 2026-09-29: "refuse the
   pipe"). Walk B drew all of these and the Studio let it. */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createDesign, type DesignDocument, type DesignObject, type DesignSystem } from "../document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "../packs/schema";
import { assemblePack, type PackSource } from "../packs/loader";
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

/* what a VRF pipe may JOIN (walk B, second drawing): every wrong pipe in it
   is refused, and the one right one (a box to its head) is not */
describe("pipeRefusal on a VRF, by what the pipe joins", () => {
  const dir = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(dir, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as PackMeta;
  const pack: DataPack = assemblePack({ meta, sections });

  const head = (id: string, model: string) => unit(id, "idu", model);
  const thing = (id: string, type: "joint" | "branch-box"): DesignObject => ({
    id,
    type,
    systemId: "s",
    floorId: "f",
    geometry: { kind: "point", at: { x: 0, y: 0 } },
    plane: "room",
    props: {},
  });
  const run = (id: string, a: [string, string], b: [string, string]): DesignObject => ({
    id,
    type: "pipe-run",
    systemId: "s",
    floorId: "f",
    geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    plane: "room",
    props: { startAttach: { kind: a[0], id: a[1] }, endAttach: { kind: b[0], id: b[1] } },
  });
  const J = (id: string) => ({ kind: "joint" as const, id });
  const B = (id: string) => ({ kind: "branch-box" as const, id });
  function vrf(objects: DesignObject[]): DesignDocument {
    const d = createDesign({ name: "t", mode: "blank" });
    d.systems = [{ id: "s", type: "vrf", brand: "b", colour: "#000", name: "S", settings: {} }];
    d.objects = [
      unit("o", "odu", "PUMY-SP140VKMD2-A"),
      head("m", "MSZ-AP25VGD2"),
      head("c", "PLFY-P40VEM-A"),
      thing("j1", "joint"),
      thing("b1", "branch-box"),
      thing("b2", "branch-box"),
      ...objects,
    ];
    return d;
  }

  it("an M, S or P-series head goes on a box, never a joint or the outdoor", () => {
    expect(pipeRefusal(vrf([]), "s", J("j1"), U("m"), pack)).toBe("MSZ-AP25VGD2 goes on a branch box. Run it to a box.");
    expect(pipeRefusal(vrf([]), "s", U("m"), U("o"), pack)).toBe("MSZ-AP25VGD2 goes on a branch box. Run it to a box.");
    expect(pipeRefusal(vrf([]), "s", B("b1"), U("m"), pack)).toBeNull();
  });

  it("a City Multi head goes on a joint, never a box", () => {
    expect(pipeRefusal(vrf([]), "s", U("c"), B("b1"), pack)).toBe("PLFY-P40VEM-A goes on a joint, not a branch box.");
    expect(pipeRefusal(vrf([]), "s", J("j1"), U("c"), pack)).toBeNull();
  });

  it("boxes never feed each other", () => {
    expect(pipeRefusal(vrf([]), "s", B("b1"), B("b2"), pack)).toMatch(/don't feed each other/);
  });

  it("a box takes one pipe in; a second joint or outdoor pipe on it is refused", () => {
    const fed = vrf([run("in", ["unit", "o"], ["branch-box", "b1"])]);
    expect(pipeRefusal(fed, "s", B("b1"), J("j1"), pack)).toBe("A branch box takes one pipe in. The rest go to its heads.");
    expect(pipeRefusal(fed, "s", B("b1"), U("m"), pack)).toBeNull();
  });

  it("a joint can't go on a box's pipe to a head", () => {
    const d = vrf([run("bm", ["branch-box", "b1"], ["unit", "m"])]);
    expect(pipeRefusal(d, "s", J(""), null, pack, "bm")).toBe("Nothing branches after a branch box. Run each head to its own port.");
    const main = vrf([run("ob", ["unit", "o"], ["branch-box", "b1"])]);
    expect(pipeRefusal(main, "s", J(""), null, pack, "ob")).toBeNull();
  });
});
