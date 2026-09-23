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
import { sizingCapacityKw } from "@/lib/studio/loads";

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

/* the piping rail down the left: the outdoor, and the zones under it */
const schematic = () => screen.getByRole("region", { name: /^Schematic of/ });
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
    // before the first unit the header shows Zones and Load only
    expect(stat("Zones")).toHaveTextContent("2");
    expect(stat("Load")).toHaveTextContent(/kW/);
    expect(screen.queryByText("Type", { selector: "dt" })).toBeNull();
    expect(screen.queryByText("Covered", { selector: "dt" })).toBeNull();
    expect(within(zoneCard("Bed 1")).getByText("No unit yet")).toBeInTheDocument();

    dragRow("MSZ-AP25VGD2", zoneCard("Bed 1"));

    expect(within(zoneCard("Bed 1")).getByText("MSZ-AP25VGD2")).toBeInTheDocument();
    expect(within(zoneCard("Bed 1")).getByText("Covered")).toBeInTheDocument();
    expect(within(zoneCard("Study")).getByText("No unit yet")).toBeInTheDocument();
    // an empty zone is short by what it needs, in amber: not wrong, not done
    expect(within(zoneCard("Study")).getByText(/^\d+\.\d kW short$/)).toHaveClass("warn");
    // two zones claimed, so the head makes a multi and its outdoor is proposed
    expect(stat("Type")).toHaveTextContent("Multi");
    expect(stat("Covered")).toHaveTextContent(/^\d+\.\d of \d+\.\d kW$/);
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

  /* THE EDITOR IS THREE COLUMNS (Isaac's "System Editor" mock, 2026-09-23):
     the piping down the left, the list in the middle, and the detail on the
     right, full height. The list's own spec sheet is mounted in that column,
     not beside the list; a unit already on the system takes its place there. */
  it("puts the list's spec sheet in the right-hand column, and a unit on the system in its place", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    render(<SystemBuilder doc={doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const list = screen.getByRole("region", { name: "Choose a unit" });
    const side = screen.getByRole("complementary", { name: "Unit detail" });
    expect(side.querySelector(".ds-ub-detail")).not.toBeNull();
    expect(list.querySelector(".ds-ub-detail")).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();

    fireEvent.click(within(zoneCard("Bed 1")).getByRole("button", { name: "MSZ-AP25VGD2 in Bed 1" }));
    const open = screen.getByRole("complementary", { name: "Selected unit" });
    expect(within(open).getByRole("heading", { name: "MSZ-AP25VGD2" })).toBeInTheDocument();
    expect(document.querySelector(".ds-ub-detail")).toBeNull();
    fireEvent.click(within(open).getByRole("button", { name: "Close unit detail" }));
    expect(screen.getByRole("complementary", { name: "Unit detail" }).querySelector(".ds-ub-detail")).not.toBeNull();
  });

  it("says over the Add button what the unit does for the zone it goes in", () => {
    const made = claimed(house(), ["bed1"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const list = screen.getByRole("region", { name: "Choose a unit" });
    fireEvent.change(within(list).getByRole("searchbox", { name: "Search units" }), { target: { value: "MSZ-AP20VGD" } });
    fireEvent.click(within(list.querySelector(".ds-ub-table tbody") as HTMLElement).getByText("MSZ-AP20VGD").closest("tr")!);
    expect(screen.getByRole("button", { name: "Add to Bed 1" })).toBeInTheDocument();
    expect(document.querySelector(".ds-ub-addnote")!.textContent).toMatch(/^(Covers Bed 1 \(needs \d+\.\d kW\)|\d+\.\d kW short for Bed 1)$/);
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
    // the band's pipe, from its pair, where its line used to carry it
    expect(within(band).getByText(/\d+(\.\d+)? \/ \d+(\.\d+)? mm/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Head type: Ducted/ })).toBeInTheDocument();
    // every zone reads the whole-system unit against all the zones' load,
    // and names it as the unit that serves it
    expect(within(zoneCard("Bed 1")).getByText("Covered")).toBeInTheDocument();
    expect(within(zoneCard("Study")).getByText("Covered")).toBeInTheDocument();
    expect(within(zoneCard("Study")).getByText("PEAD-M125JAA(D)")).toBeInTheDocument();
    expect(within(zoneCard("Study")).queryByText("No unit yet")).toBeNull();
    expect(within(schematic()).getByText(/combination valid$/)).toBeInTheDocument();
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
      expect(within(schematic()).getByText("Picked, combination valid")).toBeInTheDocument();
      // the right-hand column reads the outdoor on the system
      const side = screen.getByRole("complementary", { name: "Outdoor unit" });
      expect(within(side).getByRole("heading", { name: "MXZ-6F120VGD" })).toBeInTheDocument();

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
      expect(within(schematic()).getByText("MXZ-6F120VGD")).toBeInTheDocument();
      expect(within(schematic()).getByText("Proposed, combination valid")).toBeInTheDocument();
      // the choice is the heads' again, so there is nothing to hand back
      expect(screen.queryByRole("button", { name: "Use the proposal" })).toBeNull();
    });
  });

  /* ADD ZONE IS A CONTROL, NOT A ZONE. It sits under the zones so it reads
     as the next one along, but the system does not serve it: no line runs
     into it. Every zone has one line of its own that turns into its card. */
  it("does not wire Add zone into the system", () => {
    const made = claimed(house(), ["bed1", "study"]);
    render(<SystemBuilder doc={made.doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const add = screen.getByRole("button", { name: "Add zone" });
    expect(add.closest(".ds-sb-addwrap")!.querySelector(".ds-sb-pipe")).toBeNull();
    const rows = [...schematic().querySelectorAll(".ds-sb-row")].filter((r) => r.querySelector(".ds-sb-zone"));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.querySelectorAll(".ds-sb-pipe.h")).toHaveLength(1);
  });

  /* what the rail took away and Isaac asked back (2026-09-23): each unit's kW
     on its line, and the pipe size at the right of the zone's word */
  it("a unit on a zone card shows its kW, and the card the unit's pipe size", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    render(<SystemBuilder doc={doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const row = pack.indoor_units.find((u) => u.model === "MSZ-AP25VGD2")!;
    const card = zoneCard("Bed 1");
    expect(card.querySelector(".ds-sb-zone-kw")!.textContent).toBe(
      `${sizingCapacityKw(row, doc.settings.sizingBasis).toFixed(1)} kW`
    );
    // two zones make a multi, and a multi head's line is its own connection
    expect(card.querySelector(".ds-sb-zone-pipe")!.textContent).toBe(`${row.conn_liquid_mm} / ${row.conn_gas_mm}`);
    // the word and the pipe share the foot of the card
    expect(within(card.querySelector(".ds-sb-zone-line.foot") as HTMLElement).getByText("Covered")).toBeInTheDocument();
    // a zone with nothing in it has neither
    expect(zoneCard("Study").querySelector(".ds-sb-zone-kw")).toBeNull();
    expect(zoneCard("Study").querySelector(".ds-sb-zone-pipe")).toBeNull();
  });

  /* A multi is a star: every head has its own line pair to the outdoor, so a
     zone's line is in the system's colour once a unit of it is on the end,
     and quiet and dashed until then */
  it("draws a line per zone, in the system's colour once the zone has a unit", () => {
    const made = claimed(house(), ["bed1", "study"]);
    const doc = addHead(made.doc, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP25VGD2" });
    render(<SystemBuilder doc={doc} pack={pack} systemId={made.systemId} onCommit={() => {}} onClose={() => {}} />);
    const elbow = (name: string) => zoneCard(name).parentElement!.querySelector(".ds-sb-pipe.h")!;
    expect(elbow("Bed 1")).toHaveClass("on");
    expect(elbow("Study")).not.toHaveClass("on");
  });

  /* Add zone is offered only while there is a zone to add (Isaac,
     2026-09-23): one without a system, or one another system has to take. */
  it("offers Add zone only while the plan has a zone this system does not", () => {
    const every = claimed(house(), ["living", "bed1", "bed2", "study"]);
    const first = render(
      <SystemBuilder doc={every.doc} pack={pack} systemId={every.systemId} onCommit={() => {}} onClose={() => {}} />
    );
    expect(screen.queryByRole("button", { name: "Add zone" })).toBeNull();
    expect(schematic().querySelector(".ds-sb-add")).toBeNull();
    // every zone card is still wired: one line turns into each
    const rows = [...schematic().querySelectorAll(".ds-sb-row")].filter((r) => r.querySelector(".ds-sb-zone"));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.querySelectorAll(".ds-sb-pipe.h")).toHaveLength(1);
    first.unmount();

    // a zone on another system is one to take
    const mine = claimed(house(), ["living", "bed1", "bed2"]);
    const theirs = claimed(mine.doc, ["study"]);
    render(<SystemBuilder doc={theirs.doc} pack={pack} systemId={mine.systemId} onCommit={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add zone" }));
    const list = screen.getByRole("dialog", { name: "Add zone" });
    expect(within(list).queryByText("Without a system")).toBeNull();
    expect(within(list).getByText("On another system")).toBeInTheDocument();
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual([expect.stringContaining("Study")]);
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