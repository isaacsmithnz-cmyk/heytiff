/* Running Pressures UI — refrigerant/unit toggles drive the displayed data,
   and the superheat/subcool calculators compute from typed readings. */

import { render, screen, fireEvent } from "@testing-library/react";
import { RunningPressures } from "../running-pressures";

describe("RunningPressures", () => {
  it("defaults to R32 and shows its cooling suction window", () => {
    render(<RunningPressures />);
    // R32 0–12°C → 716–1085 kPa (12° interpolated between 1014 and 1191)
    expect(screen.getByText(/716–1085 kPa/)).toBeInTheDocument();
    expect(screen.getByText("Typical running pressures — R32")).toBeInTheDocument();
  });

  it("switching refrigerant re-derives the windows", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "R410A" }));
    // R410A 0–12°C → 697–1052 kPa
    expect(screen.getByText(/697–1052 kPa/)).toBeInTheDocument();
  });

  it("psi toggle converts the PT chart", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "psi" }));
    // R32 25°C: 1605 kPa ≈ 233 psi
    expect(screen.getByText("233")).toBeInTheDocument();
  });

  it("computes superheat with sat-temp trace and status", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "R410A" }));
    fireEvent.change(screen.getByLabelText("Suction pressure in kPa"), { target: { value: "832" } });
    fireEvent.change(screen.getByLabelText("Suction line temperature in °C"), { target: { value: "12" } });
    expect(screen.getByText("7.0")).toBeInTheDocument();
    expect(screen.getByText(/832 kPa → sat 5.0°C/)).toBeInTheDocument();
    expect(screen.getByText("Within typical range")).toBeInTheDocument();
  });

  it("computes subcooling and flags a low result", () => {
    render(<RunningPressures />);
    fireEvent.click(screen.getByRole("button", { name: "R410A" }));
    fireEvent.change(screen.getByLabelText("Liquid pressure in kPa"), { target: { value: "2319" } });
    fireEvent.change(screen.getByLabelText("Liquid line temperature in °C"), { target: { value: "39" } });
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(screen.getByText(/undercharge \/ flash gas/)).toBeInTheDocument();
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
