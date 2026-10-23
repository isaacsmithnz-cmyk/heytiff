import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FleetRegister } from "../register";
import type { FleetState } from "../fleet-state";
import type { Vehicle } from "../logic";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })),
}));
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readPurchaseInvoice: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readRenewalDocument: jest.fn(async () => ({ ok: false, reason: "no-key" })),
  readRegoCertificate: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
/* The register's vehicle form saves through the fleet action itself (rule 51). */
jest.mock("@/app/actions/fleet", () => ({ saveVehicle: jest.fn(), removeVehicle: jest.fn() }));

/* Renewals (issue #509, slice 2). The screens themselves are tested in
   vehicle-modal/__tests__; what stays here is the rule the register and the
   card share about WHICH paper is in force, and the path from a register row
   to a renewal screen — the one a component test wiring its own props can
   never notice breaking, which is exactly what once shipped. */

const TODAY = "2026-08-24";

const van: Vehicle = {
  id: "v1",
  name: "GOOD VAN",
  make: "Toyota",
  model: "Hiace",
  year: 2021,
  plate: "AAA111",
  plateState: "NSW",
  status: "active",
  odometer: 100000,
  regoDays: 200,
  insuranceDays: 200,
  ctpDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 95000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 30000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
};

/* ---- the real path: a register row to a renewal screen ---- */

function fleetWith(vehicles: Vehicle[]): FleetState {
  const noop = jest.fn();
  return {
    pending: false,
    error: null,
    clearError: noop,
    saveVehicle: noop,
    recordRenewal: noop,
    attachPolicyDocument: noop,
    setVehiclePhoto: noop,
    recordFinance: noop,
    attachFinanceDocument: noop,
    attachPurchaseDocument: noop,
    removeVehicle: noop,
    assignVehicle: noop,
    addLog: noop,
    attachLogDocument: noop,
    editLog: noop,
    deleteLog: noop,
    resolveIssue: noop,
    vehicles,
    logs: [],
    aiValues: {},
    documents: {},
    policies: {},
    finance: {},
  };
}

it("Update rego opens the registration screen from the real register, not just the empty state", async () => {
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  /* the card opens from a link (`?v=`); the register's row opens the vehicle's own page now */
  render(
    <FleetRegister fleet={fleetWith([{ ...van, regoDays: 20 }])} staff={[]} today={TODAY} warnDays={30} openLink={{ id: van.id, screen: null }} />,
  );
  const user = userEvent.setup();

  // the row's chip says the same words, so read the alert off the card itself
  const card = screen.getByRole("dialog");
  expect(within(card).getByText("Rego expires in 2 weeks")).toBeInTheDocument(); // 20 days, the way the pills say it
  await user.click(screen.getByRole("button", { name: "Update rego" }));
  expect(screen.getByRole("heading", { name: "Registration" })).toBeInTheDocument();
  // and the row-level door works too: back, then in through the compliance list
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: /Insurance/ }));
  expect(screen.getByRole("heading", { name: "Insurance" })).toBeInTheDocument();
});

it("a vehicle with nothing filed offers Add on every compliance row, and no warning", async () => {
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  render(
    <FleetRegister
      fleet={fleetWith([{ ...van, regoDays: null, insuranceDays: null, ctpDays: null }])}
      staff={[]}
      today={TODAY} warnDays={30}
      openLink={{ id: van.id, screen: null }}
    />,
  );
  expect(screen.getAllByText("Add")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Update rego" })).not.toBeInTheDocument();
});
