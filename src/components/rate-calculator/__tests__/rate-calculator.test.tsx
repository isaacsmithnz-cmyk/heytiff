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

const HELP = "How to use the rate calculator";

async function dismissOnboarding(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Start" }));
  await user.click(screen.getByRole("button", { name: "I don't know yet" }));
}

/** This month's wages: the first "This month" on the page. */
async function enterWages(user: ReturnType<typeof userEvent.setup>, figure = "40000") {
  await user.click(screen.getAllByLabelText("This month")[0]);
  await user.keyboard(figure);
}

const footer = (n: number) => new RegExp(`^Step ${n} of 5`);

describe("RateCalculator — first run (no saved state)", () => {
  it("shows the onboarding chain, then step 1 with Your rates waiting on the wages", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);

    // How to use first
    expect(screen.getByText(HELP)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));

    // Then what you charge now
    expect(screen.getByText("What do you charge right now?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I don't know yet" }));

    // Step 1, not ready: Your rates says what's missing (rule 40)
    expect(screen.getByText(footer(1))).toBeInTheDocument();
    expect(screen.getByText(/To see your rates, enter at least one month of wages/)).toBeInTheDocument();

    // Skipping the intro wrote the baseline state — let the debounced save settle
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
  });

  it("produces a live rate once wages are entered, and autosaves", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    await enterWages(user);

    // Your rates flips to live figures
    expect(screen.queryByText(/To see your rates/)).toBeNull();
    expect(screen.getAllByText(/with GST/).length).toBeGreaterThan(0);

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
    await enterWages(user); // any edit, to trigger a save

    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    // the persisted row carries NO staff — wages live on staff_profiles, and the
    // calculator is forbidden from writing staff data back
    for (const call of saveRateCalcState.mock.calls) {
      expect(call[0].staff).toEqual([]);
    }
  });
});

describe("RateCalculator — a step is one page", () => {
  it("shows every step in the path and every question of the step at once", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    const path = screen.getByRole("navigation", { name: "Rate calculator" });
    for (const step of ["Staff and wages", "Business costs", "Vehicles", "HVAC risk", "Profit target"]) {
      expect(path).toHaveTextContent(step);
    }
    expect(screen.getByText("What did you pay in wages over the last 3 months?")).toBeInTheDocument();
    expect(screen.getByText("How many staff in total?")).toBeInTheDocument();
    expect(screen.getByText("Split that time across the work")).toBeInTheDocument();
    expect(screen.getByText("Billable time")).toBeInTheDocument();
  });

  it("marks the step you're on, never with a filled disc", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    const current = screen.getByRole("button", { current: "step" });
    expect(current).toHaveTextContent("Staff and wages");
  });
});

describe("RateCalculator — work split locked at 100%", () => {
  it("makes Admin the auto remainder and clamps the typed shares", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    const install = screen.getByLabelText("Install percent");
    const service = screen.getByLabelText("Service percent");
    expect(install).toHaveValue("60");
    expect(service).toHaveValue("30");
    // Admin is not a field — it's the remainder.
    expect(screen.queryByLabelText("Admin percent")).toBeNull();

    // Service is 30, so Install can never pass 70 — typing 90 keeps 70.
    await user.clear(install);
    await user.type(install, "90");
    expect(install).toHaveValue("70");
    expect(service).toHaveValue("30"); // unchanged — Admin absorbs the difference (now 0)
  });

  it("holds a figure under its floor until the typing is done", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // Billable time's floor is 40: the "5" of "55" is not refused on the way.
    const billable = screen.getByLabelText("Billable time");
    await user.clear(billable);
    await user.type(billable, "55");
    expect(billable).toHaveValue("55");
  });
});

describe("RateCalculator — the true cost of the wages", () => {
  it("shows the projected year and its parts once wages are in", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    expect(screen.queryByText("Gross wages")).toBeNull();

    await enterWages(user);
    expect(screen.getByText("Gross wages")).toBeInTheDocument();
    expect(screen.getByText(/^Super, /)).toBeInTheDocument();
    expect(screen.getByText(/^Workers comp, /)).toBeInTheDocument();
    expect(screen.getByText("Leave loading")).toBeInTheDocument();
    expect(screen.getByText("True cost a year")).toBeInTheDocument();
  });
});

describe("RateCalculator — Vehicles yes or no", () => {
  async function goToVehicles(user: ReturnType<typeof userEvent.setup>) {
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Vehicles
    expect(screen.getByText(footer(3))).toBeInTheDocument();
    expect(screen.getByText("Do you run vehicles for the business?")).toBeInTheDocument();
  }

  it("No says the rates carry no vehicle cost, and asks nothing more", async () => {
    const user = userEvent.setup();
    await goToVehicles(user);

    await user.click(screen.getByRole("radio", { name: "No vehicles" }));
    expect(screen.getByText(/no vehicle cost/)).toBeInTheDocument();
    expect(screen.queryByText(/What did the fleet cost to run/)).toBeNull();

    // and Yes takes it back
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.queryByText(/no vehicle cost/)).toBeNull();
  });

  it("Yes asks for the fleet's running cost", async () => {
    const user = userEvent.setup();
    await goToVehicles(user);

    await user.click(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.getByText("What did the fleet cost to run over the last 3 months?")).toBeInTheDocument();
  });
});

describe("RateCalculator — Simple or Detailed, only where it can be used", () => {
  it("hides the choice on the first run", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    expect(screen.queryByRole("radio", { name: "Detailed" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business
    expect(screen.queryByRole("radio", { name: "Detailed" })).toBeNull();
  });

  it("on later visits shows Business always, Staff and Vehicles only with data", async () => {
    const user = userEvent.setup();
    // Saved state with wages zeroed → not ready → lands on Step 1; no
    // timesheets and no vehicle records, so only Business gets the choice.
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.staff = []; saved.timesheets = {}; saved.vehicles = [];
    saved.simpleLabour.months = [0, 0, 0];
    render(<RateCalculator initialState={saved} />);

    expect(screen.getByText(footer(1))).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Detailed" })).toBeNull(); // staff: needs 12+ weeks of timesheets
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business
    expect(screen.getByRole("radio", { name: "Detailed" })).toBeInTheDocument(); // ungated
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Vehicles
    expect(screen.queryByRole("radio", { name: "Detailed" })).toBeNull(); // vehicles: needs vehicle records
  });

  it("a full setup passes every gate (18 weeks of timesheets and a fleet)", async () => {
    const user = userEvent.setup();
    const baseline = buildBaselineState();
    // staff come from the roster now, not the saved state
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(baseline))} roster={baseline.staff} />);
    await user.click(screen.getByRole("button", { name: "Back to the steps" }));
    expect(screen.getByRole("radio", { name: "Detailed" })).toBeInTheDocument(); // staff
  });
});

describe("RateCalculator — Detailed business costs", () => {
  // Saved state with wages zeroed → lands on Step 1; Business is ungated.
  function savedState() {
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.staff = []; saved.timesheets = {}; saved.vehicles = [];
    saved.simpleLabour.months = [0, 0, 0];
    return saved;
  }

  it("fills an empty table with the suggested costs on switching to Detailed", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.businessCosts = [];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business
    await user.click(screen.getByRole("radio", { name: "Detailed" }));

    // The table arrives with every suggested cost at $0…
    expect(screen.getByDisplayValue("Public liability")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Rent & utilities")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Training & PPE")).toBeInTheDocument();
    // …so none is left to add.
    expect(screen.queryByRole("button", { name: "Public liability" })).toBeNull();
    // Rows at $0 are not an answer — the overheads still come to nothing.
    expect(screen.getByText("Overheads a year").nextSibling).toHaveTextContent("$0");
  });

  it("fills an unpriced table already saved in Detailed, dropping the legacy placeholder", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.mode.business = "Detailed";
    saved.businessCosts = [{ name: "New cost", amount: 0, allocated_to: "shared" }];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business

    expect(screen.getByDisplayValue("Public liability")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Accounting fees")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("New cost")).toBeNull();
  });

  it("never refills a table that carries real amounts", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.mode.business = "Detailed";
    saved.businessCosts = [{ name: "Yard lease", amount: 21000, allocated_to: "install" }];
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business

    // The one priced row survives untouched; the suggestions stay to add.
    expect(screen.getByDisplayValue("Yard lease")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Public liability")).toBeNull();
    expect(screen.getByRole("button", { name: "Public liability" })).toBeInTheDocument();
  });

  it("adds a suggested cost in one press, keeps names editable, and removes with a word", async () => {
    const user = userEvent.setup();
    const saved = savedState();
    saved.businessCosts = [{ name: "Public liability", amount: 5500, allocated_to: "shared" }];
    saved.mode.business = "Detailed";
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business

    // A cost already there isn't offered again; pressing one adds its row.
    expect(screen.queryByRole("button", { name: "Public liability" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Rent & utilities" }));
    expect(screen.getByDisplayValue("Rent & utilities")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rent & utilities" })).toBeNull();

    // The cost name is a real input, not static text.
    const name = screen.getByDisplayValue("Public liability");
    await user.clear(name);
    await user.type(name, "PI insurance");
    expect(screen.getByDisplayValue("PI insurance")).toBeInTheDocument();

    // A row goes with its word, never a bare cross (rule 27).
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    expect(screen.queryByDisplayValue("PI insurance")).toBeNull();
  });
});

describe("RateCalculator — Your rates and Insights wait for all five steps", () => {
  it("keeps them closed until every step is done, then opens them", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    const yourRates = () => screen.getByRole("button", { name: /^Your rates/ });
    expect(yourRates()).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Insights/ })).toBeDisabled();

    // Step 1 — wages.
    await enterWages(user);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business

    // Step 2 — overheads.
    await enterWages(user, "4000");
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Vehicles

    // Step 3 — no vehicles.
    await user.click(screen.getByRole("radio", { name: "No vehicles" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Risk

    // Step 4 — accepting the defaults is the Continue itself.
    expect(yourRates()).toBeDisabled(); // risk not yet accepted
    await user.click(screen.getByRole("button", { name: "Continue" })); // accepts risk → Profit

    // Step 5 — everything else done, so the button says where it goes.
    await user.click(screen.getByRole("button", { name: "See your rates" })); // accepts profit

    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
    expect(yourRates()).toBeEnabled();
  });

  it("the last Continue walks back to the first unfinished step instead", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    // Staff only; Business and Vehicles left.
    await enterWages(user);
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Business (skipped)
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Vehicles (skipped)
    await user.click(screen.getByRole("button", { name: "Continue" })); // → Risk
    await user.click(screen.getByRole("button", { name: "Continue" })); // accepts risk → Profit

    // Business is unfinished, so no "See your rates", and the press goes
    // back to Step 2 rather than on.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(footer(2))).toBeInTheDocument();
    expect(screen.queryByText("Your recommended rates")).toBeNull();
  });
});

describe("RateCalculator — never offers to lower what you charge", () => {
  it("has no Use these rates when what you charge already beats the recommendation", () => {
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.currentRates = { install: 200, service: 200 }; // ≥ recommended ⇒ uplift 0
    render(<RateCalculator initialState={saved} />);

    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
    expect(screen.getByText("You're priced right")).toBeInTheDocument();
    expect(screen.getByText(/no increase needed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use these rates" })).toBeNull();
  });

  it("offers Use these rates when you charge under, and takes them", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    await user.click(screen.getByRole("button", { name: "Use these rates" }));
    expect(screen.getByText("These are the rates you charge")).toBeInTheDocument();
    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    expect(saveRateCalcState.mock.calls.at(-1)![0].reviewState.lastReviewed).toBeTruthy();
  });
});

describe("RateCalculator — what you charge is typed beside every step", () => {
  it("sets what you charge in Your rates and saves it", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user); // skips the intro → nothing charged yet

    const install = screen.getByLabelText("Current install rate");
    expect(install).toHaveValue("");
    await user.type(install, "120");
    expect(install).toHaveValue("120");

    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalled(), { timeout: 3000 });
    expect(saveRateCalcState.mock.calls.at(-1)![0].currentRates.install).toBe(120);
  });

  it("says how far under when you charge less than recommended", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    await user.click(screen.getByRole("button", { name: "Back to the steps" }));
    // The baseline charges 118/105 against ~132/143 recommended.
    expect(screen.getByLabelText("Current install rate")).toHaveValue("118");
    expect(screen.getAllByText(/^\$\d+ under$/).length).toBeGreaterThan(0);
  });

  it("says how far above when you charge more", async () => {
    const user = userEvent.setup();
    const saved = JSON.parse(JSON.stringify(buildBaselineState()));
    saved.currentRates = { install: 300, service: 300 };
    render(<RateCalculator initialState={saved} />);
    await user.click(screen.getByRole("button", { name: "Back to the steps" }));
    expect(screen.getAllByText(/^\$\d+ above$/).length).toBeGreaterThan(0);
  });

  it("has them in Settings too", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Settings install rate")).toBeInTheDocument();
    expect(screen.getByLabelText("Settings service rate")).toBeInTheDocument();
  });
});

describe("RateCalculator — retired example data", () => {
  it("offers no example-data escape hatch on an empty setup", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={null} />);
    await dismissOnboarding(user);

    expect(screen.getByText(/To see your rates/)).toBeInTheDocument();
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
    expect(screen.getByText(HELP)).toBeInTheDocument();
    expect(screen.queryByText(/Blue Sky Air Conditioning/)).toBeNull();
    // …and the poisoned buffer is gone, so nothing can write it back
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).toBeNull();
    expect(saveRateCalcState).not.toHaveBeenCalled();
  });

  /* The other half of the rule above: a HEALTHY buffer on an org that has
     never saved is a previous session's edits that never reached the server.
     It opens as those edits — not as a first run — and is pushed up straight
     away. Deliberately the test after the retired one, so a buffer read that
     leaked from it would show up here as onboarding. */
  it("restores a healthy crash buffer and pushes it to the server", async () => {
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: buildBaselineState(),
      savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={null} />);

    expect(screen.queryByText(HELP)).toBeNull();
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();

    await waitFor(() => expect(saveRateCalcState).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe("RateCalculator — returning user with saved state", () => {
  it("lands on Your rates when the saved setup is complete", () => {
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    expect(screen.queryByText(HELP)).toBeNull();
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });
});

describe("RateCalculator — start fresh", () => {
  // In Settings; it takes two presses.
  async function startFresh(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Start fresh" }));
    await user.click(screen.getByRole("button", { name: "Yes, clear everything" }));
  }

  it("clears the saved setup and drops the returning user back to a first run", async () => {
    const user = userEvent.setup();
    localStorage.setItem("heytiff.rate-calc.buffer", JSON.stringify({
      state: buildBaselineState(), savedAt: 1_784_000_000_000,
    }));
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();

    await startFresh(user);

    // Server row deleted, crash buffer gone, onboarding back
    await waitFor(() => expect(resetRateCalcState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(HELP)).toBeInTheDocument());
    expect(localStorage.getItem("heytiff.rate-calc.buffer")).toBeNull();
    expect(screen.queryByText("Your recommended rates")).toBeNull();

    // …and the wiped figures do not come back
    await dismissOnboarding(user);
    expect(screen.getByText(/To see your rates/)).toBeInTheDocument();
  });

  it("does not clear anything until the second press", async () => {
    const user = userEvent.setup();
    render(<RateCalculator initialState={JSON.parse(JSON.stringify(buildBaselineState()))} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Start fresh" }));
    await user.click(screen.getByRole("button", { name: "Keep my setup" }));

    expect(resetRateCalcState).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
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
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Your recommended rates")).toBeInTheDocument();
  });
});
