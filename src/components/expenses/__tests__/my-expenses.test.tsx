import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyExpenses } from "../my-expenses";

/* THE CLAIMANT'S SCREEN — the half of expenses that had no test at all.

   Two gaps it was shipping with, both of which cost the person money or time:

   1. The file picker lived on the START SCREEN only, and unmounted the moment
      a draft existed. So "Enter it myself" committed you to a claim with no
      receipt on it, permanently, and the approver being asked for money had
      nothing to look at.
   2. The picker took photos only. The most common receipt for anything bought
      on account is the supplier's emailed PDF, which the documents bucket has
      always accepted — only this input was narrower. */

const readReceipt = jest.fn();
const submit = jest.fn();
const upload = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/expense-ai", () => ({
  readExpenseReceipt: (...a: unknown[]) => readReceipt(...a),
}));
jest.mock("@/app/actions/expenses", () => ({
  submitClaim: (...a: unknown[]) => submit(...a),
  cancelClaim: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => upload(...a),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const TODAY = "2026-08-05";
const draw = () => render(<MyExpenses claims={[]} today={TODAY} />);

/** The one hidden picker the whole screen shares. */
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;

const photo = () => new File(["x"], "docket.jpg", { type: "image/jpeg" });
const pdf = () => new File(["x"], "reece-invoice.pdf", { type: "application/pdf" });

beforeEach(() => {
  readReceipt.mockReset().mockResolvedValue({ ok: false, reason: "no-key" });
  submit.mockReset().mockResolvedValue({ ok: true });
  upload.mockReset().mockResolvedValue({ ok: true, file: { documentId: "doc-1" } });
  refresh.mockReset();
  // jsdom implements neither
  global.URL.createObjectURL = jest.fn(() => "blob:preview");
  global.URL.revokeObjectURL = jest.fn();
});

describe("attaching a receipt", () => {
  it("offers an attach control after Enter it myself", async () => {
    /* The regression in one line: this button did not exist, so a hand-typed
       claim could never carry its docket. */
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    expect(screen.getByText("No receipt attached")).toBeInTheDocument();
    expect(screen.getByText("Attach a receipt")).toBeInTheDocument();
  });

  it("keeps the picker mounted once a draft exists", async () => {
    // it used to live inside the start screen and unmount with it
    const user = userEvent.setup();
    draw();
    expect(picker()).not.toBeNull();
    await user.click(screen.getByText("Enter it myself"));
    expect(picker()).not.toBeNull();
  });

  it("does NOT re-scan what you attach from the form", async () => {
    /* The load-bearing rule. By this point the person has typed their own
       figures; reading the file would replace them with Tiff's, which is the
       one direction this screen must never move in. */
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    await user.type(screen.getByPlaceholderText("Copper fittings and flux"), "Brazing rods");

    await user.upload(picker(), photo());

    expect(readReceipt).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Copper fittings and flux")).toHaveValue("Brazing rods");
    expect(screen.getByText("Replace")).toBeInTheDocument();
  });

  it("sends the attached file with the claim", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    await user.type(screen.getByPlaceholderText("Copper fittings and flux"), "Brazing rods");
    await user.type(screen.getByPlaceholderText("0.00"), "48.90");
    await user.upload(picker(), photo());
    await user.click(screen.getByText("Send for approval"));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith(expect.any(File), "receipt");
    expect(submit.mock.calls[0][0]).toMatchObject({ documentIds: ["doc-1"] });
  });

  it("lets you take the receipt back off", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    await user.upload(picker(), photo());
    await user.click(screen.getByText("Remove"));
    expect(screen.getByText("No receipt attached")).toBeInTheDocument();
  });
});

describe("PDFs", () => {
  it("are offered by the picker", () => {
    // the bucket always took them; only this input was narrower
    draw();
    expect(picker().accept).toContain("application/pdf");
  });

  it("are named rather than previewed", async () => {
    // there is no thumbnail to draw, and an <img> pointed at a PDF is a broken
    // image icon where the receipt should be
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    await user.upload(picker(), pdf());

    expect(screen.getByText("reece-invoice.pdf")).toBeInTheDocument();
    expect(document.querySelector(".xc-prev")).toBeNull();
    expect(global.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("are scanned like any other receipt from the start screen", async () => {
    readReceipt.mockResolvedValue({
      ok: true,
      total: 214.5,
      gst: 19.5,
      supplier: "Reece",
      date: "2026-08-01",
      description: "Copper fittings",
      category: "materials",
    });
    const user = userEvent.setup();
    draw();
    await user.upload(picker(), pdf());

    await waitFor(() => expect(readReceipt).toHaveBeenCalled());
    expect(readReceipt.mock.calls[0][1]).toBe("application/pdf");
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Copper fittings and flux")).toHaveValue("Copper fittings"),
    );
    expect(screen.getByPlaceholderText("Reece")).toHaveValue("Reece");
  });
});

describe("provenance", () => {
  /* A claim raised by "Log fuel · my own money" is one the person never
     filled in. Without a line saying where it came from it reads as a
     mystery charge on their own claims list. */
  const fuelClaim = {
    id: "c-fuel",
    staffProfileId: "me",
    expenseDate: "2026-08-01",
    description: "Fuel — BP Kingsford",
    category: "fuel" as const,
    amount: 158.4,
    gstAmount: 14.4,
    supplier: "BP Kingsford",
    status: "pending" as const,
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    fuelLog: { vehicleLogId: "log-1", vehicle: "Hilux" },
  };

  it("says a claim came from a fuel log, and names the vehicle", () => {
    render(<MyExpenses claims={[fuelClaim]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log · Hilux/)).toBeInTheDocument();
  });

  it("still says it when the vehicle has no name to show", () => {
    render(<MyExpenses claims={[{ ...fuelClaim, fuelLog: { vehicleLogId: "log-1", vehicle: null } }]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log/)).toBeInTheDocument();
  });

  it("says nothing on a claim somebody typed themselves", () => {
    render(<MyExpenses claims={[{ ...fuelClaim, fuelLog: null }]} today={TODAY} />);
    expect(screen.queryByText(/Raised from your fuel log/)).toBeNull();
  });
});

describe("object URLs", () => {
  it("releases the old preview when the receipt is replaced", async () => {
    // every abandoned preview otherwise stays alive for the life of the page
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByText("Enter it myself"));
    await user.upload(picker(), photo());
    await user.upload(picker(), new File(["y"], "second.png", { type: "image/png" }));
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
