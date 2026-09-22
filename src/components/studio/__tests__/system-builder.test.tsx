/* The system builder's window: one system at a time, its zones given. Heads
   are dragged from the unit list onto zone cards, a whole-system unit onto
   the band, an outdoor is picked on the Outdoor tab or proposed from the
   heads, and Done hands the draft back as one change. Against the real
   shipped pack, like builder-jobs.test.ts. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemBuilder } from "../system-builder";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { addHead, allocationsOf, chooseOutdoor, moveZone } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";

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
const basis = "worst-of-both" as const;

/* the house: zones belong to the plan (systemId null); their loads come
   from the load model on their areas, never typed in */
function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" }); // 10 mm per unit
  const floorId = doc.floors[0].id;
  const room = (id: string, name: string, x: number, y: number, w: number, h: number) =>
    doc.objects.push({
      id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
      },
      props: { name },
    } as DesignObject);
  room("living", "Living", 0, 0, 1000, 960); // ~96 m²
  room("bed1", "Bed 1", 1100, 0, 400, 300); // 12 m²
  room("bed2", "Bed 2", 1600, 0, 450, 400); // 18 m²
  room("study", "Study", 1100, 500, 400, 320); // ~12.8 m²
  return doc;
}

/** a system that has claimed these zones and holds nothing yet */
function claimed(doc: DesignDocument, zoneIds: string[]): { doc: DesignDocument; systemId: string } {
  const made = newSystem(doc, pack.meta.version);
  let d = made.doc;
  for (const z of zoneIds) d = claimZone(d, made.systemId, z);
  return { doc: d, systemId: made.systemId };
}

/** jsdom implements no DataTransfer — hand the events a real store so a drop
    reads the payload the row wrote, the way a browser's would */
const transfer = () => {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? "",
    effectAllowed: "none",
    dropEffect: "none",
  };
};

const schematic = () => screen.getByRole("img", { name: /^Schematic of/ });
const zoneNames = () => [...schematic().querySelectorAll(".ds-sb-zone-name")].map((t) => t.textContent);
const zoneCard = (name: string) =>
  [...schematic().querySelectorAll(".ds-sb-zone")].find(
    (g) => g.querySelector(".ds-sb-zone-name")?.textContent === name
  ) as HTMLElement;
const headModels = () =>
  [...schematic().querySelectorAll(".ds-sb-zone .ds-sb-head-model")].map((t) => t.textContent);
/** the rail's figure under a label */
const stat = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

/** drag a unit's row out of the list and drop it on a target of the schematic */
function dragRow(model: string, target: Element | (() => Element)) {
  const list = screen.getByRole("region", { name: "Choose a unit" });
  fireEvent.change(within(list).getByRole("searchbox", { name: "Search units" }), { target: { value: model } });
  /* a target given as a function is found AFTER the search: searching moves
     the head-type crumb, and the band only exists while the crumb is on a
     style that can serve the whole system */
  const to = typeof target === "function" ? target() : target;
  const table = list.querySelector(".ds-ub-table tbody") as HTMLElement;
  const row = within(table).getByText(model).closest("tr") as HTMLElement;
  const dt = transfer();
  fireEvent.dragStart(row, { dataTransfer: dt });
  // the payload the drag carries is the row's own model, in the builder's format
  expect(JSON.parse(dt.getData("application/x-heytiff-builder-unit"))).toEqual({ iduModel: model });
  fireEvent.dragEnter(to, { dataTransfer: dt });
  fireEvent.dragOver(to, { dataTransfer: dt });
  fireEvent.drop(to, { dataTransfer: dt });
}

beforeEach(() => window.localStorage.clear());

describe("SystemBuilder", () => {
  it("opens on one system with its zones as cards, takes a head dropped on a zone, and Done hands the draft back as one change", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const onCommit = jest.fn();
    render(
      <SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={onCommit} onClose={() => {}} />
    );

    expect(zoneNames()).toEqual(["Bed 1", "Study"]);
    // before the first unit the rail shows Zones and Load only
    expect(stat("Zones")).toHaveTextContent("2");
    expect(stat("Load")).toHaveTextContent(/kW/);
    expect(screen.queryByText("Combination", { selector: "dt" })).toBeNull();
    expect(within(zoneCard("Bed 1")).getByText("No unit yet")).toBeInTheDocument();

    dragRow("MSZ-AP25VGD2", zoneCard("Bed 1"));

    expect(within(zoneCard("Bed 1")).getByText("MSZ-AP25VGD2")).toBeInTheDocument();
    expect(within(zoneCard("Bed 1")).getByText(/^Fits, \d+%$/)).toBeInTheDocument();
    expect(within(zoneCard("Study")).getByText("No unit yet")).toBeInTheDocument();
    // two zones claimed, so the head makes a multi and its outdoor is proposed
    expect(stat("Type")).toHaveTextContent("Multi");
    expect(stat("Combination")).toHaveTextContent("Valid");
    expect(within(schematic()).getByText(/^Proposed, combination valid$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const built = onCommit.mock.calls[0][0] as DesignDocument;
    const allocs = allocationsOf(built.systems.find((s) => s.id === made.systemId)!);
    expect(allocs.map((a) => [a.role, a.model, a.roomId])).toEqual([
      ["idu", "MSZ-AP25VGD2", "bed1"],
      ["odu", allocs[1].model, null],
    ]);
    expect(allocs[1].model).toMatch(/^MXZ-/);
  });

  it("a zone card's cross takes the zone and its head off the system, and Add zone claims another of the plan's zones", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    render(<SystemBuilder doc={doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    expect(headModels()).toEqual(["MSZ-AP25VGD2"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear Bed 1 from System 1" }));
    expect(zoneNames()).toEqual(["Study"]);
    expect(headModels()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Add zone" }));
    const list = screen.getByRole("dialog", { name: "Add zone" });
    // the plan's zones this system does not have: none is on another system
    expect(within(list).getByText("Without a system")).toBeInTheDocument();
    expect(within(list).queryByText("On another system")).toBeNull();
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([
      expect.stringContaining("Living"),
      expect.stringContaining("Bed 1"),
      expect.stringContaining("Bed 2"),
    ]);
    fireEvent.click(within(list).getByRole("button", { name: /Bed 2/ }));
    expect(zoneNames()).toEqual(["Study", "Bed 2"]);
    expect(screen.queryByRole("dialog", { name: "Add zone" })).toBeNull();
  });

  it("renames the system from its name in the rail", () => {
    const made = claimed(house(), ["bed1"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "System 1" }));
    const input = screen.getByRole("textbox", { name: "System name" });
    fireEvent.change(input, { target: { value: "Bedrooms" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Bedrooms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Bed 1 from Bedrooms" })).toBeInTheDocument();
  });

  it("gives the list and the schematic the share of the window it was last dragged to", () => {
    window.localStorage.setItem("heytiff.studio.builderSplit", "70");
    const made = claimed(house(), ["bed1"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const edge = screen.getByRole("separator", { name: "Unit list and schematic" });
    expect(edge).toHaveAttribute("aria-valuenow", "70");
    fireEvent.keyDown(edge, { key: "ArrowUp" });
    expect(edge).toHaveAttribute("aria-valuenow", "65");
    expect(window.localStorage.getItem("heytiff.studio.builderSplit")).toBe("65");
  });

  it("a unit dropped on the band serves the whole system, and the rail reads Ducted", () => {
    const made = claimed(house(), ["bed1", "study"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    // two zones start the trail on Multi; a ducted unit pairs with its own
    // outdoor, so the family goes to Split and the list to pairs
    fireEvent.click(screen.getByRole("button", { name: /^Family of outdoor/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Split" }));
    /* THE BAND IS NOT THERE YET. It is a drop target for a unit that serves
       the whole system, and nothing in the list is one until the head type
       says so — an empty Whole system box beside a multi of wall heads is a
       target for something nobody is holding. */
    expect(schematic().querySelector(".ds-sb-band")).toBeNull();
    // the search moves the head type crumb to the style that has the unit
    dragRow("PEAD-M125JAA(D)", () => schematic().querySelector(".ds-sb-band") as HTMLElement);
    const band = schematic().querySelector(".ds-sb-band") as HTMLElement;

    expect(stat("Type")).toHaveTextContent("Ducted");
    expect(within(band).getByText("PEAD-M125JAA(D)")).toBeInTheDocument();
    expect(within(band).getByText(/serves the whole system/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Head type: Ducted/ })).toBeInTheDocument();
    // every zone reads the whole-system unit against all the zones' load
    expect(within(zoneCard("Bed 1")).getByText(/^Fits, \d+%$/)).toBeInTheDocument();
    expect(within(zoneCard("Study")).getByText(/^Fits, \d+%$/)).toBeInTheDocument();
    expect(stat("Combination")).toHaveTextContent("Valid");
  });

  /* the mock's step 12: Study, dragged onto System 1, brings its head; the
     split outdoor picked by hand takes one head, so the builder opens with
     Done off until an outdoor that takes both is on */
  describe("a move that cannot be installed", () => {
    function moved() {
      const one = claimed(house(), ["living"]);
      let d = addHead(one.doc, pack, { systemId: one.systemId, zoneId: "living", iduModel: "MSZ-AP80VGD2" });
      d = chooseOutdoor(d, pack, basis, one.systemId, "MUZ-AP80VG2");
      const two = claimed(d, ["bed1", "study"]);
      d = addHead(two.doc, pack, { systemId: two.systemId, zoneId: "bed1", iduModel: "MSZ-AP20VGD" });
      d = addHead(d, pack, { systemId: two.systemId, zoneId: "study", iduModel: "MSZ-AP25VGD2" });
      return { doc: d, start: moveZone(d, pack, "study", two.systemId, one.systemId), systemId: one.systemId };
    }
    const outdoorRow = (model: string) => {
      const table = document.querySelector(".ds-sb-outdoors tbody") as HTMLElement;
      return within(table).getByText(model).closest("tr") as HTMLElement;
    };

    it("opens on the Outdoor tab with Done off and the reason beside it; the multi that takes both heads reads Valid, and picking it turns Done on", () => {
      const t = moved();
      const onCommit = jest.fn();
      render(
        <SystemBuilder doc={t.doc} start={t.start} systemId={t.systemId} pack={pack} onCommit={onCommit} onClose={() => {}} />
      );
      const done = screen.getByRole("button", { name: "Done" });
      expect(done).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent("MUZ-AP80VG2 takes one head");
      expect(stat("Combination")).toHaveTextContent("Fails");
      expect(stat("Type")).toHaveTextContent("Multi");
      expect(within(zoneCard("Study")).getByText("Can't join MUZ-AP80VG2")).toBeInTheDocument();
      expect(within(schematic()).getByText("Picked, combination fails")).toBeInTheDocument();

      expect(screen.getByRole("button", { name: "Outdoor" })).toHaveAttribute("aria-pressed", "true");
      expect(within(outdoorRow("MUZ-AP80VG2")).getByText("Fails")).toBeInTheDocument();
      expect(within(outdoorRow("MUZ-AP80VG2")).getByText("On the system")).toBeInTheDocument();
      const six = outdoorRow("MXZ-6F120VGD");
      expect(within(six).getByText("Valid")).toBeInTheDocument();
      expect(within(six).getByText("Proposal")).toBeInTheDocument();

      fireEvent.click(six);
      expect(done).toBeEnabled();
      expect(stat("Combination")).toHaveTextContent("Valid");
      expect(within(schematic()).getByText("Picked, combination valid")).toBeInTheDocument();

      fireEvent.click(done);
      const built = onCommit.mock.calls[0][0] as DesignDocument;
      const sys = built.systems.find((s) => s.id === t.systemId)!;
      expect(allocationsOf(sys).find((a) => a.role === "odu")?.model).toBe("MXZ-6F120VGD");
      expect(allocationsOf(sys).filter((a) => a.role === "idu").map((a) => a.roomId)).toEqual(["living", "study"]);
    });

    it("Use the proposal hands the choice back to the heads and turns Done on", () => {
      const t = moved();
      render(
        <SystemBuilder doc={t.doc} start={t.start} systemId={t.systemId} pack={pack} onCommit={() => {}} onClose={() => {}} />
      );
      fireEvent.click(screen.getByRole("button", { name: "Use the proposal" }));
      expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
      expect(stat("Combination")).toHaveTextContent("Valid");
      expect(within(schematic()).getByText("MXZ-6F120VGD")).toBeInTheDocument();
      expect(within(schematic()).getByText("Proposed, combination valid")).toBeInTheDocument();
      // the choice is the heads' again, so there is nothing to hand back
      expect(screen.queryByRole("button", { name: "Use the proposal" })).toBeNull();
    });
  });

  /* ADD ZONE IS A CONTROL, NOT A ZONE. It sits last in the grid so it reads
     as the next card along, but the system does not serve it: the trunk used
     to run into it and draw the system as feeding a button. */
  it("does not wire Add zone into the system", () => {
    const made = claimed(house(), ["bed1", "study"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const add = schematic().querySelector(".ds-sb-add rect") as SVGRectElement;
    const centre = Number(add.getAttribute("x")) + Number(add.getAttribute("width")) / 2;
    const top = Number(add.getAttribute("y"));
    const trunk = schematic().querySelector("path.ds-sb-line")!.getAttribute("d")!;
    /* the path opens with the stem from the source down to the bus, then the
       bus, then one drop per wired card FROM the bus: "M<x> <busY> V<top>" */
    const busY = trunk.match(/^M[\d.]+ [\d.]+ V([\d.]+)/)![1];
    const drops = [...trunk.matchAll(new RegExp(`M([\\d.]+) ${busY} V`, "g"))].map((m) => Number(m[1]));
    // one per zone, and the two zones are the only ones
    expect(drops).toHaveLength(2);
    expect(drops).not.toContain(centre);
    // the bus stops short of Add zone rather than running under it
    const bus = trunk.match(/M[\d.]+ [\d.]+ H([\d.]+)/)!;
    expect(Number(bus[1])).toBeLessThan(centre);
    expect(top).toBeGreaterThan(0);
  });

  /* WHICH ZONE ADD FILLS. It was always the first zone with nothing in it,
     derived and unchangeable, so the button said Add to Master Bedroom and
     there was no way to say Study. */
  it("aims Add at the zone card you click, and starts on the first empty one", () => {
    const made = claimed(house(), ["bed1", "study"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const addButton = () => screen.getByRole("button", { name: /^Add to / });
    expect(addButton()).toHaveTextContent("Add to Bed 1");

    fireEvent.click(screen.getByRole("button", { name: "Put the next unit in Study" }));
    expect(addButton()).toHaveTextContent("Add to Study");
    // and the card it will fill says so
    expect(zoneCard("Study")).toHaveClass("aimed");
    expect(zoneCard("Bed 1")).not.toHaveClass("aimed");
  });
});