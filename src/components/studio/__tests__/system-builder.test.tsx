/* The system builder's window: its unit list is the unit selector (tabs,
   search, sections, spec sheet), a unit added there lands in the targeted
   room's square, and a head whose room was deleted is still shown so it can
   be given a room. Against the real shipped pack, like builder-jobs.test.ts. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemBuilder } from "../system-builder";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addSplit, allocationsOf } from "@/lib/studio/builder";

const SEED_DIR = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED_DIR, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED_DIR, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();

function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" }); // 10 mm per unit
  const floorId = doc.floors[0].id;
  const room = (id: string, name: string, x: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y: 0 },
          { x: x + w, y: 0 },
          { x: x + w, y: h },
          { x, y: h },
        ],
      },
      props: { name },
    } as DesignObject);
  room("bed1", "Bed 1", 0, 400, 300); // 12 m²
  room("study", "Study", 500, 400, 320);
  return doc;
}

const schematic = () => screen.getByRole("img", { name: /Schematic/ });
const unitModels = () =>
  [...schematic().querySelectorAll(".ds-sb-unit-model")].map((t) => t.textContent);

beforeEach(() => window.localStorage.clear());

describe("SystemBuilder", () => {
  it("lists units the way the unit selector does, and adds the one found to the targeted room", () => {
    const onCommit = jest.fn();
    render(<SystemBuilder doc={house()} pack={pack} onCommit={onCommit} onClose={() => {}} />);

    const list = screen.getByRole("region", { name: "Choose a unit" });
    // the selector's own furniture: style tabs, a search, sections under a load
    expect(within(list).getByRole("button", { name: /Wall-mounted/ })).toBeInTheDocument();
    expect(within(list).getByText("Recommended")).toBeInTheDocument();

    fireEvent.change(within(list).getByRole("searchbox", { name: "Search units" }), {
      target: { value: "ap25" },
    });
    // the model shows in the table and in the spec sheet beside it
    const table = list.querySelector(".ds-ub-table tbody") as HTMLElement;
    const row = within(table).getByText("MSZ-AP25VGD2").closest("tr") as HTMLElement;
    fireEvent.click(row);
    // the first room on the plan is the target
    fireEvent.click(within(list).getByRole("button", { name: "Add to Bed 1" }));

    expect(unitModels()).toEqual(["MSZ-AP25VGD2"]);
    expect(screen.getByText(/2 rooms, 2 units/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const built = onCommit.mock.calls[0][0] as DesignDocument;
    const allocs = allocationsOf(built.systems[0]);
    expect(allocs.map((a) => [a.role, a.model, a.roomId])).toEqual([
      ["idu", "MSZ-AP25VGD2", "bed1"],
      ["odu", allocs[1].model, null],
    ]);
    expect(allocs[1].model).toMatch(/^MUZ-AP25/);
  });

  it("keeps a head whose room was deleted on the plan, under No room, until it is given one", () => {
    const doc = house();
    const r = addSplit(doc, pack, { roomId: "study", iduModel: "MSZ-AP25VGD2", oduModel: "MUZ-AP25VG2" });
    // the study is deleted after the unit was built into it
    const gone = { ...r.doc, objects: r.doc.objects.filter((o) => o.id !== "study") };
    render(<SystemBuilder doc={gone} pack={pack} onCommit={() => {}} onClose={() => {}} />);

    expect(within(schematic()).getByText("No room")).toBeInTheDocument();
    expect(unitModels()).toEqual(["MSZ-AP25VGD2"]);

    fireEvent.click(schematic().querySelector(".ds-sb-unit") as Element);
    const select = screen.getByRole("combobox", { name: "Room" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe("No room");

    fireEvent.change(select, { target: { value: "bed1" } });
    expect(within(schematic()).queryByText("No room")).toBeNull();
  });

  it("gives the list and the schematic the share of the window it was last dragged to", () => {
    window.localStorage.setItem("heytiff.studio.builderSplit", "70");
    render(<SystemBuilder doc={house()} pack={pack} onCommit={() => {}} onClose={() => {}} />);
    const edge = screen.getByRole("separator", { name: "Unit list and schematic" });
    expect(edge).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(edge, { key: "ArrowUp" });
    expect(edge).toHaveAttribute("aria-valuenow", "65");
    expect(window.localStorage.getItem("heytiff.studio.builderSplit")).toBe("65");
  });
});
