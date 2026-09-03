import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FleetActions } from "../../fleet-state";
import type { Vehicle, VehicleLog, VehiclePolicy } from "../../logic";
import { VehicleModal } from "..";

/* The shell: one modal, one `screen` value, and the register's actions behind
   every control. The main screen's own reasoning is tested in derive.test.ts;
   this is the wiring — that a door moves the screen, that a control reaches
   the action it should, and that nothing on the card can write anything the
   register wouldn't. */

jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })),
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readRenewalDocument: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));

const TODAY = "2026-09-02";

const triton: Vehicle = {
  id: "v1",
  name: "WORK TRITON",
  make: "Mitsubishi",
  model: "Triton",
  year: 2022,
  plate: "YLI59V",
  plateState: "NSW",
  status: "active",
  odometer: 108375,
  regoDays: 27,
  insuranceDays: null,
  ctpDays: 392,
  serviceIntervalKm: 10000,
  lastServiceOdo: 100000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
  vin: "MMAWLKL10NH035826",
  tareKg: 2180,
  gvmKg: 2900,
};

const slip: VehiclePolicy = {
  id: "p-ctp",
  kind: "ctp",
  provider: "QBE",
  premium: 945.54,
  startsOn: "2026-09-30",
  expiresOn: "2027-09-29",
  documentId: null,
};

const logs: VehicleLog[] = [
  { id: "l1", vehicleId: "v1", staffId: null, kind: "fuel", when: "Mon 1 Sep", ago: 1, litres: 62, cost: 118.4 },
  { id: "l2", vehicleId: "v1", staffId: null, kind: "issue", when: "Sat 30 Aug", ago: 3, note: "wiper blade", status: "open" },
];

function fleet(): FleetActions {
  return {
    pending: false,
    error: null,
    clearError: jest.fn(),
    saveVehicle: jest.fn(),
    recordRenewal: jest.fn(),
    attachPolicyDocument: jest.fn(),
    setVehiclePhoto: jest.fn(),
    recordFinance: jest.fn(),
    attachFinanceDocument: jest.fn(),
    attachPurchaseDocument: jest.fn(),
    removeVehicle: jest.fn(),
    assignVehicle: jest.fn(),
    addLog: jest.fn(),
    editLog: jest.fn(),
    deleteLog: jest.fn(),
    resolveIssue: jest.fn(),
  };
}

function mount(over: Partial<Vehicle> = {}) {
  const f = fleet();
  const onClose = jest.fn();
  const onLog = jest.fn();
  const onEdit = jest.fn();
  const onServiceHistory = jest.fn();
  render(
    <VehicleModal
      vehicle={{ ...triton, ...over }}
      logs={logs}
      eco={{}}
      documents={[]}
      policies={[slip]}
      finance={[]}
      staff={[{ id: "s1", name: "Dane Poulos", status: "Active" }]}
      today={TODAY}
      fleet={f}
      onClose={onClose}
      onEdit={onEdit}
      onLog={onLog}
      onCorrect={jest.fn()}
      onServiceHistory={onServiceHistory}
    />,
  );
  return { f, onClose, onLog, onEdit, onServiceHistory, user: userEvent.setup() };
}

it("opens on the vehicle, warning about the one thing that is due", () => {
  mount();
  expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument();
  expect(screen.getByText("Rego expires in 3 weeks")).toBeInTheDocument();
  expect(screen.getByText("108,375 km")).toBeInTheDocument();
  expect(screen.getByText("QBE · 29 Sep 2027")).toBeInTheDocument(); // green slip, filed and clear
  expect(screen.getByText("Not set")).toBeInTheDocument(); // insurance, nothing recorded
  expect(screen.getByText("MMAWLKL10NH035826")).toBeInTheDocument();
  expect(screen.getByText("Fuel logged — 62 L, $118.40")).toBeInTheDocument();
});

it("moves to a renewal screen through the compliance list and back through the chevron", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: /GREEN SLIP/ }));
  expect(screen.getByRole("heading", { name: "Green slip (CTP)" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument();
});

it("the amber bar's Update rego is a door to the rego screen", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("button", { name: "Update rego" }));
  expect(screen.getByRole("heading", { name: "Registration" })).toBeInTheDocument();
});

it("Escape goes home from a sub-screen and closes from home", async () => {
  const { user, onClose } = mount();
  await user.click(screen.getByRole("button", { name: /INSURANCE/ }));
  await user.keyboard("{Escape}");
  expect(screen.getByRole("heading", { name: "WORK TRITON" })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalled();
});

it("offers For sale beside Sold, and a change reaches saveVehicle", async () => {
  const { user, f } = mount();
  const status = screen.getByRole("combobox", { name: "Status" });
  expect(Array.from((status as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
    "In service",
    "Off road",
    "For sale",
    "Sold",
  ]);
  await user.selectOptions(status, "for_sale");
  expect(f.saveVehicle).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", status: "for_sale" }));
});

it("writes an odometer reading typed on the card as an odo log — Enter commits, Escape doesn't", async () => {
  const { user, f } = mount();
  await user.click(screen.getByRole("button", { name: "Update" }));
  const input = screen.getByRole("textbox", { name: "Odometer reading" });
  await user.clear(input);
  await user.type(input, "109,2a00{Escape}");
  expect(f.addLog).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Update" }));
  await user.clear(screen.getByRole("textbox", { name: "Odometer reading" }));
  await user.type(screen.getByRole("textbox", { name: "Odometer reading" }), "109200{Enter}");
  expect(f.addLog).toHaveBeenCalledWith({ vehicleId: "v1", kind: "odo", odo: 109200 });
});

it("keeps logging on the card: the + on History offers the four kinds", async () => {
  const { user, onLog } = mount();
  await user.click(screen.getByRole("button", { name: "Log something" }));
  expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
    "Log fuel",
    "Update odometer",
    "Report an issue",
    "Log service",
  ]);
  await user.click(screen.getByRole("menuitem", { name: "Log fuel" }));
  expect(onLog).toHaveBeenCalledWith("fuel");
});

it("has no odometer, no fuel and a tow hitch for a trailer", async () => {
  const { user } = mount({ motorised: false, bodyType: "trailer" });
  expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
  expect(screen.getByText("TOWED BY")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Log something" }));
  expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Report an issue", "Log service"]);
  // the placeholder drawing follows the body type
  expect(screen.getByRole("button", { name: "Change photo" }).querySelector("img")).toHaveAttribute("src", "/fleet/trailer.svg");
});

it("filters history by tab and shows the full log on request", async () => {
  const { user } = mount();
  await user.click(screen.getByRole("tab", { name: "Issues" }));
  expect(screen.getByText("Issue reported — wiper blade")).toBeInTheDocument();
  expect(screen.queryByText(/Fuel logged/)).not.toBeInTheDocument();
  await user.click(screen.getByText("View full history"));
  expect(screen.getByRole("button", { name: "Resolve" })).toBeInTheDocument();
});

it("removes only on the second press, and Edit is a door", async () => {
  const { user, f, onEdit, onClose } = mount();
  await user.click(screen.getByRole("button", { name: "Remove vehicle" }));
  expect(f.removeVehicle).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm remove" }));
  expect(f.removeVehicle).toHaveBeenCalledWith("v1");
  expect(onClose).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit vehicle" }));
  expect(onEdit).toHaveBeenCalled();
});

it("assigning a driver reaches the action, and the pool is a real option", async () => {
  const { user, f } = mount();
  await user.selectOptions(screen.getByRole("combobox", { name: "Driver" }), "s1");
  expect(f.assignVehicle).toHaveBeenCalledWith("v1", "s1");
});

/* ---- phase 2: the money has its own screen ---- */

it("the FINANCIALS card is the door to the Financials screen, and Back returns", async () => {
  mount();
  const user = userEvent.setup();
  expect(screen.getByText("No finance agreement recorded")).toBeInTheDocument(); // the card's third column
  await user.click(screen.getByRole("button", { name: "Financials" }));
  expect(screen.getByRole("heading", { name: "Financials" })).toBeInTheDocument();
  expect(screen.getByText("COST TO RUN · LAST 12 MONTHS")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("VEHICLE DETAILS")).toBeInTheDocument();
});
