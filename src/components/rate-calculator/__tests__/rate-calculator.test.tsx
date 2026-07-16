import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RateCalculator } from "../rate-calculator";
import { buildDemoState } from "../demo-data";

// The component lazy-imports the server-action module; mock it so jsdom never
// touches the auth0 runtime and so we can assert save behaviour.
jest.mock("@/app/actions/rate-calc", () => ({
  loadRateCalcState: jest.fn(),
  saveRateCalcState: jest.fn().mockResolvedValue(undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveRateCalcState } = require("@/app/actions/rate-calc") as {
  saveRateCalcState: jest.Mock;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveRateCalcState.mockClear();
});

async function dismissOnboarding(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Got it — start →"));
  await user.click(screen.getByText("I don't know yet — skip"));
}

describe("RateCalculator — first run (no saved state)", () => {
  it("shows the onboarding chain, then step 1 with the rates rail awaiting inputs", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);

    // Help modal first
    expect(screen.getByText("How to use this tool")).toBeInTheDocument();
    await user.click(screen.getByText("Got it — start →"));

    // Then the current-rates intro
    expect(screen.getByText("What do you charge right now?")).toBeInTheDocument();
    await user.click(screen.getByText("I don't know yet — skip"));

    // Step 1, not ready
    expect(screen.getByText(/Step 1 of 5 · Simple/)).toBeInTheDocument();
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();
    expect(screen.getByText(/at least one month of wages/)).toBeInTheDocument();

    // Skipping the intro wrote the baseline state — let the debounced save settle
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("produces a live rate once wages are entered, and autosaves", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // Enter one month of wages (first month NumInput shows "0")
    const monthInput = screen.getAllByDisplayValue("0")[0];
    await user.click(monthInput);
    await user.keyboard("40000");

    // Rail flips to live rates — break-even tiles show real dollar figures
    expect(screen.queryByText(/Almost there/)).toBeNull();
    expect(screen.getByText("updates as you edit")).toBeInTheDocument();

    // Autosave: crash buffer written synchronously, server save after debounce
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).toContain("40000");
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    const saved = saveRateCalcState.mock.calls.at(-1)![0];
    expect(saved.simpleLabour.months[0]).toBe(40000);
  });
});

describe("RateCalculator — question-at-a-time steps", () => {
  it("shows the full stepper rail, but stages the questions within the step", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // The rail shows every step from the start again…
    expect(screen.getByText(/Step 1 of 5 · Simple/)).toBeInTheDocument();
    expect(screen.getByText("Business costs")).toBeInTheDocument();
    expect(screen.getByText("Vehicles")).toBeInTheDocument();
    expect(screen.getByText("HVAC risk")).toBeInTheDocument();
    expect(screen.getByText("Profit target")).toBeInTheDocument();

    // …but the page shows only the first question.
    expect(screen.getByText("What did you pay in wages over the last 3 months?")).toBeInTheDocument();
    expect(screen.queryByText("How many staff in total?")).toBeNull();

    // Next is disabled until the question is answered.
    const next = screen.getByText("Next →").closest("button")!;
    expect(next).toBeDisabled();

    const monthInput = screen.getAllByDisplayValue("0")[0];
    await user.click(monthInput);
    await user.keyboard("40000");
    expect(next).toBeEnabled();

    // Clicking Next reveals Q2 — and only Q2 — with Q1 still on screen.
    await user.click(next);
    expect(screen.getByText("How many staff in total?")).toBeInTheDocument();
    expect(screen.getByText("What did you pay in wages over the last 3 months?")).toBeInTheDocument();
    expect(screen.queryByText("Split that time across the work")).toBeNull();
  });

  it("skips staging for returning users — a saved setup shows whole pages", async () => {
    const user = userEvent.setup();
    const saved = JSON.parse(JSON.stringify(buildDemoState()));
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("← Back to edit"));
    // All staff questions visible at once (revealAll).
    expect(screen.getByText("What did you pay in wages over the last 3 months?")).toBeInTheDocument();
    expect(screen.getByText("How many staff in total?")).toBeInTheDocument();
    expect(screen.getByText("Split that time across the work")).toBeInTheDocument();
    expect(screen.getByText("Billable time assumption")).toBeInTheDocument();
  });
});

describe("RateCalculator — work split locked at 100%", () => {
  it("makes Admin the auto remainder and clamps the editable shares", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // wages → staff count → split
    const month = screen.getAllByDisplayValue("0")[0];
    await user.click(month);
    await user.keyboard("40000");
    await user.click(screen.getByText("Next →")); // → staff count
    await user.click(screen.getByText("Next →")); // → split
    expect(screen.getByText("Split that time across the work")).toBeInTheDocument();

    const install = screen.getByLabelText("Install percent");
    const service = screen.getByLabelText("Service percent");
    expect(install).toHaveValue("60");
    expect(service).toHaveValue("30");
    // Admin is not an editable field — it's the remainder.
    expect(screen.queryByLabelText("Admin percent")).toBeNull();

    // Service is 30, so Install can never exceed 70 — typing 90 snaps to 70.
    await user.clear(install);
    await user.type(install, "90");
    expect(install).toHaveValue("70");
    expect(service).toHaveValue("30"); // unchanged — Admin absorbs the difference (now 0)
  });
});

describe("RateCalculator — Vehicles yes/no question", () => {
  async function goToVehicles(user: ReturnType<typeof userEvent.setup>) {
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    await user.click(screen.getByText("Continue →")); // → Business
    await user.click(screen.getByText("Continue →")); // → Vehicles
    expect(screen.getByText(/Step 3 of 5 · Simple/)).toBeInTheDocument();
    expect(screen.getByText("Do you run vehicles for the business?")).toBeInTheDocument();
  }

  it("choosing No confirms the no-fleet state (with undo)", async () => {
    const user = userEvent.setup();
    await goToVehicles(user);

    await user.click(screen.getByText("No vehicles"));
    expect(screen.getByText("I do have vehicles")).toBeInTheDocument();
    expect(screen.getByText(/no vehicle recovery/)).toBeInTheDocument();
    // No fleet-costs question when there is no fleet.
    expect(screen.queryByText(/What did the fleet cost to run/)).toBeNull();
  });

  it("choosing Yes reveals the fleet-costs question", async () => {
    const user = userEvent.setup();
    await goToVehicles(user);

    await user.click(screen.getByText("Yes — we run vehicles"));
    expect(screen.getByText("What did the fleet cost to run over the last 3 months?")).toBeInTheDocument();
  });
});

describe("RateCalculator — Simple/Detailed toggle gating", () => {
  it("hides all toggles on the first run", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    expect(screen.queryByRole("button", { name: "Detailed" })).toBeNull();
    await user.click(screen.getByText("Continue →")); // → Business
    expect(screen.queryByRole("button", { name: "Detailed" })).toBeNull();
  });

  it("on later visits shows Business always, Staff/Vehicles only with data", async () => {
    const user = userEvent.setup();
    // Saved state with wages zeroed → not ready → lands on Step 1; no
    // timesheets and no vehicle records, so only Business gets its toggle.
    const saved = JSON.parse(JSON.stringify(buildDemoState()));
    saved.staff = []; saved.timesheets = {}; saved.vehicles = [];
    saved.simpleLabour.months = [0, 0, 0];
    render(<RateCalculator initialState={saved} />);

    expect(screen.getByText(/Step 1 of 5 · Simple/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detailed" })).toBeNull(); // staff gate: needs 12+ weeks of timesheets
    await user.click(screen.getByText("Continue →")); // → Business
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument(); // ungated
    await user.click(screen.getByText("Continue →")); // → Vehicles
    expect(screen.queryByRole("button", { name: "Detailed" })).toBeNull(); // vehicles gate: needs vehicle records
  });

  it("demo passes every gate (18 weeks of timesheets + a fleet)", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildDemoState()))} />);
    await user.click(screen.getByText("← Back to edit"));
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument(); // staff toggle
  });
});

describe("RateCalculator — results gated behind all five steps", () => {
  it("hides View results / Insights until every step is done, then unlocks", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // Gated: buttons hidden, hint shown.
    expect(screen.queryByText(/View results/)).toBeNull();
    expect(screen.queryByText("Insights")).toBeNull();
    expect(screen.getByText(/Complete all 5 steps/)).toBeInTheDocument();

    // Step 1 — wages, then Next through the stack.
    const month = screen.getAllByDisplayValue("0")[0];
    await user.click(month);
    await user.keyboard("40000");
    await user.click(screen.getByText("Next →"));
    await user.click(screen.getByText("Next →"));
    await user.click(screen.getByText("Next →"));
    await user.click(screen.getByText("Continue →")); // → Business

    // Step 2 — overheads.
    const biz = screen.getAllByDisplayValue("0")[0];
    await user.click(biz);
    await user.keyboard("4000");
    await user.click(screen.getByText("Continue →")); // → Vehicles

    // Step 3 — no vehicles.
    await user.click(screen.getByText("No vehicles"));
    await user.click(screen.getByText("Continue →")); // → Risk

    // Step 4 — accepting the defaults is the Continue click itself.
    expect(screen.queryByText(/View results/)).toBeNull(); // risk not yet accepted
    await user.click(screen.getByText("Continue →")); // accepts risk → Profit

    // Step 5 — everything else done, so the button reads See results.
    await user.click(screen.getByText("See results →")); // accepts profit → Results

    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
    expect(screen.getByText(/View results/)).toBeInTheDocument(); // unlocked
  });

  it("the final Continue redirects to the first incomplete step instead of Results", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // Complete staff only; skip business & vehicles.
    const month = screen.getAllByDisplayValue("0")[0];
    await user.click(month);
    await user.keyboard("40000");
    await user.click(screen.getByText("Continue →")); // → Business (skipped)
    await user.click(screen.getByText("Continue →")); // → Vehicles (skipped)
    await user.click(screen.getByText("Continue →")); // → Risk
    await user.click(screen.getByText("Continue →")); // accepts risk → Profit

    // Business is still incomplete, so no See-results label and the click
    // walks back to Step 2 rather than into Results.
    await user.click(screen.getByText("Continue →"));
    expect(screen.getByText(/Step 2 of 5 · Simple/)).toBeInTheDocument();
    expect(screen.queryByText("Your recommended rates")).toBeNull();
  });
});

describe("RateCalculator — healthy-rate safeguard on Results", () => {
  it("never offers Apply when current rates already beat the recommendation", () => {
    const saved = JSON.parse(JSON.stringify(buildDemoState()));
    saved.currentRates = { install: 200, service: 200 }; // ≥ recommended ⇒ uplift 0
    render(<RateCalculator initialState={saved} />);

    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
    expect(screen.getByText("Charging a healthy rate")).toBeInTheDocument();
    expect(screen.getByText("You're priced right")).toBeInTheDocument();
    expect(screen.getByText(/no increase needed/)).toBeInTheDocument();
    expect(screen.queryByText("Apply these rates →")).toBeNull();
  });
});

describe("RateCalculator — current rates are editable outside onboarding", () => {
  it("sets current rates from the live-rates rail and persists them", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user); // skips the intro → current rates start empty

    const install = screen.getByLabelText("Current install rate");
    expect(install).toHaveValue(""); // no value yet
    await user.type(install, "120");

    // The Install tile's vs-now line reflects it immediately.
    expect(screen.getByText(/vs now \$120/)).toBeInTheDocument();

    // …and it autosaves.
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    expect(saveRateCalcState.mock.calls.at(-1)![0].currentRates.install).toBe(120);
  });

  it("also exposes current rates in Settings (matching the Results hint)", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    await user.click(screen.getByTitle("Settings"));
    expect(screen.getByLabelText("Settings install rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings service rate")).toBeInTheDocument();
  });
});

describe("RateCalculator — example data mode", () => {
  it("loads Blue Sky, never saves, and exits back to own data", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // The onboarding skip already queued one save of the empty baseline —
    // let it settle, then require that demo interactions add none.
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    const callsBeforeDemo = saveRateCalcState.mock.calls.length;

    await user.click(screen.getByText("Or explore with example data →"));

    // Demo is a "returning user" — lands on results with Blue Sky everywhere
    expect(screen.getAllByText(/Blue Sky Air Conditioning/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nothing here is saved/)).toBeInTheDocument();

    // Interacting with demo data never calls the save action
    await user.click(screen.getByText("← Back to edit"));
    const monthInput = screen.getAllByDisplayValue("38,200")[0];
    await user.click(monthInput);
    await user.keyboard("1");
    await new Promise(r => setTimeout(r, 800));
    expect(saveRateCalcState.mock.calls.length).toBe(callsBeforeDemo);

    // Exit restores the (empty) real setup
    await user.click(screen.getByText("Exit example"));
    expect(screen.queryByText(/Blue Sky Air Conditioning/)).toBeNull();
  });
});

describe("RateCalculator — returning user with saved state", () => {
  it("lands on Results when the saved setup is complete", () => {
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildDemoState()))} />);
    // No onboarding for returning users
    expect(screen.queryByText("How to use this tool")).toBeNull();
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });
});
