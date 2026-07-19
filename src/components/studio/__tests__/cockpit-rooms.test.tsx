/* Cockpit Rooms view — numbered status pills (done/pending), pill selection,
   auto-inspect of the first room, the shared-room release chip, the "+ Serve"
   adopt flow, and the empty-state "Draw a room" route. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent } from "@testing-library/react";
import { SystemCockpit } from "../cockpit-panel";
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
    onDrawRoom?: () => void;
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
      onDrawRoom={handlers.onDrawRoom ?? (() => {})}
      floor={floor}
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

  it("the empty state routes Draw a room to onDrawRoom", () => {
    const drew: number[] = [];
    const doc = baseDoc([], {}); // no rooms
    renderCockpit(doc, { onDrawRoom: () => drew.push(1) });
    fireEvent.click(screen.getByRole("button", { name: /Draw a room/ }));
    expect(drew).toEqual([1]);
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
