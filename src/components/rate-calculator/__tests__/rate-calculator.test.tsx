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
