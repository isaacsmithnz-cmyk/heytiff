/* Unit drag-cards (Slice 3): dragging arms placement with the unit's to-scale
   footprint; a cancelled drag disarms; a placed card is inert and badged. */

import { render, screen, fireEvent } from "@testing-library/react";
import { UnitCard } from "../split-panel";
import type { PlacingUnit } from "../canvas";

describe("UnitCard", () => {
  it("dragstart arms placement with the unit footprint; dragend disarms", () => {
    const armed: (PlacingUnit | null)[] = [];
    render(
      <UnitCard
        role="idu"
        label="Indoor unit"
        model="MSZ-AP50VGD"
        widthMm={1100}
        depthMm={238}
        placed={false}
        onArmPlace={(p) => armed.push(p)}
      />
    );
    const card = screen.getByTestId("unit-card-idu");
    expect(card).toHaveAttribute("draggable", "true");
    expect(screen.getByText("drag to plan")).toBeInTheDocument();

    fireEvent.dragStart(card);
    expect(armed[0]).toEqual({
      role: "idu",
      model: "MSZ-AP50VGD",
      widthMm: 1100,
      depthMm: 238,
    });

    // drag cancelled (no drop) — the arm is released
    fireEvent.dragEnd(card);
    expect(armed[1]).toBeNull();
  });

  it("a placed card is not draggable and shows the Placed badge", () => {
    const armed: (PlacingUnit | null)[] = [];
    render(
      <UnitCard
        role="odu"
        label="Outdoor unit"
        model="MUZ-AP50VGD"
        widthMm={800}
        depthMm={285}
        placed
        onArmPlace={(p) => armed.push(p)}
      />
    );
    const card = screen.getByTestId("unit-card-odu");
    expect(card).toHaveAttribute("draggable", "false");
    expect(screen.getByText("Placed")).toBeInTheDocument();

    fireEvent.dragStart(card);
    expect(armed).toHaveLength(0);
  });

  it("a placed card offers Recall; clicking it fires onRecall", () => {
    const recalled: number[] = [];
    render(
      <UnitCard
        role="idu"
        label="Indoor unit"
        model="MSZ-AP50VGD"
        widthMm={1100}
        depthMm={238}
        placed
        onArmPlace={() => {}}
        onRecall={() => recalled.push(1)}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Recall Indoor unit" }));
    expect(recalled).toEqual([1]);
  });

  it("without onRecall a placed card shows no Recall button", () => {
    render(
      <UnitCard
        role="odu"
        label="Outdoor unit"
        model="MUZ-AP50VGD"
        widthMm={800}
        depthMm={285}
        placed
        onArmPlace={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /Recall/ })).toBeNull();
  });
});
