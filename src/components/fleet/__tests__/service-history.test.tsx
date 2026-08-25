import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailModal, ServiceHistoryModal } from "../modals";
import { FleetRegister } from "../register";
import type { FleetState } from "../fleet-state";
import type { Vehicle, VehicleLog } from "../logic";
import { vehicleChips } from "../logic";

/* Service history. The gap this closes is NOT the one renewals had: Log
   service was never gated — it has always sat in the actions row. What was
   missing is the VIEW. Services were mixed into one History list with fuel,
   odometer readings and issues, so "when was this last serviced, and what was
   done" had nowhere to be read.

   The thing to hold onto here is what was deliberately NOT copied across: a
   service supersedes nothing, so no row is tagged Current or Previous. */

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

/* modals.tsx imports the fleet-ai actions, and a "use server" module drags
   auth0 (and `Request`) into jsdom, killing the suite before it runs. */
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readRenewalDocument: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));

const TODAY = "2026-08-25";

const van: Vehicle = {
  id: "v1",
  name: "WORK TRITON",
  make: "Mitsubishi",
  model: "Triton",
  year: 2022,
  plate: "YLI59V",
  plateState: "NSW",
  status: "active",
  odometer: 108375,
  regoDays: 200,
  insuranceDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 100000,
  assignedTo: null,
  value: 27000,
  purchasePrice: 0,
  purchaseDateDays: 0,
};

function log(over: Partial<VehicleLog>): VehicleLog {
  return {
    id: "l",
    vehicleId: "v1",
    staffId: "s1",
    staffName: "Isaac Smith",
    kind: "service",
    when: "Wed 15 Jul",
    ago: 41,
    ...over,
  };
}

const mixed: VehicleLog[] = [
  log({ id: "s2", kind: "service", note: "100,000 km major", odo: 100000, when: "Wed 15 Jul" }),
  log({ id: "f1", kind: "fuel", litres: 62, cost: 118.4, odo: 104000, when: "Tue 4 Aug" }),
  log({ id: "o1", kind: "odo", odo: 108375, when: "Mon 10 Aug" }),
  log({ id: "i1", kind: "issue", note: "rattle in the tray", status: "open", when: "Fri 1 Aug" }),
  log({ id: "s1", kind: "service", note: "90,000 km minor", odo: 90000, when: "Mon 2 Feb" }),
];

function detail(vehicle: Vehicle) {
  const onServiceHistory = jest.fn();
  render(
    <DetailModal
      vehicle={vehicle}
      chips={vehicleChips(vehicle, 0)}
      logs={[]}
      eco={{}}
      onServiceHistory={onServiceHistory}
      staff={[]}
      manager
      onClose={jest.fn()}
      onEdit={jest.fn()}
      onAssign={jest.fn()}
      onStatus={jest.fn()}
      onLog={jest.fn()}
      onResolve={jest.fn()}
      onRemove={jest.fn()}
    />,
  );
  return { onServiceHistory, user: userEvent.setup() };
}

it("opens the service history from the Next service fact", async () => {
  const { onServiceHistory, user } = detail(van);
  await user.click(screen.getByText("Next service"));
  expect(onServiceHistory).toHaveBeenCalled();
});

it("still opens when no service is anywhere near due", async () => {
  // the whole point of a door rather than a warning: reading the history is
  // not something you only want to do once the vehicle is overdue
  const { onServiceHistory, user } = detail({ ...van, odometer: 100000 });
  expect(screen.getByText("in 10,000 km")).toBeInTheDocument();
  await user.click(screen.getByText("Next service"));
  expect(onServiceHistory).toHaveBeenCalled();
});

it("lists the services and leaves the fuel, odometer and issues out of it", () => {
  render(
    <ServiceHistoryModal vehicle={van} logs={mixed} onAdd={jest.fn()} onClose={jest.fn()} />,
  );
  expect(screen.getByText("Service — 100,000 km major")).toBeInTheDocument();
  expect(screen.getByText("Service — 90,000 km minor")).toBeInTheDocument();
  expect(screen.queryByText(/Fuel/)).not.toBeInTheDocument();
  expect(screen.queryByText("Odometer updated")).not.toBeInTheDocument();
  expect(screen.queryByText(/rattle in the tray/)).not.toBeInTheDocument();
});

it("tags no service Current or Previous — a service supersedes nothing", () => {
  render(
    <ServiceHistoryModal vehicle={van} logs={mixed} onAdd={jest.fn()} onClose={jest.fn()} />,
  );
  expect(screen.queryByText("Current")).not.toBeInTheDocument();
  expect(screen.queryByText("Previous")).not.toBeInTheDocument();
});

it("shows the cycle the services set", () => {
  render(
    <ServiceHistoryModal vehicle={van} logs={mixed} onAdd={jest.fn()} onClose={jest.fn()} />,
  );
  expect(screen.getByText("in 1,625 km")).toBeInTheDocument(); // 100,000 + 10,000 − 108,375
  expect(screen.getByText("110,000 km")).toBeInTheDocument(); // due at
});

it("says none are logged rather than claiming the vehicle was never serviced", () => {
  // the cycle above is read off last_service_odo, which a manager can set by
  // hand — an empty log list does not license the stronger claim
  render(
    <ServiceHistoryModal
      vehicle={van}
      logs={mixed.filter((l) => l.kind !== "service")}
      onAdd={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(screen.getByText("No services logged yet")).toBeInTheDocument();
});

it("returns to the service history after logging one, not to the vehicle card", async () => {
  const noop = jest.fn();
  const fleet: FleetState = {
    pending: false,
    error: null,
    clearError: noop,
    saveVehicle: noop,
    recordRenewal: noop,
    removeVehicle: noop,
    assignVehicle: noop,
    addLog: noop,
    editLog: noop,
    deleteLog: noop,
    resolveIssue: noop,
    vehicles: [van],
    logs: mixed,
    aiValues: {},
    documents: {},
    policies: {},
  };
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;

  render(<FleetRegister fleet={fleet} staff={[]} today={TODAY} />);
  const user = userEvent.setup();

  await user.click(screen.getByText("WORK TRITON"));
  await user.click(screen.getByText("Next service"));
  await user.click(screen.getByRole("button", { name: /log service/i }));
  // the log modal's subtitle is the vehicle line — nothing else renders it
  expect(screen.getByText(/WORK TRITON · Mitsubishi Triton 2022/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /cancel/i }));
  /* "Due at" only exists in the service history and "Log fuel" only on the
     vehicle card — the service ROWS render in both, so they cannot tell the
     two apart and are the wrong thing to assert on here. */
  expect(screen.getByText("Due at")).toBeInTheDocument();
  expect(screen.queryByText("Log fuel")).not.toBeInTheDocument();
});
