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

  /* Recall used to be absolutely positioned at the card's right edge — the
     same spot `.ds-ck-ukw` claims with `margin-left: auto` — so it revealed
     straight on top of the capacity figure. It now lives in a slot that is
     always there, and it's icon-only: the label survives as its accessible
     name, which is what the tests reach it by. */
  it("keeps Recall in its own reserved slot, off the capacity figure", () => {
    renderSub(
      sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A" }),
      [unit("u_idu", "idu", "SLZ-M25FA-A")],
    );
    const card = screen.getByTestId("unit-card-idu");
    const slot = card.querySelector(".ds-ck-uact")!;
    expect(slot).not.toBeNull();
    expect(slot.contains(screen.getByRole("button", { name: "Recall Indoor unit" }))).toBe(true);

    // the slot is reserved even with nothing in it, so nothing shifts on hover
    const unplaced = screen.getByTestId("unit-card-odu");
    expect(unplaced.querySelector(".ds-ck-uact")).not.toBeNull();
    expect(unplaced.querySelector(".ds-ck-recall")).toBeNull();
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

  /* A split serves ONE room with ONE pair, but it can be attached to several
     rooms (drop-adopts, "Serve an existing room"). The card used to look the
     placed unit up by SYSTEM alone, so the same unit appeared on every served
     room's card — it read as though it followed you around, and Recall / the
     pair picker both acted on the system from a room that didn't own it. */
  describe("a system serving more than one room", () => {
    const other: RoomObj = { ...room, id: "room2", props: { name: "Study" } };

    const renderFor = (r: RoomObj, extra: DesignObject[], settings = {}) => {
      const system = sys({ pairIdu: "SLZ-M25FA-A", pairOdu: "SUZ-M25VAD-A", ...settings });
      const d = docWith(system, extra);
      d.objects = [...d.objects, other];
      render(
        <UnitsSub
          doc={d}
          pack={null}
          system={system}
          room={r}
          basis="cooling"
          onMutate={() => {}}
          onArmPlace={() => {}}
        />
      );
    };

    const inRoom1 = (): DesignObject => ({
      ...unit("u_idu", "idu", "SLZ-M25FA-A"),
      props: { role: "idu", model: "SLZ-M25FA-A", roomId: "room1" },
    });

    it("shows the unit on the room it was placed in", () => {
      renderFor(room, [inRoom1()]);
      expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
      expect(screen.queryByTestId("units-elsewhere")).not.toBeInTheDocument();
    });

    it("tells the OTHER room where the unit actually is, read-only", () => {
      renderFor(other, [inRoom1()]);
      expect(screen.getByTestId("units-elsewhere")).toBeInTheDocument();
      expect(screen.getByText(/Lounge/)).toBeInTheDocument();
      // nothing here can act on another room's pair
      expect(screen.queryByTestId("unit-card-idu")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Recall/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /units/ })).not.toBeInTheDocument();
    });

    it("follows settings.roomId when the pair is chosen but not yet placed", () => {
      renderFor(other, [], { roomId: "room1" });
      expect(screen.getByTestId("units-elsewhere")).toBeInTheDocument();
    });

    /* dropped outside every room, so no room owns it — it has to stay visible
       or it would vanish from the panel with nowhere to send you */
    it("keeps an unattributed unit visible on every served room", () => {
      renderFor(other, [unit("u_idu", "idu", "SLZ-M25FA-A")]);
      expect(screen.getByTestId("unit-card-idu")).toBeInTheDocument();
      expect(screen.queryByTestId("units-elsewhere")).not.toBeInTheDocument();
    });
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
