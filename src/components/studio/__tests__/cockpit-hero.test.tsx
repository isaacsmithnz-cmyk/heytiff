/* Cockpit hero — the dark ink card's load-coverage summary across the split
   states: no rooms · room-no-units · units-chosen-unplaced · placed-covered ·
   uncalibrated. Runs against the real ME pack so the covered case is genuine. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen } from "@testing-library/react";
import { SystemCockpit } from "../cockpit-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
} from "@/lib/studio/document";
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

const rect = (w: number, h: number): DesignObject => ({
  id: "room1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
  plane: "room",
  props: { name: "Bedroom" },
});

function mk(opts: { settings?: Record<string, unknown>; objects?: DesignObject[]; scale?: number | null } = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-11T00:00:00.000Z" });
  d.floors = [{ ...floor, scaleMmPerUnit: opts.scale === undefined ? 10 : opts.scale }];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: "split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: opts.settings ?? {} },
  ];
  d.objects = opts.objects ?? [];
  return d;
}

function renderHero(doc: DesignDocument) {
  render(
    <SystemCockpit
      doc={doc}
      pack={pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={() => {}}
      selectedId={null}
      onSelect={() => {}}
      onEditRoom={() => {}}
      onArmPlace={() => {}}
      onDrawRoom={() => {}}
      floor={floor}
    />
  );
}

describe("Cockpit hero", () => {
  it("no rooms → Not sized · 0 rooms served", () => {
    renderHero(mk());
    expect(screen.getByText("Not sized")).toBeInTheDocument();
    expect(screen.getByText("0 rooms served")).toBeInTheDocument();
  });

  it("a room but no units → Not sized · Select units to size", () => {
    renderHero(mk({ objects: [rect(200, 200)] }));
    expect(screen.getByText("Not sized")).toBeInTheDocument();
    expect(screen.getByText("Select units to size")).toBeInTheDocument();
  });

  it("a pair chosen but unplaced → Awaiting placement · Place on plan to size", () => {
    renderHero(
      mk({ settings: { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }, objects: [rect(200, 200)] })
    );
    expect(screen.getByText("Awaiting placement")).toBeInTheDocument();
    expect(screen.getByText("2 units selected")).toBeInTheDocument();
    expect(screen.getByText("Place on plan to size")).toBeInTheDocument();
  });

  it("a placed IDU that covers the room → Covered + headroom", () => {
    const idu: DesignObject = {
      id: "u_idu",
      type: "unit",
      systemId: "sys1",
      floorId: "flr",
      geometry: { kind: "point", at: { x: 50, y: 50 } },
      plane: "room",
      props: { role: "idu", model: "SLZ-M25FA-A", roomId: "room1" },
    };
    renderHero(
      mk({ settings: { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }, objects: [rect(200, 200), idu] })
    );
    // the hero badge specifically (the inspect card also shows a "Covered" badge)
    expect(screen.getByText("Covered", { selector: ".ds-ck-badge" })).toBeInTheDocument();
    expect(screen.getByText(/headroom/)).toBeInTheDocument();
  });

  it("an uncalibrated floor → Not sized · Calibrate to size", () => {
    renderHero(mk({ objects: [rect(200, 200)], scale: null }));
    expect(screen.getByText("Not sized")).toBeInTheDocument();
    expect(screen.getByText("Calibrate to size")).toBeInTheDocument();
  });
});
