/* Cockpit ducted body (Stage 7, Step 2) — the plenum inspect card (body dims,
   facet state, spigot roster, "+ spigot" series picker, delete), the AHU
   card's plenum status line, the Configure spill toggle, and the spill
   surfaces (roster ⤢ badge, hero "+ N spill", requirement drop). Runs against
   the real ME pack so the PEAD plenum specs are genuine. */

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
   can't flip per-test — mock the registry entry instead (same pattern as
   cockpit-ducted.test.tsx). */
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
const basePack = loadPack();
/* the ME pack ships no opening dims yet (grey-default path) — seed a real
   supply opening on the test AHU so the card exercises the data path, and
   clone one row into the built-in-return case */
const pack: DataPack = {
  ...basePack,
  indoor_units: basePack.indoor_units.map((u) =>
    u.model === "PEAD-M100JAA(D)"
      ? { ...u, supply_opening: { w_mm: 1400, h_mm: 250 } as const }
      : u
  ),
};
const packBuiltIn: DataPack = {
  ...pack,
  indoor_units: pack.indoor_units.map((u) =>
    u.model === "PEAD-M100JAA(D)" ? { ...u, return_opening: "built-in" as const } : u
  ),
};

const floor: Floor = { id: "flr", name: "Ground", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] };

const room = (id: string, name: string, w: number, h: number, spill = false): DesignObject => ({
  id,
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] },
  plane: "room",
  props: { name, ...(spill ? { spill: true } : {}) },
});

const placedAhu = (): DesignObject => ({
  id: "u1",
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 10, y: 10 } },
  plane: "ceiling-cavity",
  props: { role: "idu", model: "PEAD-M100JAA(D)", widthMm: 1400, depthMm: 732 },
});

const plenumObj = (
  spigots: unknown[] = [],
  end: "supply" | "return" = "supply"
): DesignObject => ({
  id: "pl1",
  type: "plenum",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 80, y: 10 } },
  plane: "ceiling-cavity",
  props: { stream: end, unitId: "u1", end, spigots },
});

function mkDoc(opts: {
  settings?: Record<string, unknown>;
  objects?: DesignObject[];
  units?: "mm" | "inch";
} = {}): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-14T00:00:00.000Z" });
  d.floors = [floor];
  d.settings.climateZone = "5";
  if (opts.units) d.settings.units = opts.units;
  d.systems = [
    { id: "sys1", type: "ducted", brand: "mitsubishi-electric", colour: "#2E68FF", name: "System 1", settings: opts.settings ?? { pairIdu: "PEAD-M100JAA(D)", pairOdu: "PUZ-M100VKA-A" } },
  ];
  d.objects = opts.objects ?? [];
  return d;
}

function renderCockpit(
  doc: DesignDocument,
  opts: {
    selectedId?: string | null;
    onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
    onSelect?: (id: string | null) => void;
    pack?: DataPack;
  } = {}
) {
  return render(
    <SystemCockpit
      doc={doc}
      pack={opts.pack ?? pack}
      packVersion="2026.1"
      activeSystemId="sys1"
      onActivate={() => {}}
      onMutate={opts.onMutate ?? (() => {})}
      selectedId={opts.selectedId ?? null}
      onSelect={opts.onSelect ?? (() => {})}
      onEditRoom={() => {}}
      onArmPlace={() => {}}
      onDrawRoom={() => {}}
      floor={floor}
      onAddVariant={() => {}}
      onSwitchVariant={() => {}}
      onRenameVariant={() => {}}
    />
  );
}

const twoRooms = () => [room("room1", "Living", 800, 500), room("room2", "Study", 400, 300)];

describe("plenum inspect card", () => {
  const spigs = [
    { id: "s1", diaMm: 350, t: 1 / 3, face: "front" },
    { id: "s2", diaMm: 350, t: 2 / 3, face: "front" },
  ];

  it("shows engine base dims and the spigot roster (real opening seeded)", () => {
    renderCockpit(mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj(spigs)] }), {
      selectedId: "pl1",
    });
    const card = screen.getByTestId("plenum-card");
    expect(within(card).getByText("Supply plenum")).toBeInTheDocument();
    // the seeded OPENING, W × H — the plan depth is geometry, never shown
    expect(within(card).getByText("1400 × 250 mm")).toBeInTheDocument();
    // real opening → not the grey estimated default, and 2×14" fits (not over)
    expect(within(card).queryByText("estimated — no opening data in pack")).toBeNull();
    expect(within(card).queryByText("too many ducts for this plenum")).toBeNull();
    // roster: two Ø350 front spigots (mm units by default) — scoped to the
    // roster so the "+ spigot" series chips don't double-match
    const roster = card.querySelector(".ds-ck-spigs") as HTMLElement;
    expect(within(roster).getAllByText("Ø350")).toHaveLength(2);
    expect(within(roster).getAllByText("front")).toHaveLength(2);
  });

  it("+ spigot adds at the picked size and re-packs the face evenly", () => {
    const doc = mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj(spigs)] });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { selectedId: "pl1", onMutate: (fn) => (next = fn(doc)) });

    fireEvent.click(screen.getByRole("button", { name: "Ø400" }));
    const list = next!.objects.find((o) => o.id === "pl1")!.props.spigots as {
      id: string;
      diaMm: number;
      t: number;
      face: string;
    }[];
    expect(list).toHaveLength(3);
    const added = list.find((s) => s.diaMm === 400)!;
    expect(added.face).toBe("front");
    // even re-pack: .33 / .5 (new) / .67 → 0.25 / 0.5 / 0.75
    expect(added.t).toBeCloseTo(0.5, 6);
    expect(list.find((s) => s.id === "s1")!.t).toBeCloseTo(0.25, 6);
    expect(list.find((s) => s.id === "s2")!.t).toBeCloseTo(0.75, 6);
  });

  it("the face picker routes new spigots to a side face, independently packed", () => {
    const doc = mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj(spigs)] });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { selectedId: "pl1", onMutate: (fn) => (next = fn(doc)) });

    fireEvent.click(screen.getByRole("radio", { name: "left" }));
    fireEvent.click(screen.getByRole("button", { name: "Ø250" }));
    const list = next!.objects.find((o) => o.id === "pl1")!.props.spigots as {
      id: string;
      diaMm: number;
      t: number;
      face: string;
    }[];
    const added = list.find((s) => s.diaMm === 250)!;
    expect(added.face).toBe("left");
    expect(added.t).toBeCloseTo(0.5, 6); // alone on its face
    // the front pair stays put
    expect(list.find((s) => s.id === "s1")!.t).toBeCloseTo(1 / 3, 6);
  });

  it("deleting a spigot re-packs the survivors; delete-plenum drops the object", () => {
    const doc = mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj(spigs)] });
    let next: DesignDocument | undefined;
    const onSelect = jest.fn();
    renderCockpit(doc, { selectedId: "pl1", onMutate: (fn) => (next = fn(doc)), onSelect });

    const card = screen.getByTestId("plenum-card");
    fireEvent.click(within(card).getAllByTitle("Delete spigot")[0]);
    const list = next!.objects.find((o) => o.id === "pl1")!.props.spigots as { t: number }[];
    expect(list).toHaveLength(1);
    expect(list[0].t).toBeCloseTo(0.5, 6);

    fireEvent.click(within(card).getByRole("button", { name: /Delete plenum/ }));
    expect(next!.objects.some((o) => o.id === "pl1")).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("too many ducts for the opening → the card warns, base stays put (inch units)", () => {
    // no opening data seeded → grey derived default base; four 14" (1650 mm
    // needed) exceed it → over-spigot warning, base never grows (spec §1b)
    const four = [0.2, 0.4, 0.6, 0.8].map((t, i) => ({
      id: `s${i}`,
      diaMm: 350,
      t,
      face: "front",
    }));
    renderCockpit(
      mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj(four)], units: "inch" }),
      { selectedId: "pl1" }
    );
    const card = screen.getByTestId("plenum-card");
    expect(within(card).getByText("too many ducts for this plenum")).toBeInTheDocument();
    // the card shows the OPENING height (250), not the plan depth
    expect(within(card).getByText(/× 250 mm$/)).toBeInTheDocument();
    const roster = card.querySelector(".ds-ck-spigs") as HTMLElement;
    expect(within(roster).getAllByText('14"')).toHaveLength(4);
  });
});

describe("AHU inspect card — plenum status line", () => {
  it("reports the fitted supply and the missing return", () => {
    renderCockpit(mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj()] }), {
      selectedId: "u1",
    });
    const row = screen.getByText("Plenums").closest(".ds-ck-objrow")!;
    expect(row).toHaveTextContent("Supply plenum fitted · no return yet");
  });

  it("knows a built-in return from the pack", () => {
    renderCockpit(mkDoc({ objects: [...twoRooms(), placedAhu(), plenumObj()] }), {
      selectedId: "u1",
      pack: packBuiltIn,
    });
    expect(screen.getByText("Plenums").closest(".ds-ck-objrow")!).toHaveTextContent(
      "Supply plenum fitted · return built-in"
    );
  });

  it("starts honest: no plenums yet", () => {
    renderCockpit(mkDoc({ objects: [...twoRooms(), placedAhu()] }), { selectedId: "u1" });
    expect(screen.getByText("Plenums").closest(".ds-ck-objrow")!).toHaveTextContent(
      "No plenums yet"
    );
  });
});

describe("spill rooms (Configure toggle + surfaces)", () => {
  it("the Configure toggle writes room.props.spill", () => {
    const doc = mkDoc({ objects: twoRooms(), settings: {} });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { selectedId: "room2", onMutate: (fn) => (next = fn(doc)) });

    const toggle = screen.getByRole("checkbox", { name: "Spill room" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(next!.objects.find((o) => o.id === "room2")!.props.spill).toBe(true);
  });

  it("unticking removes the flag entirely", () => {
    const doc = mkDoc({
      objects: [room("room1", "Living", 800, 500), room("room2", "Study", 400, 300, true)],
      settings: {},
    });
    let next: DesignDocument | undefined;
    renderCockpit(doc, { selectedId: "room2", onMutate: (fn) => (next = fn(doc)) });
    fireEvent.click(screen.getByRole("checkbox", { name: "Spill room" }));
    expect("spill" in next!.objects.find((o) => o.id === "room2")!.props).toBe(false);
  });

  it("roster badge + hero '+ 1 spill' + the requirement drops the room", () => {
    // both rooms sized → ~7.5 kW (the Step-1 fixture); spilling the study
    // leaves the living room alone → ~5.8 kW
    renderCockpit(
      mkDoc({
        objects: [room("room1", "Living", 800, 500), room("room2", "Study", 400, 300, true)],
        settings: {},
      })
    );
    expect(screen.getByText("5.8 kW", { selector: ".ds-ck-ledger-row.req .v" })).toBeInTheDocument();
    expect(screen.getByText(/1 room \+ 1 spill/)).toBeInTheDocument();
    expect(
      screen.getByTitle("Spill room — receives spill air only")
    ).toBeInTheDocument();
  });
});
