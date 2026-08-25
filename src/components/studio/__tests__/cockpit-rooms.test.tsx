/* Cockpit Rooms view — numbered status pills (done/pending), pill selection,
   auto-inspect of the first room, the shared-room release chip, and the
   "+ Serve" adopt flow. Drawing rooms arms from the canvas toolbar now, so
   the roster carries no draw control of its own. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { RoomInspectCard, SystemCockpit } from "../cockpit-panel";
import { releaseRoomFromSystem } from "@/lib/studio/attach";
import type { RoomObj } from "@/lib/studio/loads-room";
import { createDesign, type DesignDocument, type DesignObject, type Floor } from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";

const SEED = join(__dirname, "../../../../data/packs/mitsubishi-electric@2026.1");
function loadPack(): DataPack {
  const meta = JSON.parse(readFileSync(join(SEED, "meta.json"), "utf8")) as PackMeta;
  const sections: PackSource["sections"] = {};
  for (const s of PACK_SECTIONS) {
    const f = join(SEED, `${s}.json`);
    if (existsSync(f)) sections[s] = JSON.parse(readFileSync(f, "utf8"));
  }
  return assemblePack({ meta, sections });
}
const pack = loadPack();
const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

const room = (id: string, name: string, systemId: string | null): DesignObject => ({
  id,
  type: "room",
  systemId,
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room",
  props: { name },
});

const idu = (id: string, roomId: string): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 50, y: 50 } },
  plane: "room",
  props: { role: "idu", model: "SLZ-M25FA-A", roomId },
});

function baseDoc(objects: DesignObject[], settings: Record<string, unknown> = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A", ...settings } },
  ];
  d.objects = objects;
  return d;
}

function renderCockpit(
  doc: DesignDocument,
  handlers: {
    selectedId?: string | null;
    onSelect?: (id: string | null) => void;
    onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
    onEditRoom?: (id: string) => void;
    floor?: Floor;
    onFloor?: (id: string) => void;
  } = {}
) {
  return render(
    <SystemCockpit
      doc={doc}
      pack={pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={handlers.onMutate ?? (() => {})}
      selectedId={handlers.selectedId ?? null}
      onSelect={handlers.onSelect ?? (() => {})}
      onEditRoom={handlers.onEditRoom ?? (() => {})}
      rest={{ rested: false, wouldRest: false, onExpand: () => {}, onRest: () => {} }}
      floor={handlers.floor ?? doc.floors[0]}
      onFloor={handlers.onFloor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}

/* The Inspect card left the panel on 2026-08-25: a room click opens the room
   modal, which hosts this same card. The card's own behaviour did not change,
   so its tests render it directly rather than hunting for it under the
   roster. */
function renderInspect(
  doc: DesignDocument,
  roomId: string,
  handlers: { onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void } = {}
) {
  const system = doc.systems[0];
  const room = doc.objects.find((o) => o.id === roomId) as RoomObj;
  return render(
    <RoomInspectCard
      doc={doc}
      pack={pack}
      system={system}
      room={room}
      basis={doc.settings.sizingBasis}
      onMutate={handlers.onMutate ?? (() => {})}
      onBrowseUnits={() => {}}
      onRelease={(id) =>
        (handlers.onMutate ?? (() => {}))((d) => ({
          ...d,
          systems: releaseRoomFromSystem(d.systems, system.id, id),
        }))
      }
    />
  );
}

describe("Cockpit Rooms view", () => {
  it("numbers the roster rows and dots them covered=done / no-units=none", () => {
    const doc = baseDoc([room("room1", "Living", "sys1"), room("room2", "Study", "sys1"), idu("u1", "room1")]);
    renderCockpit(doc);
    const living = screen.getByRole("button", { name: /Living/ });
    const study = screen.getByRole("button", { name: /Study/ });
    expect(living.querySelector(".ds-ck-rnum")).toHaveTextContent("1");
    expect(study.querySelector(".ds-ck-rnum")).toHaveTextContent("2");
    expect(living.querySelector(".ds-ck-rdot")!.className).toMatch(/done/); // covered by the placed IDU
    expect(study.querySelector(".ds-ck-rdot")!.className).toMatch(/none/); // nothing placed
  });

  it("clicking a pill selects that room", () => {
    const picked: (string | null)[] = [];
    const doc = baseDoc([room("room1", "Living", "sys1"), room("room2", "Study", "sys1")]);
    renderCockpit(doc, { onSelect: (id) => picked.push(id) });
    fireEvent.click(screen.getByRole("button", { name: /Study/ }));
    expect(picked).toContain("room2");
  });

  it("opens the room rather than unfolding an Inspect card under the list", () => {
    /* Isaac, 2026-08-25. The panel used to answer a click — and an empty
       selection — by inspecting a room inline. It is the rooms list now, and
       the click opens the modal that carries everything for that room. */
    const doc = baseDoc([room("room1", "Living", "sys1"), room("room2", "Study", "sys1")]);
    const edited: string[] = [];
    const { container } = renderCockpit(doc, { onEditRoom: (id) => edited.push(id) });
    expect(container.querySelector(".ds-ck-iname")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Study/ }));
    expect(edited).toEqual(["room2"]);
  });

  it("a shared room shows a release control that stops serving it", () => {
    // room owned by sys2 but adopted into sys1 → shared, auto-inspected
    const doc = baseDoc([room("roomX", "Hall", "sys2")], { roomIds: ["roomX"] });
    let next: DesignDocument | undefined;
    renderInspect(doc, "roomX", { onMutate: (fn) => (next = fn(doc)) });
    fireEvent.click(screen.getByRole("button", { name: "Stop serving this room" }));
    expect((next!.systems[0].settings.roomIds as string[]) ?? []).not.toContain("roomX");
  });

  it("+ Serve adopts an existing unserved room", () => {
    const doc = baseDoc([room("room1", "Living", "sys1"), room("room2", "Garage", "sys2")]);
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });
    fireEvent.click(screen.getByRole("button", { name: /Serve/ }));
    fireEvent.click(screen.getByRole("button", { name: /Garage/ }));
    expect(next!.systems[0].settings.roomIds as string[]).toContain("room2");
  });

  /* Both figures used to be reachable only by hovering for a tooltip. The
     list is for scanning (load only, it's what you compare rooms by); the
     card is for reading (how big, and what it needs). */
  describe("the numbers are on the screen, not in a tooltip", () => {
    it("puts the heat load on each roster row", () => {
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      const { container } = renderCockpit(doc);
      const load = container.querySelector(".ds-ck-rload")!;
      expect(load.textContent).toMatch(/^\d+\.\d kW$/);
    });

    it("puts area and required load under the room name on the card", () => {
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      const { container } = renderInspect(doc, "room1");
      const facts = container.querySelector(".ds-ck-ifacts")!;
      expect(facts.textContent).toMatch(/^\d+\.\d m² · \d+\.\d kW required$/);
    });

    /* no scale, no numbers — the row stays quiet (the grey dot already says
       "nothing known"), and the card names the fix instead of showing dashes */
    it("says nothing on the row and names the fix on the card when uncalibrated", () => {
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      doc.floors = [{ ...floor, scaleMmPerUnit: null }];
      const { container } = renderCockpit(doc);
      expect(container.querySelector(".ds-ck-rload")).toBeNull();
      const card = renderInspect(doc, "room1");
      expect(card.container.querySelector(".ds-ck-ifacts")!.textContent).toBe(
        "Calibrate the floor to size this room"
      );
    });
  });

  /* A flat roster interleaves the storeys with nothing to tell them apart.
     Rooms group under their floor, stacked the way the building is (top
     first), each group folding away but keeping its count. */
  describe("grouped by storey", () => {
    const first: Floor = { ...floor, id: "flr2", name: "First floor", level: 1 };
    const upstairs = (id: string, name: string): DesignObject => ({
      ...room(id, name, "sys1"),
      floorId: "flr2",
    });
    const twoFloorDoc = (objects: DesignObject[]) => {
      const d = baseDoc(objects);
      d.floors = [floor, first];
      return d;
    };

    it("heads each floor with its name and room count, top storey first", () => {
      const doc = twoFloorDoc([
        room("room1", "Living", "sys1"),
        room("room2", "Kitchen", "sys1"),
        upstairs("room3", "Bed 1"),
      ]);
      const { container } = renderCockpit(doc);
      const heads = [...container.querySelectorAll(".ds-ck-fhead")];
      expect(heads.map((h) => h.querySelector(".fn")!.textContent)).toEqual([
        "First floor",
        "Ground",
      ]);
      expect(heads.map((h) => h.querySelector(".fc")!.textContent)).toEqual([
        "1 room",
        "2 rooms",
      ]);
    });

    it("folds a floor away but keeps its count", () => {
      const doc = twoFloorDoc([room("room1", "Living", "sys1"), upstairs("room3", "Bed 1")]);
      const { container } = renderCockpit(doc);
      expect(screen.getByRole("button", { name: /Bed 1/ })).toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Hide First floor"));
      expect(screen.queryByRole("button", { name: /Bed 1/ })).not.toBeInTheDocument();
      expect(
        [...container.querySelectorAll(".ds-ck-fhead .fc")].map((e) => e.textContent)
      ).toContain("1 room");
    });

    /* numbering identifies the room in the SYSTEM — restarting it per floor
       would renumber a room because another storey gained one */
    it("numbers continuously across the storeys", () => {
      const doc = twoFloorDoc([
        room("room1", "Living", "sys1"),
        room("room2", "Kitchen", "sys1"),
        upstairs("room3", "Bed 1"),
      ]);
      const { container } = renderCockpit(doc);
      expect(
        [...container.querySelectorAll(".ds-ck-rnum")].map((e) => e.textContent)
      ).toEqual(["3", "1", "2"]); // First floor's room 3 renders above Ground's 1-2
    });

    it("takes the canvas to the storey a room is on when you pick it", () => {
      const doc = twoFloorDoc([room("room1", "Living", "sys1"), upstairs("room3", "Bed 1")]);
      const went: string[] = [];
      renderCockpit(doc, { onFloor: (id) => went.push(id) });
      fireEvent.click(screen.getByRole("button", { name: /Bed 1/ }));
      expect(went).toEqual(["flr2"]);
    });

    /* one storey is not a stack — a lone header wraps everything and says
       nothing */
    it("shows no header at all on a single-floor design", () => {
      const { container } = renderCockpit(baseDoc([room("room1", "Living", "sys1")]));
      expect(container.querySelector(".ds-ck-fhead")).toBeNull();
    });
  });

  it("the inspect card shows units only — flat, no sub-tabs", () => {
    const doc = baseDoc([room("room1", "Living", "sys1")]);
    renderInspect(doc, "room1");
    expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Configure" })).toBeNull();
    expect(screen.queryByText("Area")).not.toBeInTheDocument();
  });

  it("the panel keeps no Configure pill — the row itself opens the room", () => {
    /* the pill and the row did the same thing once the row opened the modal */
    const doc = baseDoc([room("room1", "Living", "sys1")]);
    renderCockpit(doc);
    expect(screen.queryByRole("button", { name: "Configure room" })).toBeNull();
  });

  it("drops the Inspect heading when there is nothing under it", () => {
    /* seen on Isaac's screen: the heading was unconditional because a room was
       always being inspected, so with rooms in their modal it sat labelling an
       empty rail. It belongs to the OBJECT cards, which only a canvas
       selection raises. */
    const doc = baseDoc([room("room1", "Living", "sys1")]);
    renderCockpit(doc);
    expect(screen.queryByText("Inspect")).not.toBeInTheDocument();
  });
});
