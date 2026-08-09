import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { XeroCostsPanel } from "../xero-costs";
import { XeroFleetPanel } from "../xero-fleet";
import { emptyState, type RateCalcState, type XeroCostSnapshot } from "../state";

/* The three things this panel now has to SAY, because each one is a number
   about to be read as something it isn't:

   1. the window is a part year, so the total on screen is a scale-up
   2. vehicle cost was held back for a step that hasn't got it
   3. some kept lines may not be overheads at all

   Every one of them replaces a silent, plausible, wrong answer. */

const snap = (over: Partial<XeroCostSnapshot> = {}): XeroCostSnapshot => ({
  fetchedAt: "2026-07-26T00:00:00.000Z",
  period: { from: "2025-07-01", to: "2026-06-30", label: "FY 2025–26" },
  tenantName: "Demo Company (AU)",
  lines: [{ name: "Rent", amount: 12000, allocated_to: "shared" }],
  excluded: [],
  notes: [],
  sections: ["Operating Expenses"],
  dormant: [],
  monthsCovered: 12,
  annualise: true,
  ...over,
});

function setup(over: Partial<RateCalcState> = {}) {
  const patch = jest.fn();
  const s: RateCalcState = { ...emptyState(), costsSource: "xero", xeroCosts: snap(), ...over };
  render(
    <XeroCostsPanel
      s={s}
      patch={patch}
      onFetch={async () => ({ ok: false, error: "not used" })}
    />
  );
  return { patch, s };
}

describe("a window the books only partly cover", () => {
  it("says how many months there really are, and shows both figures", () => {
    setup({ xeroCosts: snap({ monthsCovered: 5 }) });
    const banner = screen.getByText(/of these 12 months/i).closest(".rcx-part");
    expect(banner).toHaveTextContent("Your books cover 5 of these 12 months");
    // what Xero said, beside what the rate is actually priced on
    expect(banner).toHaveTextContent("$12,000 over 5 months, scaled to $28,800 for a year");
  });

  it("prices on the scaled figure, not the raw one", () => {
    setup({ xeroCosts: snap({ monthsCovered: 6 }) });
    expect(screen.getByText("$24,000")).toBeInTheDocument();
  });

  it("lets the user turn the scaling off", async () => {
    const { patch } = setup({ xeroCosts: snap({ monthsCovered: 6 }) });
    await userEvent.click(screen.getByRole("button", { name: /use the unscaled figures/i }));
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ xeroCosts: expect.objectContaining({ annualise: false }) })
    );
  });

  it("says plainly that the unscaled version under-carries the rate", () => {
    setup({ xeroCosts: snap({ monthsCovered: 5, annualise: false }) });
    expect(screen.getByText(/carrying less overhead than the business really has/i)).toBeInTheDocument();
  });

  it("stays quiet on a full year, and when coverage is unknown", () => {
    const { unmount } = render(
      <XeroCostsPanel s={{ ...emptyState(), costsSource: "xero", xeroCosts: snap() }} patch={jest.fn()} onFetch={async () => ({ ok: false, error: "" })} />
    );
    expect(screen.queryByText(/of these 12 months/i)).not.toBeInTheDocument();
    unmount();
    setup({ xeroCosts: snap({ monthsCovered: null }) });
    expect(screen.queryByText(/of these 12 months/i)).not.toBeInTheDocument();
  });
});

/* A SNAPSHOT OLD ENOUGH TO MISPRICE, AND THE CLOCK THAT SPOTS IT.

   The banner had no test at all, which is how the clock behind it got to sit
   in the render body: `snapshotAgeMonths(snap.fetchedAt, Date.now())`. Two
   things wrong with that, and only one of them is the lint rule. This page is
   SERVER-rendered with `initialState`, so the snapshot and its age both exist
   during SSR — and a month boundary crossed between the server's clock and
   the browser's puts different markup in the same node, which is a hydration
   failure for the whole tree. The workboard has already paid for this once
   (see sm8-chip, whose chip took the entire board's hydration down).

   So: the server sends no verdict about age, and the browser reaches the same
   one a beat later. Both halves are pinned, because gating the banner without
   the second test would look exactly like deleting the feature. */
describe("a snapshot old enough to misprice", () => {
  const OLD = snap({ fetchedAt: new Date(Date.now() - 400 * 86_400_000).toISOString() });

  /* Matched on the OPENING phrase, never on "months old". The banner shipped
     as "6 monthsold" — JSX drops the leading space of a text chunk that wraps
     to a new line — so a `/months old/` matcher passes whether the banner is
     there or not, and the two negative cases below would have proved nothing.
     The spacing is fixed; this matcher stays honest either way. */
  const WARNING = /this snapshot is more than/i;

  it("warns once the browser has a clock", () => {
    setup({ xeroCosts: OLD });
    expect(screen.getByText(WARNING)).toHaveTextContent("more than 6 months old");
  });

  it("says nothing about a snapshot pulled this month", () => {
    setup({ xeroCosts: snap({ fetchedAt: new Date().toISOString() }) });
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("respects the calculator's own review reminder as the threshold", () => {
    const s = { ...emptyState(), costsSource: "xero" as const, xeroCosts: OLD };
    s.settings.review_reminder_months = 24;
    render(<XeroCostsPanel s={s} patch={jest.fn()} onFetch={async () => ({ ok: false, error: "" })} />);
    // 400 days is over 6 months but well under 24 — the threshold, not a constant
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  /* THE HYDRATION PROPERTY. What the server sends must not depend on the
     clock, or the two renders disagree and React tears the tree down. */
  it("sends no age verdict from the server, however old the snapshot is", () => {
    const html = renderToString(
      <XeroCostsPanel
        s={{ ...emptyState(), costsSource: "xero", xeroCosts: OLD }}
        patch={jest.fn()}
        onFetch={async () => ({ ok: false, error: "" })}
      />
    );
    expect(html).toContain("Demo Company (AU)"); // it did render the panel
    expect(html).not.toMatch(WARNING);
  });
});

describe("vehicle cost held back for a step that hasn't got it", () => {
  const withVehicles = snap({
    excluded: [{ name: "Motor Vehicle Expenses", amount: 4800, reason: "vehicle" }],
  });

  it("warns when the money is in neither pool", () => {
    setup({ xeroCosts: withVehicles });
    expect(screen.getByText(/\$4,800 of vehicle cost isn't being counted anywhere/i)).toBeInTheDocument();
  });

  it("puts every vehicle line back in one press", async () => {
    const { patch } = setup({ xeroCosts: withVehicles });
    await userEvent.click(screen.getByRole("button", { name: /add \$4,800 to overheads/i }));
    const next = patch.mock.calls[0][0].xeroCosts;
    expect(next.lines).toContainEqual({ name: "Motor Vehicle Expenses", amount: 4800, allocated_to: "shared" });
    expect(next.excluded).toHaveLength(0);
  });

  /* The exclusion is RIGHT once the Vehicles step actually has figures — the
     bug was only ever that nothing checked. */
  it("says nothing once the fleet is costed", () => {
    setup({ xeroCosts: withVehicles, simpleVehicle: { months: [400, 400, 400] } });
    expect(screen.queryByText(/isn't being counted anywhere/i)).not.toBeInTheDocument();
  });
});

describe("kept lines worth a second look", () => {
  it("flags them without taking them out of the pool", () => {
    setup({
      xeroCosts: snap({
        lines: [
          { name: "Rent", amount: 12000, allocated_to: "shared" },
          { name: "Depreciation", amount: 8000, allocated_to: "shared" },
        ],
        notes: [{ name: "Depreciation", amount: 8000, note: "depreciation" }],
      }),
    });
    expect(screen.getByText("Worth checking")).toBeInTheDocument();
    expect(screen.getByText(/may already be in Vehicles/i)).toBeInTheDocument();
    // still priced: 12,000 + 8,000
    expect(screen.getByText("$20,000")).toBeInTheDocument();
  });
});

/* The fleet follows the FIRST pull; a refresh never re-decides it. The first
   pull is where vehicle lines first leave the overhead pool, so taking the
   fleet then prevents the mixed state — but re-running that default on every
   refresh would override "Enter them myself" each time the button is pressed. */
describe("the fleet follows the first pull, not every refresh", () => {
  const withVehicles = snap({
    excluded: [{ name: "Motor Vehicle Expenses", amount: 3000, reason: "vehicle" }],
  });

  it("takes the fleet along on the first pull", async () => {
    const patch = jest.fn();
    const s: RateCalcState = { ...emptyState(), xeroCosts: null };
    render(<XeroCostsPanel s={s} patch={patch} onFetch={async () => ({ ok: true, snapshot: withVehicles })} />);
    await userEvent.click(screen.getByRole("button", { name: /pull from xero/i }));
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ costsSource: "xero", vehicleSource: "xero" })
    );
  });

  it("leaves a deliberately-manual fleet alone on refresh", async () => {
    const patch = jest.fn();
    const s: RateCalcState = { ...emptyState(), costsSource: "xero", vehicleSource: "manual", xeroCosts: withVehicles };
    render(<XeroCostsPanel s={s} patch={patch} onFetch={async () => ({ ok: true, snapshot: withVehicles })} />);
    await userEvent.click(screen.getByRole("button", { name: /^refresh$/i }));
    const arg = patch.mock.calls[0][0];
    expect(arg.costsSource).toBe("xero");
    expect(arg).not.toHaveProperty("vehicleSource");
  });
});

/* The fleet panel writes the SAME snapshot the Business step reads, so its
   refresh must re-ask for the same window and keep the judgements made on
   the other panel. */
describe("XeroFleetPanel refresh", () => {
  it("re-asks for the snapshot's own window and keeps allocations", async () => {
    const patch = jest.fn();
    const prev = snap({
      period: { from: "2025-07-01", to: "2026-06-30", label: "Last 12 months" },
      lines: [{ name: "Rent", amount: 12000, allocated_to: "install" }],
      excluded: [{ name: "Fuel", amount: 2000, reason: "vehicle" }],
    });
    const fresh = snap({
      lines: [{ name: "Rent", amount: 13000, allocated_to: "shared" }],
      excluded: [{ name: "Fuel", amount: 2100, reason: "vehicle" }],
    });
    const onFetch = jest.fn(async () => ({ ok: true as const, snapshot: fresh }));
    const s: RateCalcState = { ...emptyState(), vehicleSource: "xero", xeroCosts: prev };
    render(<XeroFleetPanel s={s} patch={patch} onFetch={onFetch} />);
    await userEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    expect(onFetch).toHaveBeenCalledWith("trailing-12");
    const merged = patch.mock.calls[0][0].xeroCosts;
    // the Business panel's re-allocation survives a refresh pressed HERE
    expect(merged.lines).toEqual([{ name: "Rent", amount: 13000, allocated_to: "install" }]);
  });
});
