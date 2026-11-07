/* The Air screen (the next flow): while the air side is armed the column says
   what goes down and that thing's own choices, each under its name. Isaac
   picked it on 3 November 2026 over a bar of look-alike chips on the plan. */

import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AirScreen, DEFAULT_AIR, type AirState } from "../air-tools";

function Harness({ start = DEFAULT_AIR, onBack = () => {}, seen }: { start?: AirState; onBack?: () => void; seen?: (a: AirState) => void }) {
  const [air, setAir] = useState(start);
  return (
    <AirScreen
      air={air}
      onAir={(a) => {
        seen?.(a);
        setAir(a);
      }}
      back="Systems"
      onBack={onBack}
    />
  );
}

const labels = () => [...document.querySelectorAll(".ds-air-label")].map((e) => e.textContent);

describe("the Air screen", () => {
  it("names the screen, the one behind, and the six things that go down", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Air" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Systems" })).toBeInTheDocument();
    const kinds = within(screen.getByRole("radiogroup", { name: "What goes down" })).getAllByRole("radio");
    expect(kinds.map((k) => k.textContent)).toEqual(["Grille", "Flex", "Duct", "Arrow", "Sensor", "Controller"]);
    expect(screen.getByRole("radio", { name: "Grille" })).toHaveAttribute("aria-checked", "true");
  });

  it("puts each of a grille's choices under its name", () => {
    render(<Harness />);
    expect(labels()).toEqual(["Supply or return", "Shape", "Sits in", "Size"]);
    expect(screen.getByRole("radiogroup", { name: "Sits in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Width, mm")).toHaveValue("300");
  });

  it("gives Flex and Duct only their size, and a sensor nothing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Flex" }));
    expect(labels()).toEqual(["Size"]);
    expect(within(screen.getByRole("radiogroup", { name: "Size" })).getAllByRole("radio")).toHaveLength(6);
    fireEvent.click(screen.getByRole("radio", { name: "Sensor" }));
    expect(labels()).toEqual([]);
  });

  it("asks an arrow supply or return, with no Both", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Arrow" }));
    expect(labels()).toEqual(["Supply or return"]);
    expect(screen.queryByRole("radio", { name: "Both" })).toBeNull();
  });

  it("keeps a typed size when the side already chosen is pressed again", () => {
    const seen = jest.fn();
    render(<Harness start={{ ...DEFAULT_AIR, size: { wMm: 450, hMm: 450 } }} seen={seen} />);
    fireEvent.click(screen.getByRole("radio", { name: "Supply" }));
    expect(seen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Return" }));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ stream: "return" }));
  });

  it("shows a round grille's sizes as a choice, and a combined one as linear", () => {
    const seen = jest.fn();
    render(<Harness seen={seen} />);
    fireEvent.click(screen.getByRole("radio", { name: "Round" }));
    expect(screen.queryByLabelText("Width, mm")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Size" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ both: true, style: "linear" }));
    expect(labels()).toEqual(["Supply or return", "Sits in", "Size"]);
  });

  it("goes back to the screen behind", () => {
    const onBack = jest.fn();
    render(<Harness onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Systems" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("calls a grille picked on the plan by its name, with no kinds, and its supply side when combined", () => {
    const onSupplyMm = jest.fn();
    render(
      <AirScreen
        picked
        air={{ ...DEFAULT_AIR, both: true, style: "linear", size: { wMm: 1200, hMm: 150 } }}
        onAir={() => {}}
        supplyMm={600}
        onSupplyMm={onSupplyMm}
        back="Systems"
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Grille" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "What goes down" })).toBeNull();
    expect(labels()).toEqual(["Supply or return", "Sits in", "Size", "Supply side"]);
    expect(screen.getByText("mm, return 600")).toBeInTheDocument();
  });
});
