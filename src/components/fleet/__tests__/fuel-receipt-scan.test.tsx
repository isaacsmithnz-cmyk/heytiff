import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogModal } from "../modals";
import type { NewLog, VehicleIdentity } from "../logic";

/* Scanning a fuel docket, all the way to what Save hands over.

   The thing under test is not the reading — that is a server action, mocked
   here as it must be — but the two facts the tax track depends on: the PHOTO
   gets stored, and the figures that leave this modal are the ones on the
   docket, including its own date. */

const readFuelReceipt = jest.fn();
const readServiceRecord = jest.fn();
const uploadFile = jest.fn();

jest.mock("@/app/actions/fleet-ai", () => ({
  readFuelReceipt: (...a: unknown[]) => readFuelReceipt(...a),
  readServiceRecord: (...a: unknown[]) => readServiceRecord(...a),
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
  const onClose = jest.fn();
  render(
    <LogModal kind="fuel" today={TODAY} vehicle={mine} onSave={onSave} onClose={onClose} />,
  );
  return { onSave, onClose, user: userEvent.setup() };
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

/* A SCAN IN PROGRESS OUTLIVES A STRAY ESCAPE (see scanInProgress, in
   record-modal/scan-card): closing the modal mid-scan threw away a docket
   already stored, owned by nothing. */
describe("a docket being scanned", () => {
  const backdrop = () => fireEvent.click(document.querySelector(".fl-ov") as HTMLElement);

  it("survives Escape and the backdrop while it is read or waits to be checked; the X still closes", async () => {
    let finish: (v: unknown) => void = () => {};
    readFuelReceipt.mockReturnValue(new Promise((r) => (finish = r)));
    const { user, onClose } = setup();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["docket"], "receipt.jpg", { type: "image/jpeg" }));
    await screen.findByText(/Tiff is reading the receipt/);
    await user.keyboard("{Escape}");
    backdrop();
    expect(onClose).not.toHaveBeenCalled();

    finish(READ_OK);
    await screen.findByText(/Receipt saved/);
    await user.keyboard("{Escape}");
    backdrop();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes on Escape and on the backdrop before anything is scanned", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    backdrop();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/* THE SERVICE INVOICE GETS THE DOCKET'S TREATMENT. Log service used to type a
   note; the mechanic's invoice — the one document that says what was done —
   had nowhere to go. Now it is scanned, read and kept the way a docket is:
   the workshop, the date, the reading, the cost and its GST, the one line
   the history prints, and the itemised work under it. */
describe("scanning a service invoice", () => {
  const READ_SERVICE = {
    ok: true,
    workshop: "Braeside Auto",
    servicedOn: "2026-07-28",
    odometer: 120000,
    cost: 812.5,
    gst: 73.86,
    abn: "51824753556",
    summary: "120,000 km logbook service",
    workDone: ["Engine oil and filter", "Brake pads, front", "Wheel alignment"],
  };

  function setupService() {
    const onSave = jest.fn();
    render(<LogModal kind="service" today={TODAY} vehicle={mine} onSave={onSave} onClose={jest.fn()} />);
    return { onSave, user: userEvent.setup() };
  }

  async function scanInvoice(user: ReturnType<typeof userEvent.setup>) {
    const file = new File(["invoice"], "braeside-12041.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() => expect(screen.getByText(/Work done/)).toBeInTheDocument());
    return file;
  }

  beforeEach(() => {
    readServiceRecord.mockReset().mockResolvedValue(READ_SERVICE);
    uploadFile.mockReset().mockResolvedValue({ ok: true, file: { documentId: "doc-41" } });
  });

  it("opens on the scan, and takes a PDF — a dealer's invoice usually is one", () => {
    setupService();
    expect(screen.getByText("Snap or upload the service invoice")).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain("application/pdf");
    // a phone is not forced open: the picker offers the camera as one choice
    expect(input.hasAttribute("capture")).toBe(false);
  });

  it("stores the invoice as a service record, not as a fuel docket or an expense receipt", async () => {
    const { user } = setupService();
    const file = await scanInvoice(user);
    expect(uploadFile).toHaveBeenCalledWith(file, "service_record");
    expect(screen.getByText(/Service record saved/)).toBeInTheDocument();
  });

  it("fills the form from the invoice and hands Save the record, the work and the invoice's date", async () => {
    const { onSave, user } = setupService();
    await scanInvoice(user);
    expect(screen.getByDisplayValue("Braeside Auto")).toBeInTheDocument();
    expect(screen.getByDisplayValue("120,000 km logbook service")).toBeInTheDocument();
    expect(screen.getByDisplayValue("120000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Log service/ }));

    const log = onSave.mock.calls[0][0] as NewLog;
    expect(log.kind).toBe("service");
    expect(log.receiptDocumentId).toBe("doc-41");
    expect(log.station).toBe("Braeside Auto");
    expect(log.cost).toBe(812.5);
    expect(log.gst).toBe(73.86);
    expect(log.abn).toBe("51824753556");
    expect(log.odo).toBe(120000);
    expect(log.note).toBe("120,000 km logbook service");
    expect(log.workDone).toBe("Engine oil and filter\nBrake pads, front\nWheel alignment");
    // the invoice's date, not today's: a service on the 28th happened on the 28th
    expect(log.purchasedOn).toBe("2026-07-28");
    expect(log.source).toBe("scan");
  });

  it("keeps the record and opens the fields empty when Tiff can't read it — nothing is invented", async () => {
    readServiceRecord.mockResolvedValue({ ok: false, reason: "no-key" });
    const { onSave, user } = setupService();
    await scanInvoice(user);
    expect(screen.getByText(/Tiff couldn't read that one/)).toBeInTheDocument();
    expect(screen.getByText(/Service record saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Demo read/)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Currently/), "121000");
    await user.click(screen.getByRole("button", { name: /Log service/ }));
    const log = onSave.mock.calls[0][0] as NewLog;
    expect(log.receiptDocumentId).toBe("doc-41");
    expect(log.source).toBe("manual");
    expect(log.station).toBeUndefined();
  });

  it("blocks a GST bigger than an eleventh of the total, as the docket does", async () => {
    const { user } = setupService();
    await scanInvoice(user);
    const gst = screen.getByPlaceholderText("e.g. 43.64");
    await user.clear(gst);
    await user.type(gst, "200");
    expect(screen.getByText(/More than an eleventh/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Log service/ })).toBeDisabled();
  });
});
