/* UnitsSub (the Units sub-card of the cockpit's Inspect card): shows "Select
   units" until the active system has a chosen pair, then the two drag-to-plan
   unit rows. Also covers the drag→arm / recall contract that unit-card.test.tsx
   used to own (the old UnitCard is now the internal UnitRow). */

import { render, screen, fireEvent } from "@testing-library/react";
import { UnitsSub } from "../cockpit-panel";
import {
  createDesign,
  type DesignDocument,
  type DesignObject,
  type DesignSystem,
} from "@/lib/studio/document";
import type { RoomObj } from "@/lib/studio/loads-room";
import type { PlacingUnit } from "../canvas";

const room: RoomObj = {
  id: "room1",
  type: "room",
  systemId: "sys1",
  floorId: "flr",
  geometry: {
    kind: "polygon",
    points: [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ],
  },
  plane: "room",
  props: { name: "Lounge" },
};

function docWith(system: DesignSystem, extra: DesignObject[] = []): DesignDocument {
  const d = createDesign({ name: "T", mode: "blank", now: "2026-07-10T00:00:00.000Z" });
  d.floors = [{ id: "flr", name: "G", level: 0, scaleMmPerUnit: 10, northDeg: null, northPos: null, plans: [] }];
  d.systems = [system];
  d.objects = [room, ...extra];
  return d;
}

const sys = (settings: Record<string, unknown>): DesignSystem => ({
  id: "sys1",
  type: "split",
  brand: "mitsubishi-electric",
  colour: "#2E68FF",
  name: "System 1",
  settings,
});

const unit = (id: string, role: "idu" | "odu", model: string): DesignObject => ({
  id,
  type: "unit",
  systemId: "sys1",
  floorId: "flr",
  geometry: { kind: "point", at: { x: 100, y: 100 } },
  plane: role === "idu" ? "room" : "external-ground",
  props: { role, model },
});

function renderSub(
  system: DesignSystem,
  extra: DesignObject[] = [],
  handlers: {
    onMutate?: (fn: (d: DesignDocument) => DesignDocument) => void;
    onArmPlace?: (p: PlacingUnit | null) => void;
  } = {}
) {
  const d = docWith(system, extra);
  render(
    <UnitsSub
      doc={d}
      pack={null}
      system={system}
      room={room}
      basis="cooling"
      onMutate={handlers.onMutate ?? (() => {})}
      onArmPlace={handlers.onArmPlace ?? (() => {})}
    />
  );
  return d;
}

describe("UnitsSub", () => {
  it("shows Select units until a pair is chosen", () => {
    renderSub(sys({}));
    expect(screen.getByRole("button", { name: /Select units/ })).toBeInTheDocument();
    // and nothing to swap yet
    expect(screen.queryByRole("button", { name: /Swap units/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("unit-card-idu")).not.toBeInTheDocument();
  });

  it("renders the indoor + outdoor drag rows once a pair is chosen", () => {
    renderSub(sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }));
    expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
    expect(screen.getByTestId("unit-card-odu")).toBeInTheDocument();
    expect(screen.getByText("SLZ-M25FA-A")).toBeInTheDocument();
    expect(screen.getByText("SUZ-M25VAD-A")).toBeInTheDocument();
  });

  /* The swap used to wait for BOTH units to be on the plan, which stranded
     anyone who picked the wrong pair and placed one of them (field feedback
     2026-07-25). */
  it("offers the swap mid-placement, beside the placed counter", () => {
    renderSub(sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }), [
      unit("u_idu", "idu", "SLZ-M25FA-A"),
    ]);
    expect(screen.getByText("1 / 2 placed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Swap units/ })).toBeInTheDocument();
  });

  it("drops the counter once both are down, keeping the swap", () => {
    renderSub(sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }), [
      unit("u_idu", "idu", "SLZ-M25FA-A"),
      unit("u_odu", "odu", "SUZ-M25VAD-A"),
    ]);
    expect(screen.queryByText(/placed$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Swap units/ })).toBeInTheDocument();
  });

  it("an unplaced row is draggable and arms placement; dragend disarms", () => {
    const armed: (PlacingUnit | null)[] = [];
    renderSub(sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }), [], {
      onArmPlace: (p) => armed.push(p),
    });
    const card = screen.getByTestId("unit-card-idu");
    expect(card).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(card);
    expect(armed[0]).toMatchObject({ role: "idu", model: "SLZ-M25FA-A" });
    expect(typeof armed[0]!.widthMm).toBe("number");
    fireEvent.dragEnd(card);
    expect(armed[1]).toBeNull();
  });

  it("a placed row is not draggable and offers Recall", () => {
    const armed: (PlacingUnit | null)[] = [];
    renderSub(
      sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }),
      [unit("u_idu", "idu", "SLZ-M25FA-A"), unit("u_odu", "odu", "SUZ-M25VAD-A")],
      { onArmPlace: (p) => armed.push(p) }
    );
    const card = screen.getByTestId("unit-card-idu");
    expect(card).toHaveAttribute("draggable", "false");
    fireEvent.dragStart(card);
    expect(armed).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Recall Indoor unit" })).toBeInTheDocument();
  });

  it("recall removes the placed unit and the system's pipework, keeping the rest", () => {
    const system = sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" });
    const d = docWith(system, [
      unit("u_idu", "idu", "SLZ-M25FA-A"),
      unit("u_odu", "odu", "SUZ-M25VAD-A"),
      {
        id: "run1",
        type: "pipe-run",
        systemId: "sys1",
        floorId: "flr",
        geometry: { kind: "polyline", points: [{ x: 100, y: 100 }, { x: 300, y: 100 }] },
        plane: "room",
        props: {},
      },
    ]);

    let next: DesignDocument | undefined;
    render(
      <UnitsSub
        doc={d}
        pack={null}
        system={system}
        room={room}
        basis="cooling"
        onMutate={(fn) => (next = fn(d))}
        onArmPlace={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recall Indoor unit" }));

    const ids = next!.objects.map((o) => o.id);
    expect(ids).not.toContain("u_idu"); // the recalled unit is gone
    expect(ids).not.toContain("run1"); // its pipework dropped (would dangle)
    expect(ids).toContain("u_odu"); // the outdoor unit stays
    expect(ids).toContain("room1"); // the room stays
  });

  it("names the reopen action for what it does, under the units it acts on", () => {
    renderSub(sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }), [
      unit("u_idu", "idu", "SLZ-M25FA-A"),
      unit("u_odu", "odu", "SUZ-M25VAD-A"),
    ]);
    /* "Select units" is the first-run wording only; with a pair chosen the
       same slot reads "Swap units" (field feedback 2026-07-26). It sits after
       the two unit cards, not in the section header. */
    const swap = screen.getByRole("button", { name: /Swap units/ });
    expect(screen.queryByRole("button", { name: /Select units/ })).not.toBeInTheDocument();
    const cards = screen.getAllByTestId(/^unit-card-/);
    expect(
      cards[1].compareDocumentPosition(swap) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
