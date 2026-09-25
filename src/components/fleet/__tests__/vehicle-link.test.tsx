import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetsScreen, type Register } from "../assets-screen";
import type { Vehicle } from "../logic";
import type { VehicleLink } from "../vehicle-modal/derive";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
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
jest.mock("@/app/actions/fleet", () => ({}));

/* THE WAY IN TO ONE VEHICLE: `?v=<id>`, and `?screen=` for the card's own
   renewal or service screen. The staff card's plate was the first caller;
   the bell's fleet rows, Home's Renew and the calendar are the rest.

   What these pin is the part a person cannot see go wrong until it does:
   a link followed while Assets is ALREADY open. The outlet is keyed on the
   pathname, so that link changes only the query, the register is never
   remounted, and a card seeded once at mount simply never opened. The page
   hands a fresh object per naming (the Workboard's `?job=` contract), and
   the screen takes it by identity. */

const TODAY = "2026-09-25";

const van = (id: string, name: string): Vehicle => ({
  id,
  name,
  make: "Toyota",
  model: "Hiace",
  year: 2021,
  plate: id.toUpperCase(),
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
});

const register: Register = {
  vehicles: [van("v1", "GOOD VAN"), van("v2", "SPARE UTE")],
  logs: [],
  aiValues: {},
  staff: [],
  documents: {},
  policies: {},
  finance: {},
};

const link = (id: string, screen: VehicleLink["screen"] = null): VehicleLink => ({ id, screen });

const assets = (openVehicle: VehicleLink | null) => (
  <AssetsScreen
    own={{ vehicle: null, pickable: [], logs: [] }}
    register={register}
    today={TODAY}
    warnDays={30}
    viewerStaffId={null}
    openVehicle={openVehicle}
  />
);

const card = () => screen.queryByRole("dialog");
const heading = (name: string) => screen.queryByRole("heading", { name });

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  window.history.replaceState(null, "", "/");
});

describe("a vehicle named in the URL", () => {
  it("opens that vehicle's card on its main screen", () => {
    render(assets(link("v2")));
    expect(card()).toHaveAccessibleName("SPARE UTE");
    expect(heading("Registration")).toBeNull();
  });

  it("opens the renewal screen it names, with the card one Back away", async () => {
    render(assets(link("v1", "rego")));
    expect(heading("Registration")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(heading("Registration")).toBeNull();
    expect(card()).toHaveAccessibleName("GOOD VAN");
  });

  it("opens logging a service when it names that", () => {
    render(assets(link("v1", "add:service")));
    expect(heading("Log service")).toBeInTheDocument();
  });

  it("opens nothing for a vehicle the fleet doesn't hold", () => {
    render(assets(link("gone", "rego")));
    expect(card()).toBeNull();
  });
});

describe("a vehicle named while Assets is already open", () => {
  it("opens it, on the screen it names (the bell, opened over the register)", () => {
    const { rerender } = render(assets(null));
    expect(card()).toBeNull();
    rerender(assets(link("v2", "insurance")));
    expect(card()).toHaveAccessibleName("SPARE UTE");
    expect(heading("Insurance")).toBeInTheDocument();
  });

  /* The card's screen is its own state from the moment it opens, so a link
     to the card already open has to open it again, not just re-point it. */
  it("moves a card that is already open to the screen the link names", () => {
    const { rerender } = render(assets(link("v1")));
    expect(heading("Registration")).toBeNull();
    rerender(assets(link("v1", "rego")));
    expect(heading("Registration")).toBeInTheDocument();
  });

  it("opens once per naming, not once per render", async () => {
    const named = link("v1");
    const { rerender } = render(assets(named));
    await userEvent.keyboard("{Escape}");
    expect(card()).toBeNull();

    // the same naming, rendered again, is not a second naming
    rerender(assets(named));
    expect(card()).toBeNull();
    // nor is the page rendering after the link has left the address
    rerender(assets(null));
    expect(card()).toBeNull();

    // naming it again is
    rerender(assets({ ...named }));
    expect(card()).toHaveAccessibleName("GOOD VAN");
  });

  it("lands on Fleet from Equipment", async () => {
    const { rerender } = render(assets(null));
    await userEvent.click(screen.getByRole("tab", { name: /^Equipment/ }));
    expect(screen.getByText("No equipment registered")).toBeInTheDocument();

    rerender(assets(link("v2")));
    expect(screen.getByRole("tab", { name: /^Fleet/ })).toHaveAttribute("aria-selected", "true");
    expect(card()).toHaveAccessibleName("SPARE UTE");
  });

  /* The register unmounts on Equipment and mounts again on Fleet. A link
     still held then seeded the card open a second time, after it had been
     closed: moving the strip yourself is the moment you are done with it. */
  it("drops the link when you move the strip, so a closed card stays closed", async () => {
    render(assets(link("v1")));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("tab", { name: /^Equipment/ }));
    await userEvent.click(screen.getByRole("tab", { name: /^Fleet/ }));
    expect(screen.getByText("SPARE UTE")).toBeInTheDocument();
    expect(card()).toBeNull();
  });
});

describe("the address", () => {
  /* Left there, a save on the card revalidates the page, the page names the
     vehicle again, and the card springs back under whoever is working in it. */
  it("loses the link once it has landed, and nothing else", () => {
    window.history.replaceState(null, "", "/dashboard/assets?v=v1&screen=rego&keep=1");
    render(assets(link("v1", "rego")));
    expect(window.location.pathname).toBe("/dashboard/assets");
    expect(window.location.search).toBe("?keep=1");
  });

  it("is left alone when no vehicle was named", () => {
    window.history.replaceState(null, "", "/dashboard/assets?v=gone");
    render(assets(null));
    expect(window.location.search).toBe("?v=gone");
  });
});

describe("the register's own doors still work beside a link", () => {
  it("opens another vehicle from its row after a link's card is closed", async () => {
    render(assets(link("v1")));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByText("SPARE UTE"));
    expect(within(card()!).getAllByText("SPARE UTE").length).toBeGreaterThan(0);
    expect(card()).toHaveAccessibleName("SPARE UTE");
  });
});
