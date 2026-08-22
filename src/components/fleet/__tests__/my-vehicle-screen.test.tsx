import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyVehicleScreen } from "../my-vehicle-screen";
import type { Vehicle, VehicleLog } from "../logic";

/* THE HISTORY TAB SHOWS EVERYTHING. The old single page rendered
   `logs.slice(0, 8)` under "Recent activity" and simply stopped — log nine
   existed in the table and nowhere on screen. The ninth log is the whole
   point of this file: if History ever truncates again, the oldest row here
   is what disappears first. */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(),
  valueFleet: jest.fn(),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(),
}));
jest.mock("@/app/actions/fleet", () => ({
  addLog: jest.fn(async () => ({ ok: true })),
  assignVehicle: jest.fn(async () => ({ ok: true })),
  deleteLog: jest.fn(async () => ({ ok: true })),
  editLog: jest.fn(async () => ({ ok: true })),
  removeVehicle: jest.fn(async () => ({ ok: true })),
  resolveIssue: jest.fn(async () => ({ ok: true })),
  saveValuations: jest.fn(async () => ({ ok: true })),
  saveVehicle: jest.fn(async () => ({ ok: true })),
}));

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "vrf-04",
  name: "VRF-04",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  plate: "MKT482",
  plateState: "VIC",
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

const log = (n: number): VehicleLog => ({
  id: `vl-${n}`,
  vehicleId: "vrf-04",
  staffId: "jordan-mills",
  kind: "odo",
  when: `Log ${n}`,
  ago: n,
  odo: 84000 - n,
});

const nineLogs = Array.from({ length: 9 }, (_, i) => log(i + 1));

it("opens on the Vehicle face — the truck, not the paperwork", () => {
  render(
    <MyVehicleScreen
      own={{ vehicle: vehicle(), pickable: [], logs: nineLogs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  expect(screen.getByRole("heading", { name: "VRF-04" })).toBeInTheDocument();
  // the log pile stays behind its own tab
  expect(screen.queryByText("Log 9")).not.toBeInTheDocument();
});

it("shows every log on History, not the newest eight", async () => {
  const user = userEvent.setup();
  render(
    <MyVehicleScreen
      own={{ vehicle: vehicle(), pickable: [], logs: nineLogs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  await user.click(screen.getByRole("tab", { name: /History — 9 logged/ }));
  expect(screen.getByText("Log 1")).toBeInTheDocument();
  expect(screen.getByText("Log 9")).toBeInTheDocument();
});

it("still answers on History when no vehicle is assigned", async () => {
  const user = userEvent.setup();
  render(
    <MyVehicleScreen
      own={{ vehicle: null, pickable: [], logs: [] }}
      today="2026-08-22"
      viewerStaffId={null}
    />,
  );
  await user.click(screen.getByRole("tab", { name: "History" }));
  expect(screen.getByText(/Nothing logged yet/)).toBeInTheDocument();
});
