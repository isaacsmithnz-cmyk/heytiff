/* Cockpit hero — the capacity-donut card. State comes from coverage =
   selected ÷ required: ≥100% ok · 90–99% warn · <90% bad, and "empty" before a
   room+pair resolves. Runs against the real ME pack for genuine capacities. */

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
// SLZ-M25FA-A + SUZ-M25VAD-A rate at 2.5 kW cooling
const PAIR = { pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" };

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
  return render(
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
      onBrowseUnits={() => {}}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}
const heroState = (c: HTMLElement) => c.querySelector(".ds-ck-caphero")!.getAttribute("data-state");

describe("Cockpit hero (capacity donut)", () => {
  it("no rooms → empty state, Not sized", () => {
    const { container } = renderHero(mk());
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Not sized")).toBeInTheDocument();
  });

  it("a room but no units → empty state, Select units", () => {
    const { container } = renderHero(mk({ objects: [rect(200, 200)] }));
    expect(heroState(container)).toBe("empty");
    // the ledger sum label (the Units sub also has a "Select units" button)
    expect(screen.getByText("Select units", { selector: ".ds-ck-ledger-row .k" })).toBeInTheDocument();
  });

  it("selected covers required → ok state, Spare", () => {
    // a small room (~4 m²) with a 2.5 kW pair → well over 100%
    const { container } = renderHero(mk({ settings: PAIR, objects: [rect(200, 200)] }));
    expect(heroState(container)).toBe("ok");
    expect(screen.getByText("Spare")).toBeInTheDocument();
    // Selected ledger value (also shown on the Units card, so scope to the ledger)
    expect(screen.getByText("2.5 kW", { selector: ".ds-ck-ledger-row.sel .v" })).toBeInTheDocument();
  });

  it("selected well under required → bad state, Short", () => {
    // a 20 m² room (~2.9 kW load) with the 2.5 kW pair → ~86% (<90%)
    const { container } = renderHero(mk({ settings: PAIR, objects: [rect(500, 400)] }));
    expect(heroState(container)).toBe("bad");
    expect(screen.getByText("Short")).toBeInTheDocument();
  });

  it("an uncalibrated floor → empty state, Calibrate", () => {
    const { container } = renderHero(mk({ settings: PAIR, objects: [rect(200, 200)], scale: null }));
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Calibrate")).toBeInTheDocument();
  });
});
