/* Cockpit ducted body (Stage 7, Step 1) — the required-capacity hero + CTA,
   the choose flow writing the split pairing keys, the post-pair engine
   figures + drag cards, degradations, the extended type-change wipe, and the
   split-hero regression. Runs against the real ME pack so the PEAD gate and
   the Components rows are genuine. */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SystemCockpit } from "../cockpit-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type Floor,
  type SystemType,
} from "@/lib/studio/document";
import { PACK_SECTIONS, type DataPack, type PackMeta } from "@/lib/studio/packs/schema";
import { assemblePack, type PackSource } from "@/lib/studio/packs/loader";

/* ducted is dev-flagged and NEXT_PUBLIC_ vars bake at import time, so the flag
   can't flip per-test — mock the registry entry instead. moduleFor closes over
   the real record, so it must be re-pointed at the mocked one too. */
jest.mock("@/lib/studio/modules", () => {
  const actual = jest.requireActual<typeof import("@/lib/studio/modules")>(
    "@/lib/studio/modules"
  );
  const SYSTEM_MODULES = {
    ...actual.SYSTEM_MODULES,
    ducted: { ...actual.SYSTEM_MODULES.ducted, available: true },
  };
  return {
    ...actual,
    SYSTEM_MODULES,
    moduleFor: (t: SystemType) => SYSTEM_MODULES[t],
  };
});

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
const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, simplePlan: null, plans: [] };

/* rooms sized so the requirement lands on a real PEAD: 40 m² (5.8 kW) +
   12 m² (1.74 kW) at zone 5 → required ~7.5 kW, gate ≤ 11.3 → the M100s */
const room = (id: string, name: string, w: number, h: number): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
  plane: "room",
  props: { name },
});
const twoRooms = () => [room("room1", "Living", 800, 500), room("room2", "Study", 400, 300)];

const obj = (id: string, type: string): DesignObject => ({
  id,
  type,
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 10, y: 10 } },
  plane: "room",
  props: {},
});

function mkDoc(opts: {
  type?: SystemType;
  settings?: Record<string, unknown>;
  objects?: DesignObject[];
  scale?: number | null;
} = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-13T00:00:00.000Z" });
  d.floors = [{ ...floor, scaleMmPerUnit: opts.scale === undefined ? 10 : opts.scale }];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: opts.type ?? "ducted", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: opts.settings ?? {} },
  ];
  d.objects = opts.objects ?? [];
  return d;
}

function renderCockpit(
  doc: DesignDocument,
  handlers: { onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void } = {}
) {
  return render(
    <SystemCockpit
      doc={doc}
      pack={pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={handlers.onMutate ?? (() => {})}
      selectedId={null}
      onSelect={() => {}}
      onEditRoom={() => {}}
      onArmPlace={() => {}}
      onDrawRoom={() => {}}
      floor={floor}
    />
  );
}

const heroState = (c: HTMLElement) => c.querySelector(".ds-ck-caphero")!.getAttribute("data-state");

describe("Cockpit ducted body", () => {
  it("pre-pair: donut hero reads the requirement; Select air handler CTA in the section", () => {
    const { container } = renderCockpit(mkDoc({ objects: twoRooms() }));
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("7.5 kW", { selector: ".ds-ck-ledger-row.req .v" })).toBeInTheDocument();
    expect(screen.getByText("Select units", { selector: ".ds-ck-ledger-row .k" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Select air handler/ })).toBeInTheDocument();
  });

  it("choosing a pair in the browser writes settings.pairIdu/pairOdu", () => {
    const doc = mkDoc({ objects: twoRooms() });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    fireEvent.click(screen.getByRole("button", { name: /Select air handler/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose a unit" });
    // opens on the ducted form-factor tab, gated to the required band's units
    expect(within(dialog).getByRole("button", { name: /Ducted/ }).className).toContain("on");
    const tbl = dialog.querySelector(".ds-ub-table tbody") as HTMLElement;
    fireEvent.click(within(tbl).getByText("PEAD-M100JAA(D)"));
    fireEvent.click(screen.getByRole("button", { name: /Add to plan/ }));

    expect(next!.systems[0].settings.pairIdu).toBe("PEAD-M100JAA(D)");
    expect(next!.systems[0].settings.pairOdu).toBe("PUZ-M100VKA-A");
  });

  it("post-pair: engine figures as plain lines, Change affordance, both drag cards", () => {
    const { container } = renderCockpit(
      mkDoc({
        objects: twoRooms(),
        settings: { pairIdu: "PEAD-M100JAA(D)", pairOdu: "PUZ-M100VKA-A" },
      })
    );
    // systemPairKw (worst-of-both min(10.0, 12.5)) · airflow_ls · requirement
    const ahu = screen.getByTestId("ahu-section");
    // the pair kW also captions both drag cards — scope to the fact row
    expect(within(ahu).getByText("10.0 kW", { selector: ".ds-ck-objrow b" })).toBeInTheDocument();
    expect(within(ahu).getByText("567 L/s")).toBeInTheDocument();
    expect(within(ahu).getByText("~7.5 kW")).toBeInTheDocument();
    expect(within(ahu).getByRole("button", { name: /Change/ })).toBeInTheDocument();
    // the two drag-to-plan cards, unplaced → armed via the UnitRow mechanics
    expect(within(ahu).getByTestId("unit-card-idu")).toBeInTheDocument();
    expect(within(ahu).getByTestId("unit-card-odu")).toBeInTheDocument();
    expect(within(ahu).getAllByText("To place")).toHaveLength(2);
    // hero follows the pair: 10.0 kW selected over ~7.5 required → ok, Spare
    expect(heroState(container)).toBe("ok");
    expect(screen.getByText("10.0 kW", { selector: ".ds-ck-ledger-row.sel .v" })).toBeInTheDocument();
    expect(screen.getByText("Spare")).toBeInTheDocument();
  });

  it("Components view resolves ODU + charge rows once the pair resolves", () => {
    renderCockpit(
      mkDoc({
        objects: twoRooms(),
        settings: { pairIdu: "PEAD-M100JAA(D)", pairOdu: "PUZ-M100VKA-A" },
      })
    );
    fireEvent.click(screen.getByRole("tab", { name: /Components/ }));
    expect(screen.getByText("Outdoor unit")).toBeInTheDocument();
    expect(screen.getByText("PUZ-M100VKA-A", { selector: ".ds-ck-compname" })).toBeInTheDocument();
    expect(screen.getByText("Refrigerant charge")).toBeInTheDocument();
  });

  it("degrades to — with the precondition label when the requirement can't derive", () => {
    // uncalibrated floor → loads unavailable → Calibrate
    const first = renderCockpit(mkDoc({ objects: twoRooms(), scale: null }));
    expect(heroState(first.container)).toBe("empty");
    expect(screen.getByText("— kW", { selector: ".ds-ck-ledger-row.req .v" })).toBeInTheDocument();
    expect(screen.getByText("Calibrate")).toBeInTheDocument();
    first.unmount();
    // no rooms served at all → Not sized
    const second = renderCockpit(mkDoc());
    expect(heroState(second.container)).toBe("empty");
    expect(screen.getByText("Not sized")).toBeInTheDocument();
  });

  it("a missing pack row degrades the airflow line, never invents", () => {
    renderCockpit(
      mkDoc({ objects: twoRooms(), settings: { pairIdu: "NOT-IN-PACK", pairOdu: "ALSO-NOT" } })
    );
    const ahu = screen.getByTestId("ahu-section");
    expect(within(ahu).getByText("airflow missing from pack")).toBeInTheDocument();
    const airflowRow = within(ahu).getByText("Rated airflow").closest(".ds-ck-objrow")!;
    expect(airflowRow).toHaveTextContent("—");
  });

  it("ducted room inspect shows Configure only, with the outlets placeholder", () => {
    renderCockpit(mkDoc({ objects: twoRooms() }));
    // Configure is the sole sub-tab and its facts are live
    expect(screen.getByRole("tab", { name: "Configure" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Units" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Pipework" })).toBeNull();
    expect(screen.getByText("Area")).toBeInTheDocument();
    expect(screen.getByText("Outlets arrive with ductwork — Step 3")).toBeInTheDocument();
  });

  it("changing type away from ducted drops the five air-side types but keeps rooms", () => {
    const doc = mkDoc({
      objects: [
        ...twoRooms(),
        obj("u1", "unit"),
        obj("p1", "pipe-run"),
        obj("g1", "grille"),
        obj("d1", "duct-run"),
        obj("f1", "duct-fitting"),
        obj("pl1", "plenum"),
        obj("c1", "controller"),
      ],
      settings: { pairIdu: "PEAD-M100JAA(D)", pairOdu: "PUZ-M100VKA-A" },
    });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    // the hero's Change (the AHU card carries its own post-pair Change button)
    fireEvent.click(screen.getByTitle(/Change system type/));
    fireEvent.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));

    expect(next!.systems[0].type).toBe("split");
    expect(next!.systems[0].settings.pairIdu).toBeUndefined();
    expect(next!.systems[0].settings.pairOdu).toBeUndefined();
    const types = next!.objects.map((o) => o.type);
    expect(types.filter((t) => t === "room")).toHaveLength(2);
    for (const t of ["unit", "pipe-run", "grille", "duct-run", "duct-fitting", "plenum", "controller"]) {
      expect(types).not.toContain(t);
    }
  });

  it("split systems still render the split body, no AHU section (regression)", () => {
    const { container } = renderCockpit(
      mkDoc({
        type: "split",
        objects: [room("room1", "Bedroom", 200, 200)],
      })
    );
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Select units", { selector: ".ds-ck-ledger-row .k" })).toBeInTheDocument();
    expect(screen.queryByTestId("ahu-section")).toBeNull();
    expect(screen.queryByRole("button", { name: /Select air handler/ })).toBeNull();
  });
});
