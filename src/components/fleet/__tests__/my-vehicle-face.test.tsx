import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyVehicleFace } from "../my-vehicle-face";
import type { Vehicle, VehicleLog } from "../logic";

/* THE LOG FACES SHOW EVERYTHING, AND ONLY THEIR OWN KIND.

   Two guards live here, from two different bugs. The first: the old single
   page rendered `logs.slice(0, 8)` under "Recent activity" and simply stopped
   — log nine existed in the table and nowhere on screen, so the ninth log is
   what disappears first if a face ever truncates again.

   The second: there was ONE face called History carrying every kind at once —
   "History is too broad. Where can you see the issues that you have logged? Or
   your last services?" (Isaac, 2026-08-23). Fuel, Issues and Services each
   answer one question now, and what these pin is that a face never shows
   somebody else's kind. */

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
    <MyVehicleFace
      own={{ vehicle: vehicle(), pickable: [], logs: nineLogs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  expect(screen.getByRole("heading", { name: "VRF-04" })).toBeInTheDocument();
  // the log pile stays behind its own tab
  expect(screen.queryByText("Log 9")).not.toBeInTheDocument();
});

it("shows every log on its face, not the newest eight", async () => {
  const user = userEvent.setup();
  render(
    <MyVehicleFace
      own={{ vehicle: vehicle(), pickable: [], logs: nineLogs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  // the nine are odometer readings, which ride with Fuel
  await user.click(screen.getByRole("tab", { name: "Fuel" }));
  expect(screen.getByText("Log 1")).toBeInTheDocument();
  expect(screen.getByText("Log 9")).toBeInTheDocument();
});

it("sends each kind to its own face, and nowhere else", async () => {
  const user = userEvent.setup();
  const logs: VehicleLog[] = [
    { ...log(1), kind: "fuel", when: "A fill", litres: 60 },
    { ...log(2), kind: "issue", when: "A fault", note: "Aircon warm", status: "open" },
    { ...log(3), kind: "service", when: "A service", note: "100,000 km" },
  ];
  render(
    <MyVehicleFace
      own={{ vehicle: vehicle(), pickable: [], logs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );

  await user.click(screen.getByRole("tab", { name: "Fuel" }));
  expect(screen.getByText("A fill")).toBeInTheDocument();
  expect(screen.queryByText("Aircon warm")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: /Issues/ }));
  expect(screen.getByText(/Aircon warm/)).toBeInTheDocument();
  expect(screen.queryByText("A fill")).not.toBeInTheDocument();
  expect(screen.queryByText(/100,000 km/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Services" }));
  expect(screen.getByText(/100,000 km/)).toBeInTheDocument();
  expect(screen.queryByText("A fill")).not.toBeInTheDocument();
});

/* THE COUNT IS WHAT IS STILL WRONG. "Issues — 3" meaning "three faults have
   ever been reported on this ute" is a number nobody asked for; the one worth
   a badge is the one still waiting on somebody. */
it("counts only the OPEN issues on the switch", async () => {
  const user = userEvent.setup();
  const logs: VehicleLog[] = [
    { ...log(1), kind: "issue", when: "Open one", note: "Aircon warm", status: "open" },
    { ...log(2), kind: "issue", when: "Done one", note: "Tray light", status: "resolved" },
  ];
  render(
    <MyVehicleFace
      own={{ vehicle: vehicle(), pickable: [], logs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  expect(screen.getByRole("tab", { name: /Issues — 1 still open/ })).toBeInTheDocument();
  // …and the open one leads, however old it is
  await user.click(screen.getByRole("tab", { name: /Issues/ }));
  const rows = screen.getAllByText(/Aircon warm|Tray light/);
  expect(rows[0]).toHaveTextContent("Aircon warm");
});

it("still answers when no vehicle is assigned, per face", async () => {
  const user = userEvent.setup();
  render(
    <MyVehicleFace
      own={{ vehicle: null, pickable: [], logs: [] }}
      today="2026-08-22"
      viewerStaffId={null}
    />,
  );
  /* Each face says its OWN empty line — "Nothing logged yet" under a tab
     called Issues reads as the screen being broken, not as good news. */
  await user.click(screen.getByRole("tab", { name: /Issues/ }));
  expect(screen.getByText(/Nothing wrong with it/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Services" }));
  expect(screen.getByText(/No service logged/)).toBeInTheDocument();
});

/* THE PANEL SWAPS IN PLACE — no remount, no fade. Same recipe, same cause,
   same reference as Team's directory; see my-notes-face.test.tsx. */
it("swaps the face in place — same panel node, no fade class", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <MyVehicleFace
      own={{ vehicle: vehicle(), pickable: [], logs: nineLogs }}
      today="2026-08-22"
      viewerStaffId="jordan-mills"
    />,
  );
  const panel = () => container.querySelector('[role="tabpanel"]');

  const before = panel();
  expect(before).not.toHaveClass("psec2");

  await user.click(screen.getByRole("tab", { name: /Issues/ }));
  expect(panel()).toBe(before);
  expect(panel()).not.toHaveClass("psec2");
});
