import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogModal } from "../modals";
import type { NewLog, VehicleIdentity } from "../logic";

/* Scanning a fuel docket, all the way to what Save hands over.

   The thing under test is not the reading — that is a server action, mocked
   here as it must be — but the two facts the tax track depends on: the PHOTO
   gets stored, and the figures that leave this modal are the ones on the
   docket, including its own date. */

const readFuelReceipt = jest.fn();
const uploadFile = jest.fn();

jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: (...a: unknown[]) => readFuelReceipt(...a),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const TODAY = "2026-08-04";

/* Identity width, which is all LogModal is given — someone fuelling a pool ute
   is not entitled to the register's view of it. */
const mine: VehicleIdentity = {
  id: "vrf-04",
  name: "VRF-04",
  make: "Toyota",
  model: "Hiace ZR",
  year: 2022,
  plate: "MKT482",
  plateState: "VIC",
  status: "active",
  odometer: 84120,
};

const READ_OK = {
  ok: true,
  litres: 62.4,
  cost: 158.4,
  station: "Shell Coburg",
  date: "2026-07-31",
  gst: 14.4,
  abn: "51824753556",
};

/** The modal's commit button carries the action's own name, not "Save". */
function saveButton() {
  return screen.getByRole("button", { name: /Log fuel/ });
}

function setup() {
  const onSave = jest.fn();
  render(
    <LogModal kind="fuel" today={TODAY} vehicle={mine} onSave={onSave} onClose={jest.fn()} />,
  );
  return { onSave, user: userEvent.setup() };
}

async function scan(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["docket"], "receipt.jpg", { type: "image/jpeg" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
  await waitFor(() => expect(screen.getByText(/Litres/)).toBeInTheDocument());
  return file;
}

beforeEach(() => {
  readFuelReceipt.mockReset().mockResolvedValue(READ_OK);
  uploadFile.mockReset().mockResolvedValue({ ok: true, file: { documentId: "doc-77" } });
  // jsdom has no object URLs
  URL.createObjectURL = jest.fn(() => "blob:preview");
  URL.revokeObjectURL = jest.fn();
});

describe("scanning a fuel docket", () => {
  it("stores the photo as a fuel receipt, not as an expense receipt", async () => {
    const { user } = setup();
    const file = await scan(user);
    // the kind is what stops a docket being adopted by an expense claim and
    // counted twice in the tax export
    expect(uploadFile).toHaveBeenCalledWith(file, "fuel_receipt");
  });

  it("says the receipt was kept", async () => {
    const { user } = setup();
    await scan(user);
    expect(screen.getByText(/Receipt saved/)).toBeInTheDocument();
  });

  it("hands Save the stored document, the tax figures and the docket's date", async () => {
    const { onSave, user } = setup();
    await scan(user);
    await user.click(saveButton());

    const log = onSave.mock.calls[0][0] as NewLog;
    expect(log.receiptDocumentId).toBe("doc-77");
    expect(log.gst).toBe(14.4);
    expect(log.abn).toBe("51824753556");
    // NOT today — the fill happened on the 31st, which in June/July is a
    // different financial year from the day it gets filed
    expect(log.purchasedOn).toBe("2026-07-31");
    expect(log.litres).toBe(62.4);
    expect(log.source).toBe("scan");
  });

  it("still keeps the photo when Tiff can't read it", async () => {
    // The two jobs are independent: a failed read must not cost the document.
    readFuelReceipt.mockResolvedValue({ ok: false, reason: "no-key" });
    const { onSave, user } = setup();
    await scan(user);
    expect(screen.getByText(/Receipt saved/)).toBeInTheDocument();

    await user.click(saveButton());
    expect((onSave.mock.calls[0][0] as NewLog).receiptDocumentId).toBe("doc-77");
  });

  it("says so, and still saves the entry, when the photo can't be stored", async () => {
    uploadFile.mockResolvedValue({ ok: false, error: "That upload didn't finish." });
    const { onSave, user } = setup();
    await scan(user);
    expect(screen.getByText(/Couldn't store the photo/)).toBeInTheDocument();

    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as NewLog).receiptDocumentId).toBeUndefined();
  });

  it("blocks a GST bigger than an eleventh of the total", async () => {
    const { user } = setup();
    await scan(user);
    const gst = screen.getByPlaceholderText("e.g. 14.40");
    await user.clear(gst);
    await user.type(gst, "40");

    expect(screen.getByText(/More than an eleventh/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("blocks an ABN that isn't eleven digits", async () => {
    const { user } = setup();
    await scan(user);
    const abn = screen.getByPlaceholderText(/51 824 753 556/);
    await user.clear(abn);
    await user.type(abn, "004085616"); // an ACN, the near miss

    expect(screen.getByText(/eleven digits/)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("drops the stored photo when the scan is redone", async () => {
    const { user } = setup();
    await scan(user);
    await user.click(screen.getByRole("button", { name: /re-scan/ }));
    expect(screen.getByText("Snap or upload the receipt")).toBeInTheDocument();
    expect(screen.queryByText(/Receipt saved/)).not.toBeInTheDocument();
  });
});
