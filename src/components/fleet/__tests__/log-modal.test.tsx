import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogModal } from "../modals";
import type { Vehicle, VehicleLog } from "../logic";

// the receipt reader is a server action — never call it from a component test
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "vrf-04",
  name: "VRF-04",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  plate: "MKT482",
  status: "active",
  odometer: 84120,
  assignedTo: "jordan-mills",
  value: 52000,
  purchasePrice: 58900,
  purchaseDateDays: 1524,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 80000,
  ...over,
});

const mine = vehicle();
const pool = vehicle({ id: "ute-01", name: "UTE-01", plate: "LRT906", assignedTo: null, odometer: 158300 });
const sold = vehicle({ id: "van-01", name: "VAN-01", plate: "JTB114", status: "sold" });
const fleetVehicles = [mine, pool, sold];

function setup(kind: "fuel" | "odo" = "odo", opts: { withFleet?: boolean } = { withFleet: true }) {
  const onSave = jest.fn();
  render(
    <LogModal
      kind={kind}
      vehicle={mine}
      fleetVehicles={opts.withFleet ? fleetVehicles : undefined}
      loggedBy={{ id: "jordan-mills", name: "Jordan Mills" }}
      onSave={onSave}
      onClose={jest.fn()}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

describe("LogModal rego picker", () => {
  it("lists working vehicles by rego, own vehicle first, and excludes sold", () => {
    setup();
    const picker = screen.getByRole("combobox") as HTMLSelectElement;
    const labels = [...picker.options].map((o) => o.textContent);
    expect(labels).toEqual(["MKT482 — VRF-04", "LRT906 — UTE-01"]);
    expect(labels.join()).not.toContain("JTB114"); // sold vehicle is not loggable
    expect(picker.value).toBe("vrf-04"); // defaults to the driver's own vehicle
  });

  it("is hidden when no fleet is passed (single-vehicle context)", () => {
    setup("odo", { withFleet: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("saves the log against the borrowed vehicle once picked", async () => {
    const { onSave, user } = setup();
    await user.selectOptions(screen.getByRole("combobox"), "ute-01");
    await user.type(screen.getByPlaceholderText(/Currently/), "158500");
    await user.click(screen.getByRole("button", { name: /Update odometer/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const log = onSave.mock.calls[0][0] as Omit<VehicleLog, "id" | "when" | "ago">;
    expect(log.vehicleId).toBe("ute-01"); // not the driver's own vrf-04
    expect(log.odo).toBe(158500);
    expect(log.staffName).toBe("Jordan Mills"); // attribution follows the person, not the vehicle
  });

  it("moves the odometer guardrail to the selected vehicle", async () => {
    const { user } = setup();
    // 90,000 is above VRF-04's 84,120 — no warning while it's selected
    await user.type(screen.getByPlaceholderText(/Currently/), "90000");
    expect(screen.queryByText(/Lower than the current/)).not.toBeInTheDocument();

    // the same reading is below UTE-01's 158,300 — the warning follows the switch
    await user.selectOptions(screen.getByRole("combobox"), "ute-01");
    expect(screen.getByText(/Lower than the current 158,300 km/)).toBeInTheDocument();
  });

  it("offers the picker on the fuel scan step, before any receipt is read", () => {
    setup("fuel");
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByText("Snap or upload the receipt")).toBeInTheDocument();
  });
});
