/* Cockpit multi-split body (Stage 5) — the load-coverage donut hero across
   its states (Required = Σ room loads, Selected = Σ connected indoor kW; the
   ODU-side ports/combination story lives in the outdoor section), the
   shared-outdoor section (choose → settings.pairOdu, swap recalls the placed
   ODU + its runs but keeps every room's indoor), the per-room Unit tab
   (choose → settings.multiIdus, surgical recall), the type-change wipe, and
   the split regression. Runs against the real ME pack so the MXZ proposals
   and combination figures are genuine. */

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

/* multi-split is dev-flagged and NEXT_PUBLIC_ vars bake at import time, so the
   flag can't flip per-test — mock the registry entry instead. moduleFor closes
   over the real record, so it must be re-pointed at the mocked one too. */
jest.mock("@/lib/studio/modules", () => {
  const actual = jest.requireActual<typeof import("@/lib/studio/modules")>(
    "@/lib/studio/modules"
  );
  const SYSTEM_MODULES = {
    ...actual.SYSTEM_MODULES,
    "multi-split": { ...actual.SYSTEM_MODULES["multi-split"], available: true },
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
const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

/* two 12 m² rooms (400×300 @ 10 mm/unit) → 1.74 kW each at zone 5 */
const room = (id: string, name: string): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }] },
  plane: "room",
  props: { name },
});
const twoRooms = () => [room("room1", "Bed 1"), room("room2", "Bed 2")];

const unit = (
  id: string,
  role: "idu" | "odu",
  model: string,
  roomId?: string
): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 10, y: 10 } },
  plane: role === "odu" ? "external-ground" : "room",
  props: { role, model, ...(roomId ? { roomId } : {}) },
});

const run = (id: string, attachToId: string): DesignObject => ({
  id,
  type: "pipe-run",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
  plane: "room",
  props: { endAttach: { kind: "unit", id: attachToId } },
});

function mkDoc(opts: {
  type?: SystemType;
  settings?: Record<string, unknown>;
  objects?: DesignObject[];
  scale?: number | null;
} = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-14T00:00:00.000Z" });
  d.floors = [{ ...floor, scaleMmPerUnit: opts.scale === undefined ? 10 : opts.scale }];
  d.settings.climateZone = "5";
  d.systems = [
    { id: "sys1", type: opts.type ?? "multi-split", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: opts.settings ?? {} },
  ];
  d.objects = opts.objects ?? [];
  return d;
}

const bothChosen = () => ({
  multiIdus: { room1: "MSZ-AP20VGD", room2: "MSZ-AP20VGD" },
});

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
      onBrowseUnits={() => {}}
      rest={{ rested: false, wouldRest: false, onExpand: () => {}, onRest: () => {} }}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}

const heroState = (c: HTMLElement) => c.querySelector(".ds-ck-caphero")!.getAttribute("data-state");

describe("Cockpit multi-split hero", () => {
  it("no rooms → empty donut, Not sized", () => {
    const { container } = renderCockpit(mkDoc());
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Not sized")).toBeInTheDocument();
  });

  it("rooms but no units → Select units, Σ loads as the Required figure", () => {
    const { container } = renderCockpit(mkDoc({ objects: twoRooms() }));
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Select units", { selector: ".ds-ck-ledger-row .k" })).toBeInTheDocument();
    // Σ room loads ≈ 3.5 kW is the Required ledger figure
    expect(screen.getByText("3.5 kW", { selector: ".ds-ck-ledger-row.req .v" })).toBeInTheDocument();
  });

  it("units chosen → the donut reads connected ÷ load, outdoor-agnostic", () => {
    const { container } = renderCockpit(mkDoc({ objects: twoRooms(), settings: bothChosen() }));
    expect(heroState(container)).toBe("ok");
    expect(screen.getByText("4.0 kW", { selector: ".ds-ck-ledger-row.sel .v" })).toBeInTheDocument();
    expect(screen.getByText("Spare")).toBeInTheDocument();
  });

  it("choosing the outdoor leaves the hero on load coverage (ports live below)", () => {
    const { container } = renderCockpit(
      mkDoc({ objects: twoRooms(), settings: { ...bothChosen(), pairOdu: "MXZ-2F52VGD" } })
    );
    expect(heroState(container)).toBe("ok");
    // the ODU-side figures render in the outdoor section, not the hero
    const sec = screen.getByTestId("outdoor-section");
    expect(within(sec).getByText("Combination").closest(".ds-ck-objrow")).toHaveTextContent("77%");
    expect(within(sec).getByText("Ports").closest(".ds-ck-objrow")).toHaveTextContent("2 / 2");
  });

  it("a set-but-unknown outdoor degrades to a grey reason, never a guess", () => {
    renderCockpit(
      mkDoc({ objects: twoRooms(), settings: { ...bothChosen(), pairOdu: "NOT-IN-PACK" } })
    );
    const sec = screen.getByTestId("outdoor-section");
    expect(within(sec).getByText(/NOT-IN-PACK isn't in this pack/)).toBeInTheDocument();
    expect(within(sec).getByText("Rated capacity").closest(".ds-ck-objrow")).toHaveTextContent("—");
  });
});

describe("Shared-outdoor section", () => {
  it("empty state offers Select outdoor unit; the picker proposes the MXZ range", () => {
    renderCockpit(mkDoc({ objects: twoRooms(), settings: bothChosen() }));
    const sec = screen.getByTestId("outdoor-section");
    expect(within(sec).getByText("No outdoor unit yet")).toBeInTheDocument();
    fireEvent.click(within(sec).getByRole("button", { name: /Select outdoor unit/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose the shared outdoor unit" });
    expect(within(dialog).getByText("MXZ-2F52VF")).toBeInTheDocument();
    expect(within(dialog).getByText("suggested")).toBeInTheDocument();
  });

  it("choosing an outdoor writes settings.pairOdu", () => {
    const doc = mkDoc({ objects: twoRooms(), settings: bothChosen() });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });
    fireEvent.click(screen.getByRole("button", { name: /Select outdoor unit/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose the shared outdoor unit" });
    fireEvent.click(within(dialog).getByText("MXZ-2F52VGD"));
    expect(next!.systems[0].settings.pairOdu).toBe("MXZ-2F52VGD");
  });

  it("chosen: engine figures, findings-free, and the drag card", () => {
    renderCockpit(
      mkDoc({ objects: twoRooms(), settings: { ...bothChosen(), pairOdu: "MXZ-2F52VGD" } })
    );
    const sec = screen.getByTestId("outdoor-section");
    const row = (k: string) => within(sec).getByText(k).closest(".ds-ck-objrow")!;
    expect(row("Rated capacity")).toHaveTextContent("5.2 kW");
    expect(row("Connected")).toHaveTextContent("4.0 kW · 2 units");
    expect(row("Ports")).toHaveTextContent("2 / 2");
    expect(row("Combination")).toHaveTextContent("77%");
    expect(within(sec).getByTestId("unit-card-odu")).toBeInTheDocument();
    expect(within(sec).getByText("Drag to place")).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: /Change/ })).toBeInTheDocument();
  });

  it("a rule breach renders red findings in the section", () => {
    const objects = [...twoRooms(), room("room3", "Bed 3")];
    renderCockpit(
      mkDoc({
        objects,
        settings: {
          pairOdu: "MXZ-2F52VGD",
          multiIdus: { room1: "MSZ-AP20VGD", room2: "MSZ-AP20VGD", room3: "MSZ-AP20VGD" },
        },
      })
    );
    const sec = screen.getByTestId("outdoor-section");
    expect(within(sec).getByText(/has 2 ports/)).toBeInTheDocument();
    expect(within(sec).getByText(/accepts up to 2/)).toBeInTheDocument();
  });

  it("swapping the outdoor recalls the placed ODU + its runs, keeps the indoors", () => {
    const doc = mkDoc({
      objects: [
        ...twoRooms(),
        unit("i1", "idu", "MSZ-AP20VGD", "room1"),
        unit("o1", "odu", "MXZ-2F52VGD"),
        run("p1", "o1"), // plumbed to the outdoor → goes with it
        run("p2", "i1"), // the room's own run → stays
      ],
      settings: bothChosen(),
    });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    const sec = screen.getByTestId("outdoor-section");
    fireEvent.click(within(sec).getByRole("button", { name: /Change/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose the shared outdoor unit" });
    fireEvent.click(within(dialog).getByText("MXZ-3F54VGD"));

    expect(next!.systems[0].settings.pairOdu).toBe("MXZ-3F54VGD");
    const ids = next!.objects.map((o) => o.id);
    expect(ids).not.toContain("o1");
    expect(ids).not.toContain("p1");
    expect(ids).toContain("i1");
    expect(ids).toContain("p2");
  });
});

describe("Per-room Unit tab", () => {
  it("the multi room inspect shows per-room unit selection with no sub-tabs", () => {
    renderCockpit(mkDoc({ objects: twoRooms() }));
    // the Configure/Unit/Pipework switcher is gone — the card is unit selection only
    expect(screen.queryByRole("tab", { name: "Configure" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Unit" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Pipework" })).toBeNull();
    expect(screen.getByTestId("multi-unit-sub")).toBeInTheDocument();
    // Configure moved onto the room pills
    expect(screen.getAllByRole("button", { name: "Configure room" }).length).toBeGreaterThan(0);
  });

  it("choosing a unit writes settings.multiIdus for THIS room only", () => {
    const doc = mkDoc({ objects: twoRooms() });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    const sub = screen.getByTestId("multi-unit-sub");
    expect(within(sub).getByText("No unit for this room yet")).toBeInTheDocument();
    fireEvent.click(within(sub).getByRole("button", { name: /Select unit/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose an indoor unit" });
    // the room load RANKS the list; the smallest suitable unit is marked
    expect(within(dialog).getByText(/Room load ≈/)).toHaveTextContent("1.7 kW");
    const rec = within(dialog).getByText("best fit").closest("tr")!;
    expect(rec).toHaveTextContent("MSZ-AP20VGD");
    fireEvent.click(within(dialog).getByText("MSZ-AP20VGD"));

    expect(next!.systems[0].settings.multiIdus).toEqual({ room1: "MSZ-AP20VGD" });
  });

  it("the picker ranks rather than filters — same sections as the split browser", () => {
    renderCockpit(mkDoc({ objects: twoRooms() }));
    fireEvent.click(
      within(screen.getByTestId("multi-unit-sub")).getByRole("button", { name: /Select unit/ })
    );
    const dialog = screen.getByRole("dialog", { name: "Choose an indoor unit" });

    // no toggle — capacity never removes a unit here either
    expect(within(dialog).queryByText(/Include oversized/i)).not.toBeInTheDocument();

    expect(within(dialog).getByText("Recommended")).toBeInTheDocument();
    expect(within(dialog).getByText("Oversized")).toBeInTheDocument();
    expect(within(dialog).getByText("Undersized")).toBeInTheDocument();

    // and the units that used to be filtered out are on screen, flagged
    expect(within(dialog).getAllByText("oversized").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("undersized").length).toBeGreaterThan(0);

    // sections run fits → oversized → undersized
    const rows = within(dialog).getAllByRole("row");
    const at = (t: string) => rows.findIndex((r) => r.textContent?.includes(t));
    expect(at("Recommended")).toBeLessThan(at("Oversized"));
    expect(at("Oversized")).toBeLessThan(at("Undersized"));
  });

  it("a chosen unit renders the drag card with its own capacity", () => {
    renderCockpit(mkDoc({ objects: twoRooms(), settings: bothChosen() }));
    const sub = screen.getByTestId("multi-unit-sub");
    const card = within(sub).getByTestId("unit-card-idu");
    expect(card).toHaveTextContent("MSZ-AP20VGD");
    expect(card).toHaveTextContent("2.0 kW");
    expect(card).toHaveTextContent("Drag to place");
  });

  it("recall takes THIS room's unit + its runs off the plan, nothing else", () => {
    const doc = mkDoc({
      objects: [
        ...twoRooms(),
        unit("i1", "idu", "MSZ-AP20VGD", "room1"),
        unit("i2", "idu", "MSZ-AP20VGD", "room2"),
        run("p1", "i1"),
        run("p2", "i2"),
      ],
      settings: bothChosen(),
    });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    // the first room's inspect card is showing (first served room by default)
    const sub = screen.getByTestId("multi-unit-sub");
    fireEvent.click(within(sub).getByRole("button", { name: /Recall/ }));

    const ids = next!.objects.map((o) => o.id);
    expect(ids).not.toContain("i1");
    expect(ids).not.toContain("p1");
    expect(ids).toContain("i2");
    expect(ids).toContain("p2");
  });
});

describe("Type change + regressions", () => {
  it("changing type away from multi clears the per-room selections and units", () => {
    const doc = mkDoc({
      objects: [...twoRooms(), unit("i1", "idu", "MSZ-AP20VGD", "room1")],
      settings: { ...bothChosen(), pairOdu: "MXZ-2F52VGD" },
    });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { onMutate: (fn) => (next = fn(doc)) });

    fireEvent.click(screen.getByTitle(/Change system type/));
    fireEvent.click(screen.getByRole("button", { name: /Split \(1:1\)/ }));

    expect(next!.systems[0].type).toBe("split");
    expect(next!.systems[0].settings.multiIdus).toBeUndefined();
    expect(next!.systems[0].settings.pairOdu).toBeUndefined();
    expect(next!.objects.map((o) => o.type)).not.toContain("unit");
    expect(next!.objects.filter((o) => o.type === "room")).toHaveLength(2);
  });

  it("split systems still render the split body, no outdoor section (regression)", () => {
    const { container } = renderCockpit(mkDoc({ type: "split", objects: [room("room1", "Bedroom")] }));
    expect(heroState(container)).toBe("empty");
    expect(screen.getByText("Select units", { selector: ".ds-ck-ledger-row .k" })).toBeInTheDocument();
    expect(screen.queryByTestId("outdoor-section")).toBeNull();
    expect(screen.queryByTestId("multi-unit-sub")).toBeNull();
  });
});
