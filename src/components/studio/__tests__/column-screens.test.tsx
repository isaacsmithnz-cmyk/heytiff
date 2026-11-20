/* THE COLUMN AS A PHONE'S SCREENS (the bar and panel mock, Isaac, "Yes,
   build it", 21 November 2026): Systems, a system with a row a zone and what
   it's missing, its zones with a switch each, and the Zones screen's
   Combine. Over the real Mitsubishi pack. Every write goes out through a
   callback, a jest.fn here. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { SystemScreen, SystemsList } from "../systems-stack";
import { RoomsPanel } from "../rooms-panel";
import { createDesign, type DesignDocument, type DesignObject } from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";
import { addHead } from "@/lib/studio/builder";
import { claimZone, newSystem } from "@/lib/studio/zones";
import { answerFromQuote } from "@/lib/studio/install-from-quote";
import type { RoomObj } from "@/lib/studio/loads-room";

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

const ZONES = [
  { id: "living", name: "Living", x: 0, y: 0, w: 400, h: 350 },
  { id: "bed1", name: "Bed 1", x: 400, y: 0, w: 400, h: 300 },
  { id: "robe", name: "Robe", x: 800, y: 0, w: 100, h: 100 },
];
function house(): DesignDocument {
  const doc = createDesign({ name: "house", mode: "blank" });
  const floorId = doc.floors[0].id;
  for (const z of ZONES) {
    doc.objects.push({
      id: z.id,
      type: "room",
      systemId: null,
      floorId,
      plane: "room",
      geometry: {
        kind: "polygon",
        points: [
          { x: z.x, y: z.y },
          { x: z.x + z.w, y: z.y },
          { x: z.x + z.w, y: z.y + z.h },
          { x: z.x, y: z.y + z.h },
        ],
      },
      props: { name: z.name },
    } as RoomObj as DesignObject);
  }
  return doc;
}
function multi(): { doc: DesignDocument; id: string } {
  const made = newSystem(house(), pack.meta.version);
  let d = made.doc;
  for (const z of ["living", "bed1"]) d = claimZone(d, made.systemId, z);
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "living", iduModel: "MSZ-AP25VGD2" });
  d = addHead(d, pack, { systemId: made.systemId, zoneId: "bed1", iduModel: "MSZ-AP20VGD" });
  return { doc: d, id: made.systemId };
}

const systemProps = (doc: DesignDocument, id: string) => ({
  doc,
  pack,
  basis,
  systemId: id,
  claiming: false,
  onBack: jest.fn(),
  onOpenRoom: jest.fn(),
  onAddZones: jest.fn(),
  onClaimDone: jest.fn(),
  onBuild: jest.fn(),
  onInstall: jest.fn(),
  onAir: jest.fn(),
  onArmPlace: jest.fn(),
  onToggleZone: jest.fn(),
});

describe("a system's screen", () => {
  it("says what it is, its heat load, and a row a zone with what it's missing", () => {
    const { doc, id } = multi();
    render(<SystemScreen {...systemProps(doc, id)} />);
    expect(screen.getByText("Multi")).toBeInTheDocument();
    expect(screen.getByText("Heat load")).toBeInTheDocument();
    expect(screen.getByText("2 zones")).toBeInTheDocument();
    // nothing on the plan yet: every unit is to place
    expect(screen.getAllByText("To place").length).toBe(3);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Install details/ })).toBeInTheDocument();
    // no "Next:", no Draw in the column
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Draw/ })).toBeNull();
  });

  it("picks a unit up from its row, to drop on the plan", () => {
    const { doc, id } = multi();
    const p = systemProps(doc, id);
    render(<SystemScreen {...p} />);
    const living = screen.getByText("Living").closest(".ds-stack-row") as HTMLElement;
    expect(living).toHaveAttribute("draggable", "true");
    expect(living.querySelector(".ds-stack-grip")).not.toBeNull();
    fireEvent.click(living);
    expect(p.onArmPlace).toHaveBeenCalledWith(expect.objectContaining({ model: "MSZ-AP25VGD2", roomId: "living", widthMm: 798 }));
  });

  it("is its zones with a switch each until it's built", () => {
    const made = newSystem(house(), pack.meta.version);
    const d = claimZone(made.doc, made.systemId, "living");
    const p = systemProps(d, made.systemId);
    render(<SystemScreen {...p} />);
    const living = screen.getByRole("switch", { name: "Living" });
    expect(living).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch", { name: "Bed 1" }));
    expect(p.onToggleZone).toHaveBeenCalledWith("bed1", true);
    fireEvent.click(living);
    expect(p.onToggleZone).toHaveBeenCalledWith("living", false);
    // the small zone is one row until it's opened
    expect(screen.queryByRole("switch", { name: "Robe" })).toBeNull();
    fireEvent.click(screen.getByText(/1 more/));
    expect(screen.getByRole("switch", { name: "Robe" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Build system" }));
    expect(p.onBuild).toHaveBeenCalled();
  });
});

describe("Install details", () => {
  it("lists the questions by short name, Quoted where the quote answered, To answer where not", () => {
    const { doc, id } = multi();
    const d = answerFromQuote(doc, id, [
      { name: "CON WALL BRACKET 250KG", qty: 1 },
      { name: "ISOLATOR SMALL 2 POLE 20A", qty: 1 },
      { name: "DURA FLEX COND DRAIN HOSE (MTR)", qty: 6 },
      { name: "MINI AQUA CONDENSATE PUMP 14L/HR (EA)", qty: 1 },
    ]);
    const p = systemProps(d, id);
    render(<SystemScreen {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Install details/ }));
    const outdoor = screen.getByText("Outdoor").closest(".ds-stack-row") as HTMLElement;
    expect(within(outdoor).getByText("On a wall, heavy-duty bracket")).toBeInTheDocument();
    expect(within(outdoor).getByText("Quoted")).toBeInTheDocument();
    const fixings = screen.getByText("Heads fix to").closest(".ds-stack-row") as HTMLElement;
    expect(within(fixings).getByText("To answer")).toBeInTheDocument();
    // a second answer reads on in lower case
    const water = screen.getByText("Condensate").closest(".ds-stack-row") as HTMLElement;
    expect(within(water).getByText("Gravity, outside and pump")).toBeInTheDocument();
    fireEvent.click(outdoor);
    expect(p.onInstall).toHaveBeenCalled();
  });
});

describe("Systems", () => {
  it("lists the systems with Add system top right, and the zones on no system as one row", () => {
    const { doc } = multi();
    const onAddSystem = jest.fn();
    const onLeaveOut = jest.fn();
    render(
      <SystemsList
        doc={doc}
        pack={pack}
        basis={basis}
        onOpen={jest.fn()}
        onAddSystem={onAddSystem}
        onOpenRooms={jest.fn()}
        onAddVariant={jest.fn()}
        onSwitchVariant={jest.fn()}
        onRenameVariant={jest.fn()}
        onLeaveOut={onLeaveOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add system" }));
    expect(onAddSystem).toHaveBeenCalled();
    const free = screen.getByText("1 zone on no system").closest(".ds-stack-row") as HTMLElement;
    fireEvent.click(within(free).getByRole("button", { name: "Leave out" }));
    expect(onLeaveOut).toHaveBeenCalledWith(["robe"]);
  });
});

describe("Zones", () => {
  it("combines zones ticked in the list", () => {
    const doc = house();
    const onPick = jest.fn();
    const onJoin = jest.fn();
    const base = {
      doc,
      floorId: doc.floors[0].id,
      found: [],
      showAll: false,
      onShowAll: jest.fn(),
      onKeep: jest.fn(),
      onOpen: jest.fn(),
      onJoin,
      onApart: jest.fn(),
      onPutBack: jest.fn(),
      onCombining: jest.fn(),
      onDone: jest.fn(),
      onPick,
    };
    const { rerender } = render(<RoomsPanel {...base} picked={[]} combining={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Combine" }));
    expect(base.onCombining).toHaveBeenCalledWith(true);

    rerender(<RoomsPanel {...base} picked={["living"]} combining />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Bed 1" }));
    expect(onPick).toHaveBeenCalledWith(["living", "bed1"]);

    rerender(<RoomsPanel {...base} picked={["living", "bed1"]} combining />);
    fireEvent.click(screen.getByRole("button", { name: "Combine 2 zones" }));
    expect(onJoin).toHaveBeenCalled();
  });
});
