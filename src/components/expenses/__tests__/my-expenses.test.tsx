import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyExpenses } from "../my-expenses";
import type { Claim } from "@/lib/expenses/claim";

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
const cancel = jest.fn(async (_id: string) => ({ ok: true }));
const upload = jest.fn();
const refresh = jest.fn();

jest.mock("@/app/actions/expense-ai", () => ({
  readExpenseReceipt: (...a: unknown[]) => readReceipt(...a),
}));
jest.mock("@/app/actions/expenses", () => ({
  submitClaim: (...a: unknown[]) => submit(...a),
  cancelClaim: (id: string) => cancel(id),
}));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => upload(...a),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));

const TODAY = "2026-08-05";

/** A claim, with only what a given test cares about spelled out. */
const claim = (over: Partial<Claim> = {}): Claim =>
  ({
    id: "c1",
    staffProfileId: "me",
    expenseDate: "2026-08-01",
    description: "Copper fittings",
    category: "materials",
    amount: 184.5,
    gstAmount: 16.77,
    supplier: "Reece",
    status: "pending",
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    receipts: [],
    ...over,
  }) as Claim;
const draw = () => render(<MyExpenses claims={[]} today={TODAY} />);

/** The one hidden picker the whole screen shares. */
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;

const photo = () => new File(["x"], "docket.jpg", { type: "image/jpeg" });
const pdf = () => new File(["x"], "reece-invoice.pdf", { type: "application/pdf" });

beforeEach(() => {
  readReceipt.mockReset().mockResolvedValue({ ok: false, reason: "no-key" });
  submit.mockReset().mockResolvedValue({ ok: true });
  cancel.mockReset().mockResolvedValue({ ok: true });
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

/* ---------------- the 2026-08 audit ---------------- */

describe("what the claimant is told", () => {
  /* THE FIGURE THE APPROVER ALWAYS HAD. `owedTotal` counts pending plus
     approved-but-unpaid, and it was on the review queue and the Time & Pay
     stat tile — every screen except the one belonging to the person who is
     out of pocket, who got a list and was left to add it up. */
  it("totals what it owes you, using the same helper the approver's screen uses", () => {
    const { container } = render(
      <MyExpenses
        today={TODAY}
        claims={[
          claim({ id: "a", amount: 184.5, status: "pending" }),
          claim({ id: "b", amount: 62, status: "approved" }),
          // already paid — not owed, so not counted
          claim({ id: "c", amount: 500, status: "reimbursed" }),
        ]}
      />,
    );
    const owed = container.querySelector(".xc-owed")!;
    expect(within(owed as HTMLElement).getByText("$246.50")).toBeInTheDocument();
  });

  it("says nothing when nothing is owed", () => {
    const { container } = render(
      <MyExpenses today={TODAY} claims={[claim({ status: "reimbursed" })]} />,
    );
    expect(container.querySelector(".xc-owed")).toBeNull();
  });

  /* The approver's row has always said "No receipt" and called it a judgement
     call. The claimant's row said nothing — so a person was told a docket is
     "what gets approved without a conversation" while filling the form, and
     never told again whether theirs had one. */
  it("says when a claim has no receipt, the way the review screen does", () => {
    render(<MyExpenses today={TODAY} claims={[claim({ receipts: [] })]} />);
    expect(screen.getByText("No receipt")).toBeInTheDocument();
  });

  it("drops the nag once the claim is settled", () => {
    // a reimbursed claim's missing docket is history, not a thing to chase
    render(<MyExpenses today={TODAY} claims={[claim({ status: "reimbursed", receipts: [] })]} />);
    expect(screen.queryByText("No receipt")).toBeNull();
  });

  it("links the receipt when there is one, instead", () => {
    render(
      <MyExpenses
        today={TODAY}
        claims={[claim({ receipts: [{ url: "https://x/r.jpg", image: true }] })]}
      />,
    );
    expect(screen.getByRole("link", { name: "Receipt" })).toBeInTheDocument();
    expect(screen.queryByText("No receipt")).toBeNull();
  });
});

describe("cancelling a claim", () => {
  /* ARMS BEFORE IT FIRES — the protocol My leave uses on its own Cancel, for
     the same reason. This discards a claim for money you are owed (an APPROVED
     one, at that) and strands the receipt with it. One press did it. */
  it("asks first, then goes through on the second press", async () => {
    const user = userEvent.setup();
    render(<MyExpenses today={TODAY} claims={[claim({ id: "c9", status: "pending" })]} />);

    await user.click(screen.getByRole("button", { name: /^Cancel / }));
    expect(cancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Confirm cancelling/ }));
    expect(cancel).toHaveBeenCalledWith("c9");
  });
});

describe("the claim form", () => {
  /* The form knew. "Send for approval" was enabled on a completely empty
     draft, so the first thing back was a round trip and "Say what the expense
     was for" — something the button could see before it was pressed. */
  it("holds Send until it has the two things a claim cannot be without", async () => {
    const user = userEvent.setup();
    render(<MyExpenses today={TODAY} claims={[]} />);
    await user.click(screen.getByRole("button", { name: /Enter it myself/ }));

    const send = () => screen.getByRole("button", { name: /Send for approval/ });
    expect(send()).toBeDisabled();
    expect(screen.getByText("Say what it was for")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Copper fittings and flux"), "Fittings");
    expect(send()).toBeDisabled();
    expect(screen.getByText("Add how much it cost")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("0.00"), "45");
    expect(send()).toBeEnabled();
  });

  /* "Every date in HeyTiff is picked, never typed" — date-field.tsx. A raw
     `<input type="date">` renders the browser's own control and, on a phone,
     answers dd/mm vs mm/dd in whatever the OS locale says. On a form whose
     date decides which BAS period a GST figure lands in. */
  it("picks the date with the app's calendar, never a native date input", async () => {
    const user = userEvent.setup();
    const { container } = render(<MyExpenses today={TODAY} claims={[]} />);
    await user.click(screen.getByRole("button", { name: /Enter it myself/ }));

    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector(".datef")).not.toBeNull();
  });
});

/* THE CARD'S TWO FACES. Answered claims — reimbursed, declined, cancelled —
   used to pad the one list forever; they live behind the Closed tab now, and
   the Claims tab counts only what is still moving. */
describe("the Claims / Closed split", () => {
  it("keeps open claims on Claims and answered ones behind Closed", async () => {
    const user = userEvent.setup();
    render(
      <MyExpenses
        today={TODAY}
        claims={[
          claim({ id: "open-1", description: "Brazing rods", status: "pending" }),
          claim({ id: "done-1", description: "Old drill", status: "reimbursed" }),
        ]}
      />,
    );

    expect(screen.getByText("Brazing rods")).toBeInTheDocument();
    expect(screen.queryByText("Old drill")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(screen.getByText("Old drill")).toBeInTheDocument();
    expect(screen.queryByText("Brazing rods")).not.toBeInTheDocument();
    // the capture banner is the working face's, not history's
    expect(screen.queryByText("Claim something you paid for")).not.toBeInTheDocument();
  });
});
