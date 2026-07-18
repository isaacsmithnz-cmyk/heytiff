/* Running Pressures UI — colour-coded picker drives the manifold panels,
   glide blends switch to a two-column chart, refrigeration fluids swap
   their duty windows, and the calculators compute glide-correctly. */

import { render, screen, fireEvent } from "@testing-library/react";
import { RunningPressures } from "../running-pressures";
import { REFRIGERANT_KEYS } from "@/lib/toolbox/refrigerant";

describe("RunningPressures", () => {
  it("renders all 7 refrigerant cards, R32 first and selected by default", () => {
    render(<RunningPressures />);
    const picker = screen.getByRole("group", { name: "Refrigerant" });
    const cards = [...picker.querySelectorAll("button")];
    expect(cards.map((c) => c.querySelector("b")?.textContent)).toEqual([...REFRIGERANT_KEYS]);
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    // R32 0–12°C → 716–1085 kPa (12° interpolated between 1014 and 1191)
    expect(screen.getByText(/716–1085/)).toBeInTheDocument();
    // manifold panels labelled by hose side
    expect(screen.getByText("Low side")).toBeInTheDocument();
    expect(screen.getByText("High side")).toBeInTheDocument();
  });

  it("flammability chips mark R32 (A2L) and R290 (A3)", () => {
    render(<RunningPressures />);
    expect(screen.getByText("A2L")).toBeInTheDocument();
    expect(screen.getByText("A3")).toBeInTheDocument();
  });

  it("switching refrigerant re-derives the windows and facts strip", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: /^R22\b/ }));
    // R22 cooling suction 0–12°C → 397–624 kPa
    expect(screen.getByText(/397–624/)).toBeInTheDocument();
    expect(screen.getByText(/Legacy splits/)).toBeInTheDocument();
    expect(screen.getByText(/Phase-out/)).toBeInTheDocument();
  });

  it("R404A swaps to refrigeration duty: MT + LT bands, no heating toggle", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: /R404A/ }));
    expect(screen.getByText(/cold room \(MT\)/i)).toBeInTheDocument();
    expect(screen.getByText(/freezer \(LT\)/i)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mode" })).not.toBeInTheDocument();
  });

  it("heating mode swaps the AC bands", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "Heating" }));
    // R32 heating suction −15…5°C → 387–857 kPa
    expect(screen.getByText(/387–857/)).toBeInTheDocument();
  });

  it("R407C shows the glide facts + two-column chart", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: /R407C/ }));
    expect(screen.getByText(/glide ~5.5 K/)).toBeInTheDocument();
    expect(screen.getByText("Liquid (kPa)")).toBeInTheDocument();
    expect(screen.getByText("Vapor (kPa)")).toBeInTheDocument();
    // pure fluids show a single pressure column
    fireEvent.click(screen.getByRole("button", { name: /R290/ }));
    expect(screen.queryByText("Liquid (kPa)")).not.toBeInTheDocument();
    expect(screen.getByText("Pressure (kPa)")).toBeInTheDocument();
  });

  it("psi toggle converts the chart", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "psi" }));
    // R32 25°C: 1605 kPa ≈ 233 psi
    expect(screen.getByText("233")).toBeInTheDocument();
  });

  it("computes superheat with sat-temp trace and status", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: /R410A/ }));
    fireEvent.change(screen.getByLabelText("Suction pressure in kPa"), { target: { value: "832" } });
    fireEvent.change(screen.getByLabelText("Suction line temperature in °C"), { target: { value: "12" } });
    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByText(/832 kPa → sat 5.0°C/)).toBeInTheDocument();
    expect(screen.getByText("Within typical range")).toBeInTheDocument();
  });

  it("R407C calculators read the correct columns (dew for SH, bubble for SC)", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: /R407C/ }));
    // 346 kPag = dew 0°C; line 7°C → 7.0 K superheat
    fireEvent.change(screen.getByLabelText("Suction pressure in kPa"), { target: { value: "346" } });
    fireEvent.change(screen.getByLabelText("Suction line temperature in °C"), { target: { value: "7" } });
    expect(screen.getByText(/346 kPa → sat 0.0°C \(dew\)/)).toBeInTheDocument();
    // 1089 kPag = bubble 25°C; line 18°C → 7.0 K subcooling
    fireEvent.change(screen.getByLabelText("Liquid pressure in kPa"), { target: { value: "1089" } });
    fireEvent.change(screen.getByLabelText("Liquid line temperature in °C"), { target: { value: "18" } });
    expect(screen.getByText(/1089 kPa → sat 25.0°C \(bubble\)/)).toBeInTheDocument();
    expect(screen.getAllByText("7.0")).toHaveLength(2);
  });

  it("accepts negative line temps (heating mode) via signed parse", () => {
    render(<RunningPressures />);
    fireEvent.change(screen.getByLabelText("Suction pressure in kPa"), { target: { value: "716" } });
    fireEvent.change(screen.getByLabelText("Suction line temperature in °C"), { target: { value: "-2" } });
    // R32 716 kPa → 0°C sat; line −2°C → −2 K (flood-back warning)
    expect(screen.getByText("-2.0")).toBeInTheDocument();
    expect(screen.getByText(/flood-back risk/)).toBeInTheDocument();
  });
});
