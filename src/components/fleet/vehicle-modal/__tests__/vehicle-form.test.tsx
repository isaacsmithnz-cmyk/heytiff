import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenewalInput } from "@/app/actions/fleet";
import { WindowsContext } from "@/components/records/records-context";
import type { Vehicle } from "../../logic";
import { VehicleForm } from "../vehicle-form";

/* Add a vehicle (forms 8a and 8) and a vehicle's Edit details. The contracts
   today's form had, kept: the form opens on the rego certificate and today's
   reader fills it; a vehicle added that way arrives with its first rego filed
   as a record, the certificate under it; the make is picked, not typed; the
   purchase invoice attaches even when the read fails; every date is a
   picker. And v2's: saving is today's saveVehicle, the form closes where you
   were, and the toast's Undo takes the save back. */

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

const saveVehicle = jest.fn();
const removeVehicle = jest.fn();
jest.mock("@/app/actions/fleet", () => ({
  saveVehicle: (...a: unknown[]) => saveVehicle(...a),
  removeVehicle: (...a: unknown[]) => removeVehicle(...a),
}));

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

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

const toast = jest.fn();

function setup(initial: Vehicle | null = null, onSaved?: (id: string) => void) {
  const onClose = jest.fn();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <VehicleForm initial={initial} staff={[]} today={TODAY} onClose={onClose} onSaved={onSaved} />
    </WindowsContext.Provider>,
  );
  return { onClose, user: userEvent.setup() };
}

const plateInput = () => screen.getByLabelText("Rego plate");
const makeChooser = () => screen.getByRole("combobox", { name: /^Make$/ });
const addBtn = () => screen.getByRole("button", { name: "Add vehicle" });
const priceInput = () => screen.getByLabelText("Purchase price");
const field = (label: string | RegExp) => screen.getByLabelText(label);
const saved = () => saveVehicle.mock.calls[0][0] as Vehicle;
const chosenIn = (group: string) =>
  within(screen.getByRole("radiogroup", { name: group }))
    .getAllByRole("radio")
    .find((r) => r.getAttribute("aria-checked") === "true")?.textContent ?? null;

async function pickMake(user: ReturnType<typeof userEvent.setup>, make: string) {
  await user.click(makeChooser());
  await user.click(screen.getByRole("option", { name: make }));
}
const upload = (user: ReturnType<typeof userEvent.setup>, name = "cert.jpg") =>
  user.upload(field("Scan certificate"), new File(["x"], name, { type: "image/jpeg" }));

beforeEach(() => {
  jest.clearAllMocks();
  uploadFile.mockResolvedValue({
    ok: true,
    file: { documentId: "doc-1", fileName: "cert.jpg", mimeType: "image/jpeg", sizeBytes: 9, previewUrl: null },
  });
  readRegoCertificate.mockResolvedValue(TRITON_CERT);
  readPurchaseInvoice.mockResolvedValue({ ok: true, cost: 45000, purchasedOn: "2024-03-15", supplier: "Sydney City Toyota" });
  saveVehicle.mockResolvedValue({ ok: true, id: "v-new" });
  removeVehicle.mockResolvedValue({ ok: true });
});

/* ---- the certificate ---- */

describe("adding a vehicle from its rego certificate", () => {
  it("opens on the certificate: drop it, photograph it or choose it", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Add a vehicle" })).toBeInTheDocument();
    expect(screen.getByText("Drop the rego certificate here, a photo or a PDF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeInTheDocument();
    expect(field("Photograph certificate")).toHaveAttribute("capture", "environment");
  });

  it("reads a dropped certificate too", async () => {
    setup();
    const box = screen.getByText("Drop the rego certificate here, a photo or a PDF").parentElement as HTMLElement;
    fireEvent.drop(box, { dataTransfer: { files: [new File(["x"], "cert.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(plateInput()).toHaveValue("YLI59V"));
    expect(screen.getByText("PDF, 1 KB. Read into the form.")).toBeInTheDocument();
  });

  it("reads the certificate into every section, then files the first rego as a record, paper under it", async () => {
    const { user, onClose } = setup();
    await upload(user);

    await waitFor(() => expect(screen.getByText("Photo, 1 KB. Read into the form.")).toBeInTheDocument());
    expect(plateInput()).toHaveValue("YLI59V");
    expect(makeChooser()).toHaveTextContent("Mitsubishi");
    expect(field("Registered in")).toHaveTextContent("NSW");
    expect(field("Model")).toHaveValue("Triton");
    expect(field("VIN or chassis")).toHaveValue("MMAWLKL10NH035826");
    expect(chosenIn("Body type")).toBe("Ute");
    expect(field("Rego expiry")).toHaveTextContent("29/09/2027");
    expect(field("Amount paid")).toHaveValue(1008);
    expect(field("Issued by")).toHaveValue("Transport for NSW");
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "rego_notice");

    await user.click(addBtn());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved()).toMatchObject({
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
    expect(saved().regoDays).toBe(392); // 2 Sep 2026 → 29 Sep 2027
    const renewal = saveVehicle.mock.calls[0][2] as Omit<RenewalInput, "vehicleId">;
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

  it("shows the reader at work, the way the expense claim's does", async () => {
    let finish: (v: unknown) => void = () => {};
    readRegoCertificate.mockReturnValue(new Promise((r) => (finish = r)));
    const { user } = setup();
    await upload(user);
    const reading = await screen.findByRole("status");
    expect(reading).toHaveTextContent("Reading cert.jpg");
    expect(reading.querySelectorAll(".mk-records-bar")).toHaveLength(3);
    finish(TRITON_CERT);
    await waitFor(() => expect(plateInput()).toHaveValue("YLI59V"));
  });

  it("never overwrites a plate the person has typed — the plate is what they are surest of", async () => {
    const { user } = setup();
    await user.type(plateInput(), "abc123");
    await upload(user);
    await waitFor(() => expect(makeChooser()).toHaveTextContent("Mitsubishi"));
    expect(plateInput()).toHaveValue("abc123");
  });

  it("keeps a certificate Tiff can't read, and files it under the first rego record typed by hand", async () => {
    readRegoCertificate.mockResolvedValue({ ok: false, reason: "no-key" });
    const { user } = setup();
    await upload(user);
    await waitFor(() => expect(screen.getByText("Tiff couldn't read that one. Fill the form in below.")).toBeInTheDocument());
    expect(screen.getByText("Photo, 1 KB. Kept for the first rego record.")).toBeInTheDocument();
    expect(plateInput()).toHaveValue(""); // nothing read, nothing filled
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(addBtn());
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "rego_notice");
    expect(saveVehicle.mock.calls[0][2]).toEqual({
      kind: "rego",
      expiresOn: "2026-09-29",
      startsOn: null,
      provider: null,
      premium: null,
      termMonths: 12,
      documentId: "doc-1",
      source: "manual",
    });
  });

  it("asks for the expiry while it holds a certificate, and Scan another lets go of both", async () => {
    readRegoCertificate.mockResolvedValue({ ok: false, reason: "read" });
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await upload(user);
    await waitFor(() => expect(screen.getByText("Photo, 1 KB. Kept for the first rego record.")).toBeInTheDocument());

    // the paper's only home is a rego record, and a rego record is its expiry
    await user.click(addBtn());
    expect(saveVehicle).not.toHaveBeenCalled();
    expect(screen.getByText("The certificate is filed under the first rego, so give its expiry.")).toBeInTheDocument();
    expect(field("Rego expiry")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Scan another" }));
    expect(screen.getByText("Drop the rego certificate here, a photo or a PDF")).toBeInTheDocument();
    expect(screen.queryByText("Tiff couldn't read that one. Fill the form in below.")).not.toBeInTheDocument();
    expect(screen.queryByText("The certificate is filed under the first rego, so give its expiry.")).not.toBeInTheDocument();
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][2]).toBeUndefined(); // no expiry, nothing held, no record
  });

  it("asks for the expiry when the read found none, then files the certificate as scanned", async () => {
    readRegoCertificate.mockResolvedValue({ ...TRITON_CERT, expiresOn: null });
    const { user } = setup();
    await upload(user);
    await waitFor(() => expect(makeChooser()).toHaveTextContent("Mitsubishi"));
    await user.click(addBtn());
    expect(saveVehicle).not.toHaveBeenCalled();
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][2]).toMatchObject({ expiresOn: "2026-09-29", documentId: "doc-1", source: "scan" });
  });

  it("files nothing when neither the read nor the upload lands, and offers the scan again", async () => {
    uploadFile.mockResolvedValue({ ok: false, error: "too big" });
    readRegoCertificate.mockResolvedValue({ ok: false, reason: "no-key" });
    const { user } = setup();
    await upload(user);
    await waitFor(() =>
      expect(screen.getByText("The certificate couldn't be stored, so the details will save without it.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Drop the rego certificate here, a photo or a PDF")).toBeInTheDocument();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][2]).toBeUndefined(); // no expiry, no record
  });

  it("survives Escape and the scrim while the certificate is read or held; Cancel still closes", async () => {
    let finish: (v: unknown) => void = () => {};
    readRegoCertificate.mockReturnValue(new Promise((r) => (finish = r)));
    const { user, onClose } = setup();
    await upload(user);
    await screen.findByText("Reading cert.jpg");
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    finish({ ok: false, reason: "read" });
    await screen.findByText("cert.jpg");
    await user.keyboard("{Escape}");
    const scrim = document.querySelector(".pt-scrim") as HTMLElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("types a first registration by hand as a manual record", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][2]).toMatchObject({ kind: "rego", expiresOn: "2026-09-29", source: "manual", documentId: undefined });
    expect(saved().regoDays).toBe(27);
  });

  it("keeps the term the tray says", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(field("Rego expiry"));
    await user.click(screen.getByRole("button", { name: "Tuesday 29 September 2026" }));
    await user.click(screen.getByRole("radio", { name: "6 months" }));
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][2]).toMatchObject({ termMonths: 6 });
  });
});

/* ---- saving: rule 51 ---- */

describe("saving keeps you where you were", () => {
  it("says the plate is missing on the field, and saves nothing", async () => {
    const { user } = setup();
    await pickMake(user, "Toyota");
    await user.click(addBtn());
    expect(saveVehicle).not.toHaveBeenCalled();
    expect(screen.getByText("Give the rego plate.")).toBeInTheDocument();
    expect(plateInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("toasts the new vehicle, and Undo takes it back out as Remove vehicle does", async () => {
    const { user, onClose } = setup();
    await user.type(plateInput(), "mkt482");
    await pickMake(user, "Toyota");
    await user.click(addBtn());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("MKT482 added", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(removeVehicle).toHaveBeenCalledWith("v-new");
  });

  it("keeps the form open with the action's refusal, and nothing toasted", async () => {
    saveVehicle.mockResolvedValue({ ok: false, error: "MKT482 is already registered in this fleet." });
    const { user, onClose } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(addBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("MKT482 is already registered in this fleet.");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("editing a vehicle (its page's Edit details)", () => {
  it("opens filled in, has no expiry fields — the dates are the vehicle's records — and keeps its own", async () => {
    const onSaved = jest.fn();
    const { user, onClose } = setup(VAN, onSaved);
    expect(screen.getByRole("dialog", { name: "Edit ZUCKY" })).toBeInTheDocument();
    expect(plateInput()).toHaveValue("EVD72G");
    expect(field("Model")).toHaveValue("Hiace");
    expect(field("Odometer (km)")).toHaveValue(55500);
    expect(screen.queryByLabelText("Rego expiry")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved()).toMatchObject({ id: "v1", regoDays: 109, insuranceDays: 300, ctpDays: 300 });
    expect(saveVehicle.mock.calls[0][2]).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith("v-new");
  });

  it("Undo puts the vehicle back as it was opened", async () => {
    const { user } = setup(VAN);
    await user.clear(field("Model"));
    await user.type(field("Model"), "Hiace ZR");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("EVD72G saved", expect.any(Function)));
    expect(saved().model).toBe("Hiace ZR");
    await toast.mock.calls[0][1]();
    expect(saveVehicle).toHaveBeenLastCalledWith(VAN);
    expect(removeVehicle).not.toHaveBeenCalled();
  });

  it("scans a certificate to fill the specs without storing it, and points at Registration for the expiry", async () => {
    const { user } = setup(VAN);
    await upload(user);
    await waitFor(() => expect(field("VIN or chassis")).toHaveValue("MMAWLKL10NH035826"));
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.getByText(/registration to 29 Sep 2027\. Record that under Registration/)).toBeInTheDocument();
    // the typed plate stays; the specs land; the dates don't move
    expect(plateInput()).toHaveValue("EVD72G");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(saved()).toMatchObject({ vin: "MMAWLKL10NH035826", gvmKg: 2900, regoDays: 109 });
  });
});

/* ---- body type ---- */

it("a trailer has no engine: the engine, odometer and fuel-cycle fields go, ATM arrives, and it saves unmotorised", async () => {
  const { user } = setup();
  await user.type(plateInput(), "TC22BJ");
  await pickMake(user, "Not listed");
  await user.type(screen.getByLabelText("Make not listed"), "LG Chiv");
  expect(screen.getByLabelText("Odometer (km)")).toBeInTheDocument(); // while it's a van
  expect(screen.queryByLabelText("ATM (kg)")).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Trailer" }));
  expect(screen.queryByLabelText("Odometer (km)")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Engine number")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Towed by")).toBeInTheDocument();
  await user.type(screen.getByLabelText("ATM (kg)"), "2000");
  await user.click(addBtn());
  expect(saved()).toMatchObject({ bodyType: "trailer", motorised: false, atmKg: 2000, odometer: 0, serviceIntervalKm: null, engineCapacityCc: null });
});

/* ---- the make picker: the contracts the old form's tests pinned ---- */

describe("make", () => {
  it("cannot be typed into — Make is a chooser", () => {
    setup();
    expect(makeChooser().tagName).toBe("BUTTON");
    expect(makeChooser()).toHaveTextContent("Pick a make");
    expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();
  });

  it("saves the list's spelling, not whatever case was clicked", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await user.click(addBtn());
    expect(saved().make).toBe("Toyota");
  });

  it("preselects the canonical row for a dirty spelling already in the register", async () => {
    const { user } = setup(VAN);
    expect(makeChooser()).toHaveTextContent("Toyota");
    expect(screen.queryByLabelText("Make not listed")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(saved().make).toBe("Toyota");
  });

  it("takes a make no list will ever carry, once you say it is not listed", async () => {
    const { user } = setup();
    await user.type(plateInput(), "TC22BJ");
    await pickMake(user, "Not listed");
    await user.type(screen.getByLabelText("Make not listed"), "LG Chiv");
    await user.click(addBtn());
    expect(saved().make).toBe("LG Chiv");
  });

  it("reopens an unlisted make in the text box instead of quietly rewriting it", () => {
    setup({ ...VAN, make: "LG Chiv" });
    expect(makeChooser()).toHaveTextContent("Not listed");
    expect(screen.getByLabelText("Make not listed")).toHaveValue("LG Chiv");
  });

  it("clears the previous pick, so 'not listed' can't save the make you abandoned", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await pickMake(user, "Not listed");
    expect(screen.getByLabelText("Make not listed")).toHaveValue("");
    await user.click(addBtn());
    expect(saveVehicle).not.toHaveBeenCalled();
    expect(screen.getByText("Type the make.")).toBeInTheDocument();
  });
});

/* ---- the purchase invoice: the contracts the old form's tests pinned ---- */

describe("purchase invoice", () => {
  const attachButton = () => screen.getByRole("button", { name: "Attach invoice" });
  const pickInvoice = (user: ReturnType<typeof userEvent.setup>) =>
    user.upload(field("Attach invoice"), new File(["pdf-bytes"], "tax-invoice.pdf", { type: "application/pdf" }));

  it("fills the price and date from the scan — the form is the confirm step", async () => {
    const { user } = setup();
    await pickInvoice(user);
    await waitFor(() => expect(priceInput()).toHaveValue(45000));
    expect(field("Purchase date")).toHaveTextContent("15/03/2024");
    expect(field("Supplier")).toHaveValue("Sydney City Toyota");
    expect(screen.getByText("tax-invoice.pdf")).toBeInTheDocument();
    expect(screen.getByText(/^PDF, 1 KB\. Read: \$45,000/)).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledWith(expect.anything(), "purchase_invoice");
  });

  it("hands the save the document id, so the action can adopt it", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(priceInput()).toHaveValue(45000));
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][1]).toBe("doc-1");
  });

  it("a failed scan still attaches the file — evidence beats extraction", async () => {
    readPurchaseInvoice.mockResolvedValue({ ok: false, reason: "read" });
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(screen.getByText("tax-invoice.pdf")).toBeInTheDocument());
    expect(priceInput()).toHaveValue(null);
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][1]).toBe("doc-1");
  });

  it("Remove lets the invoice go, and the save carries none", async () => {
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(screen.getByText("tax-invoice.pdf")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(attachButton()).toBeEnabled();
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][1]).toBeUndefined();
  });

  it("a failed upload attaches nothing and offers the button again", async () => {
    uploadFile.mockResolvedValue({ ok: false, error: "too big" });
    const { user } = setup();
    await user.type(plateInput(), "MKT482");
    await pickMake(user, "Toyota");
    await pickInvoice(user);
    await waitFor(() => expect(attachButton()).toBeEnabled());
    await user.click(addBtn());
    expect(saveVehicle.mock.calls[0][1]).toBeUndefined();
  });

  it("scanned values do not overwrite what a failed field would keep", async () => {
    readPurchaseInvoice.mockResolvedValue({ ok: true, cost: null, purchasedOn: "2024-03-15", supplier: null });
    const { user } = setup();
    await user.type(priceInput(), "41000");
    await pickInvoice(user);
    await waitFor(() => expect(field("Purchase date")).toHaveTextContent("15/03/2024"));
    expect(priceInput()).toHaveValue(41000);
  });

  it("survives Escape and the scrim while the invoice is read or attached; Cancel still closes", async () => {
    let finish: (v: unknown) => void = () => {};
    readPurchaseInvoice.mockReturnValue(new Promise((r) => (finish = r)));
    const { user, onClose } = setup();
    await pickInvoice(user);
    await screen.findByRole("button", { name: "Reading tax-invoice.pdf" });
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    finish({ ok: false, reason: "read" });
    await screen.findByText("tax-invoice.pdf");
    await user.keyboard("{Escape}");
    const scrim = document.querySelector(".pt-scrim") as HTMLElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ---- dates: still pickers, still the form's Escape to lose ---- */

describe("dates", () => {
  it("takes no typed dates at all — every date field is a picker", () => {
    setup();
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
    for (const label of ["Rego expiry", "Purchase date", "Last service date"]) {
      expect(field(label).tagName).toBe("BUTTON");
      expect(field(label)).toHaveTextContent("No date");
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
    expect(field("Rego expiry")).toHaveTextContent("No date");
  });
});
