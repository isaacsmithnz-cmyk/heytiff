/* THE SIMULATION GATE, at both ends: the tick in the simulation view, and what
   the Summary sheet does with it.

   The rule under test is that a sheet never advertises a simulation the reader
   cannot open. So the Simulate control is ABSENT — not disabled, not a warning
   — until every floor that can simulate has been ticked as ready to share, and
   the checks list has to say so when something is holding it back.

   The cards that talk to the server are mocked at the module boundary: this
   suite is about the gate, not about sharing or contributors. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createDesign, type DesignDocument } from "@/lib/studio/document";
import type { SimApprovalState } from "@/lib/studio/sim-approval";
import { SimApproveSwitch } from "../../sim-approve";
import { NO_BRAND } from "@/lib/org/brand";
import { SummaryView } from "../summary";

/* Contributors resolves a lazily imported action after paint, and settling it
   mid-assertion is just act() noise about a card this suite is not testing.
   Held pending on purpose: the gate is decided before it ever answers. */
jest.mock("@/app/actions/studio-contributors", () => ({
  listDesignContributors: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/app/actions/studio-share", () => ({
  getShareLink: jest.fn().mockResolvedValue(null),
  createShareLink: jest.fn(),
  revokeShareLink: jest.fn(),
}));

const NOTHING: SimApprovalState = {
  simulatable: [],
  approved: [],
  pending: [],
  lapsed: [],
  offered: false,
};

const planImages = {
  url: jest.fn(),
  upload: jest.fn(),
  uploadSource: jest.fn(),
  sourceFile: jest.fn(),
  remove: jest.fn(),
};

function renderSummary(simApproval: SimApprovalState, doc?: DesignDocument) {
  render(
    <SummaryView
      doc={doc ?? createDesign({ name: "Kembla St", mode: "blank", now: "2026-08-18T00:00:00.000Z" })}
      brand={NO_BRAND}
      pack={null}
      onMutate={jest.fn()}
      onExportJson={jest.fn()}
      simFlag
      simReady={{ ok: true, reason: "", floorName: "Ground" }}
      simApproval={simApproval}
      onSimulate={jest.fn()}
      planImages={planImages}
      loadVariant={jest.fn()}
    />
  );
}

const simulate = () => screen.queryByRole("button", { name: /Simulate/ });

describe("the Simulate option on the Summary sheet", () => {
  it("is ABSENT while nothing has been ticked as ready to share", () => {
    renderSummary({ ...NOTHING, simulatable: [{ id: "a", name: "Ground" }], pending: [{ id: "a", name: "Ground" }] });
    expect(simulate()).not.toBeInTheDocument();
    // and not merely greyed out — a disabled control still advertises it
    expect(screen.queryByText("Simulate")).not.toBeInTheDocument();
  });

  it("appears once every simulatable floor is ticked", () => {
    renderSummary({
      ...NOTHING,
      simulatable: [{ id: "a", name: "Ground" }],
      approved: [{ id: "a", name: "Ground" }],
      offered: true,
    });
    expect(simulate()).toBeInTheDocument();
  });

  it("stays absent on a PART-APPROVED design", () => {
    renderSummary({
      ...NOTHING,
      simulatable: [
        { id: "a", name: "Ground" },
        { id: "b", name: "First floor" },
      ],
      approved: [{ id: "a", name: "Ground" }],
      pending: [{ id: "b", name: "First floor" }],
    });
    expect(simulate()).not.toBeInTheDocument();
  });
});

describe("the checks list explains the absence", () => {
  it("names the floor holding the simulation back", async () => {
    const user = userEvent.setup();
    renderSummary({
      ...NOTHING,
      simulatable: [
        { id: "a", name: "Ground" },
        { id: "b", name: "First floor" },
      ],
      approved: [{ id: "a", name: "Ground" }],
      pending: [{ id: "b", name: "First floor" }],
    });
    await user.click(screen.getByRole("button", { name: /to check before you send this/ }));
    expect(
      screen.getByText("First floor is holding the simulation back")
    ).toBeInTheDocument();
  });

  it("SAYS WHEN AN EDIT WITHDREW A SIMULATION ALREADY SHARED", async () => {
    /* the client's copy of the link loses the option silently — the owner is
       the only person who can be told it happened */
    const user = userEvent.setup();
    renderSummary({
      ...NOTHING,
      simulatable: [{ id: "a", name: "Ground" }],
      pending: [{ id: "a", name: "Ground" }],
      lapsed: [{ id: "a", name: "Ground" }],
    });
    await user.click(screen.getByRole("button", { name: /to check before you send this/ }));
    expect(
      screen.getByText("The simulation is no longer offered on the share link")
    ).toBeInTheDocument();
    expect(screen.getByText(/Ground was ticked as ready to share/)).toBeInTheDocument();
  });

  it("stays quiet on a design nobody ever tried to share a simulation from", () => {
    /* an untouched design must not carry a permanent check for a feature its
       owner never reached for */
    renderSummary({ ...NOTHING, simulatable: [{ id: "a", name: "Ground" }], pending: [{ id: "a", name: "Ground" }] });
    expect(screen.getByText("Nothing flagged")).toBeInTheDocument();
  });
});

describe("the ready-to-share switch", () => {
  it("reports its state as a switch, and toggles", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <SimApproveSwitch on={false} floorName="Ground" nameTheFloor={false} onChange={onChange} />
    );
    const sw = screen.getByRole("switch", { name: /Ready to share/ });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("names its floor only when there is more than one that can simulate", () => {
    const { unmount } = render(
      <SimApproveSwitch on nameTheFloor={false} floorName="Ground" onChange={jest.fn()} />
    );
    expect(screen.queryByText("Ground")).not.toBeInTheDocument();
    unmount();
    render(<SimApproveSwitch on nameTheFloor floorName="Ground" onChange={jest.fn()} />);
    expect(screen.getByText("Ground")).toBeInTheDocument();
  });
});
