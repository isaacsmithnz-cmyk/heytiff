import { render, screen } from "@testing-library/react";
import { VehicleCard } from "../vehicle-card";
import type { AssignedVehicle } from "../types";

/* Assigned vehicle. Fleet is the source of the assignment — this card derives
   and never stores, so there is nothing to edit and nothing to save. The two
   things worth pinning are that it speaks the app's shared vocabulary for a
   plate and for a countdown, rather than a second dialect of its own. */

const assigned = (over: Partial<AssignedVehicle["vehicle"]> = {}): AssignedVehicle => ({
  vehicle: {
    id: "v1",
    name: "Ute 2",
    make: "Toyota",
    model: "Hilux",
    year: 2021,
    plate: "abc123",
    plateState: "nsw",
    status: "active",
    odometer: 84200,
    serviceIntervalKm: 10000,
    lastServiceKm: 80000,
    regoDays: 45,
    insuranceDays: 200,
    ...over,
  } as AssignedVehicle["vehicle"],
  openIssues: 0,
  lastFuel: null,
});

describe("VehicleCard", () => {
  it("renders the rego as a plate, not as a suffix", () => {
    const { container } = render(<VehicleCard assigned={assigned()} />);
    const plate = container.querySelector(".au-plate");
    expect(plate).not.toBeNull();
    // uppercased by the shared component, state tag behind its hairline
    expect(plate).toHaveTextContent("ABC123");
    expect(plate).toHaveTextContent("NSW");
    expect(screen.queryByText(/Rego abc123/)).not.toBeInTheDocument();
  });

  it("counts down in the app's words, not in bare days", () => {
    const { container } = render(<VehicleCard assigned={assigned()} />);
    // 45 days reads as "6 weeks" everywhere else in the app; it does here too
    const rego = [...container.querySelectorAll(".pvfacts span")].find((s) =>
      s.textContent?.startsWith("Rego")
    )!;
    expect(rego).toHaveTextContent("in 6weeks");
    expect(rego.querySelector(".dur-u")).toHaveTextContent("weeks");
    expect(rego).not.toHaveTextContent("45d");
  });

  it("says a lapsed rego has lapsed", () => {
    render(<VehicleCard assigned={assigned({ regoDays: -3 })} />);
    expect(screen.getByText("expired")).toBeInTheDocument();
  });

  it("points at Fleet when nothing is assigned", () => {
    render(<VehicleCard assigned={null} />);
    expect(screen.getByText("No vehicle assigned")).toBeInTheDocument();
  });

  it("has no edit cycle — the assignment is managed in Assets", () => {
    const { container } = render(<VehicleCard assigned={assigned()} />);
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(container.querySelector(".card2")).toHaveAttribute("data-static");
  });
});
