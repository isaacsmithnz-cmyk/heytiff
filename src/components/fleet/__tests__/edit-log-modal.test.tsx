import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditLogModal } from "../modals";
import type { VehicleLog } from "../logic";

jest.mock("@/app/actions/fleet-ai", () => ({ readFuelReceipt: jest.fn() }));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));

/* Correcting an entry. The modal opens on the FIGURES, not on a camera — this
   is the job LogModal deliberately doesn't do. */

const TODAY = "2026-08-04";

const fuelLog = (over: Partial<VehicleLog> = {}): VehicleLog => ({
  id: "log-1",
  vehicleId: "v-1",
  staffId: "staff-1",
  kind: "fuel",
  when: "Fri 31 Jul",
  ago: 4, // 4 days before TODAY
  litres: 62.4,
  cost: 158.4,
  station: "Shell Coburg",
  gst: 14.4,
  abn: "51824753556",
  hasReceipt: true,
  ...over,
});

function setup(log = fuelLog()) {
  const onSave = jest.fn();
  const onDelete = jest.fn();
  render(
    <EditLogModal
      log={log}
      today={TODAY}
      onSave={onSave}
      onDelete={onDelete}
      onClose={jest.fn()}
    />,
  );
  return { onSave, onDelete, user: userEvent.setup() };
}

describe("EditLogModal", () => {
  it("opens on the existing figures, with no scan step anywhere", () => {
    setup();
    expect(screen.getByDisplayValue("62.4")).toBeInTheDocument();
    expect(screen.getByDisplayValue("158.40")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Shell Coburg")).toBeInTheDocument();
    expect(screen.getByDisplayValue("51824753556")).toBeInTheDocument();
    expect(screen.queryByText("Snap or upload the receipt")).not.toBeInTheDocument();
  });

  it("says the stored receipt is not replaceable from here", () => {
    setup();
    expect(screen.getByText(/remove the entry and log it again/)).toBeInTheDocument();
  });

  it("hands back only a correction, anchored on the server's date", async () => {
    const { onSave, user } = setup();
    const litres = screen.getByDisplayValue("62.4");
    await user.clear(litres);
    await user.type(litres, "60.2");
    await user.click(screen.getByRole("button", { name: /Save correction/ }));

    const patch = onSave.mock.calls[0][0];
    expect(patch.litres).toBe(60.2);
    // ago=4 against a server today of 2026-08-04 — never the browser's clock
    expect(patch.purchasedOn).toBe("2026-07-31");
  });

  it("blocks a GST that outgrows the corrected total", async () => {
    const { user } = setup();
    const cost = screen.getByDisplayValue("158.40");
    await user.clear(cost);
    await user.type(cost, "40");

    expect(screen.getByText(/More than an eleventh/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save correction/ })).toBeDisabled();
  });

  it("asks before removing, and says what removing actually does", async () => {
    const { onDelete, user } = setup();
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));

    expect(screen.getByText(/odometer is recalculated/)).toBeInTheDocument();
    expect(screen.getByText(/receipt stays on file/)).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Remove entry/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("backs out of the confirmation without removing anything", async () => {
    const { onDelete, user } = setup();
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    await user.click(screen.getByRole("button", { name: /Keep it/ }));
    expect(screen.getByDisplayValue("62.4")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("shows no fuel or tax fields on an issue report", () => {
    setup(fuelLog({ kind: "issue", litres: undefined, cost: undefined, note: "Brakes squealing" }));
    expect(screen.queryByText("GST ($)")).not.toBeInTheDocument();
    expect(screen.queryByText("Supplier ABN")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Brakes squealing")).toBeInTheDocument();
  });
});
