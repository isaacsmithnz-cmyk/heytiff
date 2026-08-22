/* Cockpit segmented switch — Rooms/Components counts, and the slide: clicking a
   segment flips aria-selected, translates the track, and inerts the off pane. */

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

const room: DesignObject = {
  id: "room1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] },
  plane: "room",
  props: { name: "Bedroom" },
};

function mkDoc(): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" } },
  ];
  d.objects = [room];
  return d;
}

function renderCockpit() {
  return render(
    <SystemCockpit
      doc={mkDoc()}
      pack={pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={() => {}}
      selectedId={null}
      onSelect={() => {}}
      onEditRoom={() => {}}
      onArmPlace={() => {}}
      onBrowseUnits={() => {}}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}

describe("Cockpit seg-switch", () => {
  it("shows the room + component counts", () => {
    const { container } = renderCockpit();
    const roomsTab = screen.getByRole("tab", { name: /Rooms/ });
    const compTab = screen.getByRole("tab", { name: /Components/ });
    expect(roomsTab).toHaveTextContent("1"); // one served room
    expect(compTab).toHaveTextContent("4"); // odu + charge + electrical + mounting
    // rooms is the default view
    expect(roomsTab).toHaveAttribute("aria-selected", "true");
    const track = container.querySelector(".ds-ck-segtrack") as HTMLElement;
    expect(track.style.transform).toBe("translateX(0%)");
  });

  it("switching to Components slides the track and inerts the rooms pane", () => {
    const { container } = renderCockpit();
    fireEvent.click(screen.getByRole("tab", { name: /Components/ }));

    expect(screen.getByRole("tab", { name: /Components/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Rooms/ })).toHaveAttribute("aria-selected", "false");

    const track = container.querySelector(".ds-ck-segtrack") as HTMLElement;
    expect(track.style.transform).toBe("translateX(-100%)");

    const roomsPane = container.querySelector('[data-view="rooms"]')!;
    const compsPane = container.querySelector('[data-view="components"]')!;
    expect(roomsPane).toHaveAttribute("aria-hidden", "true");
    expect(roomsPane).toHaveAttribute("inert");
    expect(compsPane).toHaveAttribute("aria-hidden", "false");
    expect(compsPane).not.toHaveAttribute("inert");
  });
});
