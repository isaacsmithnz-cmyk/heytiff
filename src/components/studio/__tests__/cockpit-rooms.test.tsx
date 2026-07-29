/* Cockpit Rooms view — numbered status pills (done/pending), pill selection,
   auto-inspect of the first room, the shared-room release chip, the "+ Serve"
   adopt flow, and the empty-state "Draw a room" route. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { SystemCockpit, type RoomDraw } from "../cockpit-panel";
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
    roomDraw?: Partial<RoomDraw>;
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
      onArmPlace={() => {}}
      roomDraw={{ open: false, shape: null, start: () => {}, pick: () => {}, ...handlers.roomDraw }}
      floor={handlers.floor ?? doc.floors[0]}
      onFloor={handlers.onFloor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
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

  it("auto-inspects the first served room when nothing is selected", () => {
    const doc = baseDoc([room("room1", "Living", "sys1"), room("room2", "Study", "sys1")]);
    renderCockpit(doc);
    // the Inspect card names the first room
    expect(screen.getByText("Living", { selector: ".ds-ck-iname" })).toBeInTheDocument();
  });

  it("a shared room shows a release control that stops serving it", () => {
    // room owned by sys2 but adopted into sys1 → shared, auto-inspected
    const doc = baseDoc([room("roomX", "Hall", "sys2")], { roomIds: ["roomX"] });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });
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
      const { container } = renderCockpit(doc);
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
      expect(container.querySelector(".ds-ck-ifacts")!.textContent).toBe(
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

    /* the button draws on the ACTIVE storey, so it belongs in that storey's
       group — and moves when you change page */
    it("keeps Add room inside the active floor's group", () => {
      const doc = twoFloorDoc([room("room1", "Living", "sys1"), upstairs("room3", "Bed 1")]);
      const { container, unmount } = renderCockpit(doc); // active = Ground
      const groupOf = (name: string) =>
        [...container.querySelectorAll(".ds-ck-fgrp")].find(
          (g) => g.querySelector(".fn")!.textContent === name
        )!;
      expect(groupOf("Ground").querySelector(".ds-ck-rowadd")).not.toBeNull();
      expect(groupOf("First floor").querySelector(".ds-ck-rowadd")).toBeNull();
      unmount();

      const up = renderCockpit(doc, { floor: first });
      const upGroups = [...up.container.querySelectorAll(".ds-ck-fgrp")];
      const upFirst = upGroups.find((g) => g.querySelector(".fn")!.textContent === "First floor")!;
      expect(upFirst.querySelector(".ds-ck-rowadd")).not.toBeNull();
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
      expect(container.querySelector(".ds-ck-rowadd")).not.toBeNull();
    });
  });

  it("the empty state raises the shape picker from Draw a room", () => {
    const drew: number[] = [];
    const doc = baseDoc([], {}); // no rooms
    renderCockpit(doc, { roomDraw: { start: () => drew.push(1) } });
    fireEvent.click(screen.getByRole("button", { name: /Draw a room/ }));
    expect(drew).toEqual([1]);
  });

  /* The shape choice used to be a pill pinned to the top of the CANVAS, far
     from the cockpit button that raised it — pressing the button looked like
     it did nothing. It now replaces that button in place. */
  describe("the shape picker takes the button's own place", () => {
    it("swaps Add room for the three shape controls", () => {
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      renderCockpit(doc, { roomDraw: { open: true } });
      expect(screen.queryByRole("button", { name: "Add room" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Rectangle room" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Polygon room" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel drawing a room" })).toBeInTheDocument();
    });

    it("arms a shape, and cancel goes back to the button", () => {
      const picks: (string | null)[] = [];
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      renderCockpit(doc, { roomDraw: { open: true, pick: (s) => picks.push(s) } });
      fireEvent.click(screen.getByRole("button", { name: "Rectangle room" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel drawing a room" }));
      expect(picks).toEqual(["rect", null]);
    });

    it("marks the armed shape pressed", () => {
      const doc = baseDoc([room("room1", "Living", "sys1")]);
      renderCockpit(doc, { roomDraw: { open: true, shape: "poly" } });
      expect(screen.getByRole("button", { name: "Polygon room" })).toHaveAttribute(
        "aria-pressed",
        "true"
      );
      expect(screen.getByRole("button", { name: "Rectangle room" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });
  });

  it("the inspect card shows units only; the pill Configure opens the room editor", () => {
    const edited: string[] = [];
    const doc = baseDoc([room("room1", "Living", "sys1")]);
    renderCockpit(doc, { onEditRoom: (id) => edited.push(id) });
    // flat card: unit selection, no Configure/Units/Pipework tablist, no facts
    expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Configure" })).toBeNull();
    expect(screen.queryByText("Area")).not.toBeInTheDocument();
    // Configure moved onto the room pill → opens the room editor
    fireEvent.click(screen.getByRole("button", { name: "Configure room" }));
    expect(edited).toContain("room1");
  });
});
