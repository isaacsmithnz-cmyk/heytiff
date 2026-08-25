import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RateCalculator } from "../rate-calculator";
import { buildBaselineState } from "./fixtures/baseline-org";

// The component lazy-imports the server-action module; mock it so jsdom never
// touches the auth0 runtime and so we can assert save behaviour.
jest.mock("@/app/actions/rate-calc", () => ({
  loadRateCalcState: jest.fn(),
  saveRateCalcState: jest.fn().mockResolvedValue(undefined),
  resetRateCalcState: jest.fn().mockResolvedValue(undefined),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveRateCalcState, resetRateCalcState } = require("@/app/actions/rate-calc") as {
  saveRateCalcState: jest.Mock;
  resetRateCalcState: jest.Mock;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  saveRateCalcState.mockClear();
  resetRateCalcState.mockClear();
  resetRateCalcState.mockResolvedValue(undefined);
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

describe("RateCalculator — staff come from the roster, wages are never written", () => {
  it("never persists the staff array, even when a roster is supplied", async () => {
    const user = userEvent.setup();
    const roster = [
      { id: "s1", name: "Ana", hourly_wage: 60, employment_type: "Full-time",
        contracted_hours_per_week: 38, install_pct: 60, service_pct: 30, admin_pct: 10 },
    ];
    render(<RateCalculator initialState={null} roster={roster} />);
    await dismissOnboarding(user);

    // make any edit to trigger a save
    const monthInput = screen.getAllByDisplayValue("0")[0];
    await user.click(monthInput);
    await user.keyboard("40000");

    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    // the persisted row carries NO staff — wages live on staff_profiles, and the
    // tool is forbidden from writing staff data back
    for (const call of saveRateCalcState.mock.calls) {
      expect(call[0].staff).toEqual([]);
    }
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
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
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

describe("RateCalculator — projected cost breakdown", () => {
  it("expands the projected true cost into its components", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    const month = screen.getAllByDisplayValue("0")[0];
    await user.click(month);
    await user.keyboard("40000");

    expect(screen.getByText("Projected yearly true cost")).toBeInTheDocument();
    expect(screen.queryByText("Gross wages")).toBeNull(); // collapsed by default

    await user.click(screen.getByText("Projected yearly true cost"));
    expect(screen.getByText("Gross wages")).toBeInTheDocument();
    expect(screen.getByText(/Superannuation/)).toBeInTheDocument();
    expect(screen.getByText(/Workers comp/)).toBeInTheDocument();
    expect(screen.getByText("Leave loading")).toBeInTheDocument();
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
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
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
    const baseline = buildBaselineState();
    // staff come from the roster now, not the saved state
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(baseline))} roster={baseline.staff} />);
    await user.click(screen.getByText("← Back to edit"));
    expect(screen.getByRole("button", { name: "Detailed" })).toBeInTheDocument(); // staff toggle
  });
});

describe("RateCalculator — Detailed business costs suggestions", () => {
  // Saved state with wages zeroed → lands on Step 1; Business toggle is ungated.
  function savedState() {
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.staff = []; saved.timesheets = {}; saved.vehicles = [];
    saved.simpleLabour.months = [0, 0, 0];
    return saved;
  }

  it("seeds the suggested categories when switching to Detailed with no costs", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.businessCosts = [];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("Continue →")); // → Business
    await user.click(screen.getByRole("button", { name: "Detailed" }));

    // The table arrives pre-filled with every suggested category at $0…
    expect(screen.getByDisplayValue("Public liability")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rent & utilities")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Training & PPE")).toBeInTheDocument();
    // …so no suggestion chips remain.
    expect(screen.queryByText("Suggested:")).toBeNull();
    // Seeded $0 rows are not an answer — the step stays incomplete.
    expect(screen.getByText("$0")).toBeInTheDocument();
  });

  it("fills an unpriced table already saved in Detailed, dropping the legacy placeholder", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.mode.business = "Detailed";
    saved.businessCosts = [{ name: "New cost", amount: 0, allocated_to: "shared" }];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("Continue →")); // → Business

    expect(screen.getByDisplayValue("Public liability")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Accounting fees")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("New cost")).toBeNull();
  });

  it("never re-seeds a table that carries real amounts", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.mode.business = "Detailed";
    saved.businessCosts = [{ name: "Yard lease", amount: 21000, allocated_to: "install" }];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("Continue →")); // → Business

    // The user's one priced row survives untouched; categories stay as chips.
    expect(screen.getByDisplayValue("Yard lease")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Public liability")).toBeNull();
    expect(screen.getByText("Suggested:")).toBeInTheDocument();
  });

  it("offers the missing categories as one-tap chips and keeps names editable", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.businessCosts = [{ name: "Public liability", amount: 5500, allocated_to: "shared" }];
    saved.mode.business = "Detailed";
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("Continue →")); // → Business

    // Already-present categories don't repeat as chips; tapping one adds its row.
    expect(screen.queryByRole("button", { name: "+ Public liability" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Rent & utilities" }));
    expect(screen.getByDisplayValue("Rent & utilities")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Rent & utilities" })).toBeNull();

    // The cost name is a real input, not static text.
    const name = screen.getByDisplayValue("Public liability");
    await user.clear(name);
    await user.type(name, "PI insurance");
    expect(screen.getByDisplayValue("PI insurance")).toBeInTheDocument();
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
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
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

    const install = screen.getByLabelText("Current install rate"); // inside the Install rate card
    expect(install).toHaveValue(""); // no value yet
    await user.type(install, "120");
    expect(install).toHaveValue("120");

    // …and it autosaves.
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    expect(saveRateCalcState.mock.calls.at(-1)![0].currentRates.install).toBe(120);
  });

  it("shows an amber gap chip when current rates sit below recommended", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    await user.click(screen.getByText("← Back to edit")); // Results → a step page (rail visible)
    // Demo charges 118/105 vs recommended ~132/143 → "↑ $N/hr" on both cards.
    expect(screen.getByLabelText("Current install rate")).toHaveValue("118");
    expect(screen.getAllByText(/↑ \$\d+\/hr/).length).toBeGreaterThan(0);
  });

  it("shows a healthy chip when current rates already beat the recommendation", async () => {
    const user = userEvent.setup();
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.currentRates = { install: 300, service: 300 };
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByText("← Back to edit"));
    // 300 charged vs recommended ~132/143 → "✓ $N above" on both cards.
    expect(screen.getAllByText(/✓ \$\d+ above/).length).toBeGreaterThan(0);
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

describe("RateCalculator — retired example data", () => {
  it("offers no example-data escape hatch on an empty setup", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // The not-ready callout used to carry "explore with example data".
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();
    expect(screen.queryByText(/example data/i)).toBeNull();
    expect(screen.queryByText(/Blue Sky/i)).toBeNull();
  });

  it("discards a stale crash buffer still holding the retired example org", () => {
    // A buffer is normally restored and pushed to the server; one carrying the
    // old demo org must be dropped instead, or it writes Blue Sky onto a clean
    // org the moment the calculator opens.
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: { ...buildBaselineState(), businessName: "Blue Sky Air Conditioning" },
      savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={null} />);

    // Treated as a first run, not a returning user
    expect(screen.getByText("How to use this tool")).toBeInTheDocument();
    expect(screen.queryByText(/Blue Sky Air Conditioning/)).toBeNull();
    // …and the poisoned buffer is gone, so nothing can write it back
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).toBeNull();
    expect(saveRateCalcState).not.toHaveBeenCalled();
  });

  /* The other half of the rule above, and the one nothing was holding: a
     HEALTHY buffer on an org that has never saved is a previous session's
     edits that never reached the server. It opens as those edits — not as a
     first run — and it is pushed up straight away rather than waiting for
     somebody to type. Deliberately the test after the retired one, so a
     buffer read that leaked from it would show up here as onboarding. */
  it("restores a healthy crash buffer and pushes it to the server", async () => {
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: buildBaselineState(),
      savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={null} />);

    // A returning user, not a first run — no onboarding chain
    expect(screen.queryByText("How to use this tool")).toBeNull();
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();

    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe("RateCalculator — returning user with saved state", () => {
  it("lands on Results when the saved setup is complete", () => {
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    // No onboarding for returning users
    expect(screen.queryByText("How to use this tool")).toBeNull();
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });
});

describe("RateCalculator — start fresh", () => {
  // The reset lives behind the settings gear; arming it takes two presses.
  async function startFresh(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTitle("Settings"));
    await user.click(screen.getByText("Start fresh", { selector: "button" }));
    await user.click(screen.getByText("Yes, clear everything"));
  }

  it("clears the saved setup and drops the returning user back to a first run", async () => {
    const user = userEvent.setup();
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: buildBaselineState(), savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);

    // A returning user with a complete setup lands on Results
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();

    await startFresh(user);

    // Server row deleted, crash buffer gone, onboarding back
    await waitFor(() => expect(resetRateCalcState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("How to use this tool")).toBeInTheDocument());
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).toBeNull();
    expect(screen.queryByText("Your recommended rates")).toBeNull();

    // …and the wiped figures do not come back through the setup rail
    await user.click(screen.getByText("Got it — start →"));
    await user.click(screen.getByText("I don't know yet — skip"));
    expect(screen.getByText(/Almost there/)).toBeInTheDocument();
  });

  it("does not clear anything until the second press", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);

    await user.click(screen.getByTitle("Settings"));
    await user.click(screen.getByText("Start fresh", { selector: "button" }));
    await user.click(screen.getByText("Keep my setup"));

    expect(resetRateCalcState).not.toHaveBeenCalled();
    await user.click(screen.getByText("Cancel"));
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });

  it("keeps the setup and says so when the clear fails", async () => {
    const user = userEvent.setup();
    resetRateCalcState.mockRejectedValue(new Error("network"));
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: buildBaselineState(), savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);

    await startFresh(user);

    await waitFor(() => expect(screen.getByText(/Couldn't clear your setup/)).toBeInTheDocument());
    // Nothing local was thrown away on a failed delete
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).not.toBeNull();
    await user.click(screen.getByText("Cancel"));
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });
});
