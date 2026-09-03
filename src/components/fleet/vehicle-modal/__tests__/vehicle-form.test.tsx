import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenewalInput } from "@/app/actions/fleet";
import type { Vehicle } from "../../logic";
import { VehicleForm } from "../vehicle-form";

/* The redesigned form. Three contracts carried over from the form it replaces
   — the make is picked not typed, the purchase invoice attaches even when the
   read fails, every date is a picker — and the new one: the form opens on the
   rego certificate, and a vehicle added by scanning it arrives with its first
   registration filed as a record, certificate under it. */

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

const readRegoCertificate = jest.fn();
const readPurchaseInvoice = jest.fn();
jest.mock("@/app/actions/fleet-ai", () => ({
  readRegoCertificate: (...a: unknown[]) => readRegoCertificate(...a),
  readPurchaseInvoice: (...a: unknown[]) => readPurchaseInvoice(...a),
}));

const TODAY = "2026-09-02";

/* The Triton's certificate, as the reader returns it. */
const TRITON_CERT = {
  ok: true,
  plate: "YLI59V",
  plateState: "NSW",
  make: "Mitsubishi",
  model: "Triton",
  variant: "MR4W30-",
  year: 2022,
  bodyType: "ute",
  colour: null,
  vin: "MMAWLKL10NH035826",
  engineNumber: "4N15ULB0443",
  engineCapacityCc: 2442,
  seating: 4,
  tareKg: 2180,
  gvmKg: 2900,
  atmKg: null,
  expiresOn: "2027-09-29",
  renewalAmount: 1008,
  customerNo: "21970756",
  issuer: "Transport for NSW",
};

const VAN: Vehicle = {
  id: "v1",
  name: "ZUCKY",
  make: "TOYOTA", // as a free-text field left it
  model: "Hiace",
  year: 2022,
  plate: "EVD72G",
  plateState: "NSW",
  status: "active",
  odometer: 55500,
  regoDays: 109,
  insuranceDays: 300,
  ctpDays: 300,
  serviceIntervalKm: 10000,
  lastServiceOdo: 50000,
  serviceIntervalMonths: null,
  serviceDays: null,
  motorised: true,
  assignedTo: null,
  value: 45000,
  purchasePrice: 0,
  purchaseDateDays: 0,
  lastServiceDays: null,
};

function setup(initial: Vehicle | null = null) {
  const onSave = jest.fn();
  const onClose = jest.fn();
  render(<VehicleForm initial={initial} staff={[]} today={TODAY} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose, user: userEvent.setup() };
}

const plateInput = () => screen.getByPlaceholderText("e.g. MKT482");
const makeSelect = () => screen.getByRole("combobox", { name: /^Make/ });
const addBtn = () => screen.getByRole("button", { name: /add vehicle/i });
const priceInput = () => screen.getByPlaceholderText("What you paid");
const field = (label: string | RegExp) => screen.getByLabelText(label);
const saved = (onSave: jest.Mock) => onSave.mock.calls[0][0] as Vehicle;

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "doc-1", fileName: "cert.jpg", mimeType: "image/jpeg", sizeBytes: 9, previewUrl: null },
  });
  readRegoCertificate.mockResolvedValue(TRITON_CERT);
  readPurchaseInvoice.mockResolvedValue({ ok: true, cost: 45000, purchasedOn: "2024-03-15", supplier: "Sydney City Toyota" });
});

/* ---- the certificate ---- */

describe("adding a vehicle from its rego certificate", () => {
  it("reads the certificate into the form and files the first rego as a record, paper under it", async () => {
    const { user, onSave } = setup();
    await user.upload(field("Scan certificate"), new File(["x"], "cert.jpg", { type: "image/jpeg" }));

    await waitFor(() => expect(screen.getByText("Details read from the certificate — check the form before saving")).toBeInTheDocument());
    expect(plateInput()).toHaveValue("YLI59V");
    expect(makeSelect()).toHaveValue("Mitsubishi");
    expect(screen.getByPlaceholderText("e.g. Hiace ZR")).toHaveValue("Triton");
    expect(screen.getByPlaceholderText("17 characters on the certificate")).toHaveValue("MMAWLKL10NH035826");
    expect(screen.getByRole("combobox", { name: /body type/i })).toHaveValue("ute");
    expect(field("Rego expiry")).toHaveTextContent("29/09/2027");
    expect(screen.getByPlaceholderText("e.g. 1008")).toHaveValue(1008);
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "rego_notice");

    await user.click(addBtn());
    const v = saved(onSave);
    expect(v).toMatchObject({
      plate: "YLI59V",
      plateState: "NSW",
      make: "Mitsubishi",
      model: "Triton",
      variant: "MR4W30-",
      year: 2022,
      bodyType: "ute",
      vin: "MMAWLKL10NH035826",
      engineNumber: "4N15ULB0443",
      engineCapacityCc: 2442,
      seating: 4,
      tareKg: 2180,
      gvmKg: 2900,
      regoCustomerNo: "21970756",
      motorised: true,
      insuranceDays: null,
      ctpDays: null,
    });
    expect(v.regoDays).toBe(392); // 2 Sep 2026 → 29 Sep 2027
    const renewal = onSave.mock.calls[0][2] as Omit<RenewalInput, "vehicleId">;
    expect(renewal).toEqual({
      kind: "rego",
      expiresOn: "2027-09-29",
      startsOn: null,
      provider: "Transport for NSW",
      premium: 1008,
      termMonths: 12,
      documentId: "doc-1",
      source: "scan",
    });
  });

  it("never overwrites a plate the person has typed — the plate is what they are surest of", async () => {
    const { user } = setup();
    await user.type(plateInput(), "abc123");
    await user.upload(field("Scan certificate"), new File(["x"], "cert.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(makeSelect()).toHaveValue("Mitsubishi"));
    expect(plateInput()).toHaveValue("abc123");
  });

  it("files nothing and says so when Tiff can't read the certificate", async () => {
    readRegoCertificate.mockResolvedValue({ ok: false, reason: "no-key" });
    const { user, onSave } = setup();
    await user.upload(field("Scan certificate"), new File(["x"], "cert.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByText("Tiff couldn't read that one — fill the form in below.")).toBeInTheDocument());
    // the form is still there to fill, and the scan card offers again
    expect(screen.getByText("Scan or upload the rego certificate")).toBeInTheDocument();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await user.click(addBtn());
    expect(onSave.mock.calls[0][2]).toBeUndefined(); // no expiry, no record
  });

  it("types a first registration by hand as a manual record", async () => {
    const { user, onSave } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(addBtn());
    expect(onSave.mock.calls[0][2]).toMatchObject({ kind: "rego", expiresOn: "2026-09-29", source: "manual", documentId: undefined });
    expect(saved(onSave).regoDays).toBe(27);
  });
});

describe("editing a vehicle", () => {
  it("has no expiry fields — the dates are the card's — and keeps the vehicle's own", async () => {
    const { user, onSave } = setup(VAN);
    expect(screen.queryByLabelText("Rego expiry")).not.toBeInTheDocument();
    expect(screen.getByText(/managed on the vehicle's card/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(saved(onSave)).toMatchObject({ regoDays: 109, insuranceDays: 300, ctpDays: 300 });
    expect(onSave.mock.calls[0][2]).toBeUndefined();
  });

  it("scans a certificate to fill the specs without storing it, and points at Registration for the expiry", async () => {
    const { user, onSave } = setup(VAN);
    await user.upload(field("Scan certificate"), new File(["x"], "cert.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByPlaceholderText("17 characters on the certificate")).toHaveValue("MMAWLKL10NH035826"));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.getByText(/registration to 29 Sep 2027 — record that under Registration/)).toBeInTheDocument();
    // the typed plate stays; the specs land; the dates don't move
    expect(plateInput()).toHaveValue("EVD72G");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(saved(onSave)).toMatchObject({ vin: "MMAWLKL10NH035826", gvmKg: 2900, regoDays: 109 });
  });
});

/* ---- body type ---- */

it("a trailer has no engine: the engine, odometer and fuel-cycle fields go, ATM arrives, and it saves unmotorised", async () => {
  const { user, onSave } = setup();
  await user.type(plateInput(), "TC22BJ");
  await user.selectOptions(makeSelect(), "__not_listed__");
  await user.type(screen.getByLabelText("Make not listed"), "LG Chiv");
  expect(screen.getByPlaceholderText("e.g. 84120")).toBeInTheDocument(); // odometer, while it's a van
  await user.selectOptions(screen.getByRole("combobox", { name: /body type/i }), "trailer");
  expect(screen.queryByPlaceholderText("e.g. 84120")).not.toBeInTheDocument();
  expect(screen.queryByText("Engine no.")).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("e.g. 2000"), "2000");
  await user.click(addBtn());
  expect(saved(onSave)).toMatchObject({ bodyType: "trailer", motorised: false, atmKg: 2000, odometer: 0, serviceIntervalKm: null, engineCapacityCc: null });
});

/* ---- the make picker: the contracts the old form's tests pinned ---- */

describe("make", () => {
  it("cannot be typed into — Make is a picker", () => {
    setup();
    expect(makeSelect().tagName).toBe("SELECT");
    expect(screen.queryByPlaceholderText("e.g. Toyota")).not.toBeInTheDocument();
  });

  it("saves the list's spelling, not whatever case was clicked", async () => {
    const { user, onSave } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await user.click(addBtn());
    expect(saved(onSave).make).toBe("Toyota");
  });

  it("preselects the canonical row for a dirty spelling already in the register", async () => {
    const { user, onSave } = setup(VAN);
    expect(makeSelect()).toHaveValue("Toyota");
    expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(saved(onSave).make).toBe("Toyota");
  });

  it("takes a make no list will ever carry, once you say it is not listed", async () => {
    const { user, onSave } = setup();
    await user.type(plateInput(), "TC22BJ");
    expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();
    await user.selectOptions(makeSelect(), "__not_listed__");
    await user.type(screen.getByLabelText("Make not listed"), "LG Chiv");
    await user.click(addBtn());
    expect(saved(onSave).make).toBe("LG Chiv");
  });

  it("reopens an unlisted make in the text box instead of quietly rewriting it", () => {
    setup({ ...VAN, make: "LG Chiv" });
    expect(makeSelect()).toHaveValue("__not_listed__");
    expect(screen.getByLabelText("Make not listed")).toHaveValue("LG Chiv");
  });

  it("clears the previous pick, so 'not listed' can't save the make you abandoned", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    expect(addBtn()).toBeEnabled();
    await user.selectOptions(makeSelect(), "__not_listed__");
    expect(screen.getByLabelText("Make not listed")).toHaveValue("");
    expect(addBtn()).toBeDisabled();
  });
});

/* ---- the purchase invoice: the contracts the old form's tests pinned ---- */

describe("purchase invoice", () => {
  const attachButton = () => screen.getByRole("button", { name: /attach the invoice/i });
  const pickInvoice = (user: ReturnType<typeof userEvent.setup>) =>
    user.upload(field("Attach invoice"), new File(["pdf-bytes"], "tax-invoice.pdf", { type: "application/pdf" }));

  it("fills the price and date from the scan — the form is the confirm step", async () => {
    const { user } = setup();
    await pickInvoice(user);
    await waitFor(() => expect(priceInput()).toHaveValue(45000));
    expect(field("Purchase date")).toHaveTextContent("15/03/2024");
    expect(screen.getByText(/tax-invoice\.pdf/)).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "purchase_invoice");
  });

  it("hands the save the document id, so the action can adopt it", async () => {
    const { user, onSave } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(priceInput()).toHaveValue(45000));
    await user.click(addBtn());
    expect(onSave.mock.calls[0][1]).toBe("doc-1");
  });

  it("a failed scan still attaches the file — evidence beats extraction", async () => {
    readPurchaseInvoice.mockResolvedValue({ ok: false, reason: "read" });
    const { user, onSave } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(screen.getByText(/tax-invoice\.pdf/)).toBeInTheDocument());
    expect(priceInput()).toHaveValue(null);
    await user.click(addBtn());
    expect(onSave.mock.calls[0][1]).toBe("doc-1");
  });

  it("a failed upload attaches nothing and offers the button again", async () => {
    uploadFile.mockResolvedValue({ ok: false, error: "too big" });
    const { user, onSave } = setup();
    await user.type(plateInput(), "MKT482");
    await user.selectOptions(makeSelect(), "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(attachButton()).toBeEnabled());
    await user.click(addBtn());
    expect(onSave.mock.calls[0][1]).toBeUndefined();
  });

  it("scanned values do not overwrite what a failed field would keep", async () => {
    readPurchaseInvoice.mockResolvedValue({ ok: true, cost: null, purchasedOn: "2024-03-15", supplier: null });
    const { user } = setup();
    await user.type(priceInput(), "41000");
    await pickInvoice(user);
    await waitFor(() => expect(field("Purchase date")).toHaveTextContent("15/03/2024"));
    expect(priceInput()).toHaveValue(41000);
  });
});

/* ---- dates: still pickers, still the modal's Escape to lose ---- */

describe("dates", () => {
  it("takes no typed dates at all — every date field is a picker", () => {
    setup();
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
    for (const label of ["Rego expiry", "Purchase date", "Last service date"]) {
      expect(field(label).tagName).toBe("BUTTON");
      expect(field(label)).toHaveTextContent("dd/mm/yyyy");
    }
  });

  it("Escape shuts the calendar, not the form behind it", async () => {
    const { user, onClose } = setup();
    await user.click(field("Purchase date"));
    expect(screen.getAllByRole("dialog").length).toBeGreaterThan(1); // the calendar over the form
    await user.keyboard("{Escape}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("clears a date back to empty rather than stranding a wrong one", async () => {
    const { user } = setup();
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(field("Rego expiry")).toHaveTextContent("02/09/2026");
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(field("Rego expiry")).toHaveTextContent("dd/mm/yyyy");
  });
});
