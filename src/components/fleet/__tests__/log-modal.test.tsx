import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogModal } from "../modals";
import type { NewLog, Vehicle } from "../logic";
import { NoteScopeProvider } from "@/components/notes/note-context";

// the receipt reader is a server action — never call it from a component test
jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: jest.fn(async () => ({ ok: false, reason: "no-key" })),
}));
// storing the docket reaches a server action too — same rule, and mocking it
// keeps auth0's ESM out of the module graph
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async () => ({ ok: false, error: "not in a test" })),
}));

/** The engine, with its transcript handed over by the test. */
const heard: { say?: (words: string) => void } = {};
jest.mock("@/components/notes/dictation", () => {
  const actual = jest.requireActual("@/components/notes/dictation");
  return {
    ...actual,
    useDictation: (opts: { onTranscript: (w: string) => void }) => {
      const react = jest.requireActual("react") as typeof import("react");
      heard.say = opts.onTranscript;
      return { recording: false, arming: false, transcribing: false, interim: "", seconds: 0, barsRef: react.createRef(), start: jest.fn(), stop: jest.fn(), handOver: jest.fn(), cancel: jest.fn(), restart: jest.fn() };
    },
  };
});

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
  lastServiceDays: null,
  regoDays: 200,
  insuranceDays: 200,
  ctpDays: 200,
  serviceIntervalKm: 10000,
  lastServiceOdo: 80000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
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
      today="2026-08-04"
      vehicle={mine}
      fleetVehicles={opts.withFleet ? fleetVehicles : undefined}
      onSave={onSave}
      onClose={jest.fn()}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

/* The vehicle is a chooser now (rule 34), its options the plate and the name. */
const picker = () => screen.getByRole("combobox", { name: "Vehicle" });
async function pick(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(picker());
  await user.click(screen.getByRole("option", { name: label }));
}

describe("LogModal rego picker", () => {
  it("lists working vehicles by rego, own vehicle first, and excludes sold", async () => {
    const { user } = setup();
    expect(picker()).toHaveTextContent("MKT482, VRF-04"); // defaults to the driver's own vehicle
    await user.click(picker());
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["MKT482, VRF-04", "LRT906, UTE-01"]);
    expect(labels.join()).not.toContain("JTB114"); // sold vehicle is not loggable
  });

  it("follows the pick in the field", async () => {
    const { user } = setup();
    await pick(user, "LRT906, UTE-01");
    expect(picker()).toHaveTextContent("LRT906, UTE-01");
  });

  it("is hidden when no fleet is passed (single-vehicle context), and the vehicle is still named", () => {
    setup("odo", { withFleet: false });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("VRF-04, Toyota Hiace ZR 2022")).toBeInTheDocument();
  });

  it("saves the log against the borrowed vehicle once picked", async () => {
    const { onSave, user } = setup();
    await pick(user, "LRT906, UTE-01");
    await user.type(screen.getByPlaceholderText(/^Now/), "158500");
    await user.click(screen.getByRole("button", { name: /Update odometer/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const log = onSave.mock.calls[0][0] as NewLog;
    expect(log.vehicleId).toBe("ute-01"); // not the driver's own vrf-04
    expect(log.odo).toBe(158500);
    // attribution is the server's — a client that could name the author could name anyone
    expect(log).not.toHaveProperty("staffId");
    expect(log).not.toHaveProperty("staffName");
  });

  it("moves the odometer guardrail to the selected vehicle", async () => {
    const { user } = setup();
    // 90,000 is above VRF-04's 84,120 — no warning while it's selected
    await user.type(screen.getByPlaceholderText(/^Now/), "90000");
    expect(screen.queryByText(/Lower than the current/)).not.toBeInTheDocument();

    // the same reading is below UTE-01's 158,300 — the warning follows the switch
    await pick(user, "LRT906, UTE-01");
    expect(screen.getByText(/Lower than the current 158,300 km/)).toBeInTheDocument();
  });

  it("offers the picker on the fuel scan step, before any receipt is read", () => {
    setup("fuel");
    expect(picker()).toBeInTheDocument();
    expect(screen.getByText("Snap or upload the receipt")).toBeInTheDocument();
  });
});

/* 7 November 2026 (Isaac: "Fix all of those"): what's wrong takes the voice
   where the workspace has it */
describe("LogModal, an issue said", () => {
  const draw = (voiceEnabled: boolean) => {
    const onSave = jest.fn();
    render(
      <NoteScopeProvider voiceEnabled={voiceEnabled}>
        <LogModal kind="issue" today="2026-08-04" vehicle={mine} onSave={onSave} onClose={jest.fn()} />
      </NoteScopeProvider>,
    );
    return { onSave, user: userEvent.setup() };
  };

  it("has the microphone where voice is on, and what is said is the issue logged", async () => {
    const { onSave, user } = draw(true);
    expect(screen.getByRole("button", { name: "Dictate — what's wrong" })).toBeInTheDocument();
    act(() => heard.say!("Sliding door latch sticking"));
    expect(screen.getByLabelText("What's wrong")).toHaveValue("Sliding door latch sticking");
    await user.click(screen.getByRole("button", { name: /Report an issue/ }));
    expect((onSave.mock.calls[0][0] as NewLog)).toMatchObject({ kind: "issue", note: "Sliding door latch sticking" });
  });

  it("has none where voice is off", () => {
    draw(false);
    expect(screen.queryByRole("button", { name: /^Dictate/ })).toBeNull();
    expect(screen.getByLabelText("What's wrong")).toHaveAttribute("placeholder", "Sliding door latch sticking");
  });
});
