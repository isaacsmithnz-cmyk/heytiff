import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyExpensesFace } from "../my-expenses-face";
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
    paidWith: "own",
    job: null,
    status: "pending",
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    receipts: [],
    ...over,
  }) as Claim;
const draw = () => render(<MyExpensesFace claims={[]} today={TODAY} />);

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
    paidWith: "own" as const,
    job: null,
    status: "pending" as const,
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00Z",
    fuelLog: { vehicleLogId: "log-1", vehicle: "Hilux" },
  };

  it("says a claim came from a fuel log, and names the vehicle", () => {
    render(<MyExpensesFace claims={[fuelClaim]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log · Hilux/)).toBeInTheDocument();
  });

  it("still says it when the vehicle has no name to show", () => {
    render(<MyExpensesFace claims={[{ ...fuelClaim, fuelLog: { vehicleLogId: "log-1", vehicle: null } }]} today={TODAY} />);
    expect(screen.getByText(/Raised from your fuel log/)).toBeInTheDocument();
  });

  it("says nothing on a claim somebody typed themselves", () => {
    render(<MyExpensesFace claims={[{ ...fuelClaim, fuelLog: null }]} today={TODAY} />);
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
      <MyExpensesFace
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
      <MyExpensesFace today={TODAY} claims={[claim({ status: "reimbursed" })]} />,
    );
    expect(container.querySelector(".xc-owed")).toBeNull();
  });

  /* The approver's row has always said "No receipt" and called it a judgement
     call. The claimant's row said nothing — so a person was told a docket is
     "what gets approved without a conversation" while filling the form, and
     never told again whether theirs had one. */
  it("says when a claim has no receipt, the way the review screen does", () => {
    render(<MyExpensesFace today={TODAY} claims={[claim({ receipts: [] })]} />);
    expect(screen.getByText("No receipt")).toBeInTheDocument();
  });

  it("drops the nag once the claim is settled", () => {
    // a reimbursed claim's missing docket is history, not a thing to chase
    render(<MyExpensesFace today={TODAY} claims={[claim({ status: "reimbursed", receipts: [] })]} />);
    expect(screen.queryByText("No receipt")).toBeNull();
  });

  it("links the receipt when there is one, instead", () => {
    render(
      <MyExpensesFace
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
    render(<MyExpensesFace today={TODAY} claims={[claim({ id: "c9", status: "pending" })]} />);

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
    render(<MyExpensesFace today={TODAY} claims={[]} />);
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
    const { container } = render(<MyExpensesFace today={TODAY} claims={[]} />);
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
      <MyExpensesFace
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

/* THE PANEL SWAPS IN PLACE — no remount, no fade. `key={tab}` + `.psec2`
   rebuilt the claim list and faded it in on every switch; Team's directory
   just changes its children (Isaac, 2026-08-22). */
describe("the panel does not animate on a switch", () => {
  it("keeps the same panel node, with no fade class", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MyExpensesFace
        today={TODAY}
        claims={[claim({ id: "o1", status: "pending" }), claim({ id: "d1", status: "reimbursed" })]}
      />,
    );
    const panel = () => container.querySelector('[role="tabpanel"]');

    const before = panel();
    expect(before).not.toHaveClass("psec2");

    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(panel()).toBe(before);
    expect(panel()).not.toHaveClass("psec2");
  });
});

/* ── the company card ─────────────────────────────────────────────────────

   The screen was reimbursement-only: a staff member who bought a drill on the
   company card had nowhere to put the docket, and Xero would see a card
   transaction off the bank feed with no receipt, no description and no
   category against it (Isaac, 2026-08-23). What these pin is the half of that
   fix the screen owns — that the two kinds never mix, and that the button
   never says the wrong thing about what pressing it does. */

describe("company-card receipts", () => {
  const card = (over: Partial<Claim> = {}) =>
    claim({ id: "cc1", paidWith: "company", status: "recorded", description: "Makita drill", ...over });

  it("keeps card receipts off Claims and Closed entirely", async () => {
    const user = userEvent.setup();
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[card(), claim({ id: "o1", status: "pending", description: "Copper fittings" })]}
      />,
    );
    // Claims is money you are owed — a filed docket is not that
    expect(screen.queryByText("Makita drill")).not.toBeInTheDocument();
    expect(screen.getByText("Copper fittings")).toBeInTheDocument();

    /* And NOT in Closed either. Closed is reimbursed / declined / cancelled —
       the pile you read when something went wrong — and nothing went wrong
       with a receipt somebody filed. */
    await user.click(screen.getByRole("tab", { name: /Closed/ }));
    expect(screen.queryByText("Makita drill")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    expect(screen.getByText("Makita drill")).toBeInTheDocument();
    expect(screen.queryByText("Copper fittings")).not.toBeInTheDocument();
  });

  /* THE OPEN COUNT IS PEOPLE WAITING ON MONEY. A card receipt is nobody
     waiting on anything, so it must not inflate the badge that says how many
     claims are still live. */
  it("does not count a card receipt as an open claim", () => {
    render(<MyExpensesFace today={TODAY} claims={[card(), card({ id: "cc2" })]} />);
    expect(screen.queryByRole("tab", { name: /Claims — / })).not.toBeInTheDocument();
  });

  it("says what pressing the button will do, on each side", async () => {
    const user = userEvent.setup();
    render(<MyExpensesFace today={TODAY} claims={[]} />);

    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.getByRole("button", { name: "Send for approval" })).toBeInTheDocument();

    /* Flipping the payer inside the form flips the promise with it — the
       control exists precisely so somebody who came through the wrong door
       can fix it without losing what they typed. */
    await user.click(screen.getByRole("radio", { name: "Company card" }));
    expect(screen.getByRole("button", { name: "Save the receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send for approval" })).not.toBeInTheDocument();
  });

  it("starts a draft on the payer of the face you came from", async () => {
    const user = userEvent.setup();
    render(<MyExpensesFace today={TODAY} claims={[]} />);
    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.getByRole("radio", { name: "Company card" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: "Save the receipt" })).toBeInTheDocument();
  });

  /* WHAT THE SERVER IS ACTUALLY TOLD. Everything above is copy; this is the
     field that decides whether the business is asked for money. */
  it("sends the payer through to the server", async () => {
    const user = userEvent.setup();
    submit.mockResolvedValue({ ok: true });
    render(<MyExpensesFace today={TODAY} claims={[]} />);

    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.type(screen.getByLabelText(/What was it for/i), "Makita drill");
    await user.type(screen.getByLabelText(/Total paid/i), "289");
    await user.click(screen.getByRole("button", { name: "Save the receipt" }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ paidWith: "company" })),
    );
  });
});

/* OWED IS A CLAIMS FACT. Over a list of company dockets it is a figure about
   somewhere else entirely — and the one thing that face has to say is that
   nobody owes anybody anything. */
it("keeps the owed figure off the company-card face", async () => {
  const user = userEvent.setup();
  render(
    <MyExpensesFace
      today={TODAY}
      claims={[
        claim({ id: "o1", status: "pending", amount: 184.5 }),
        claim({ id: "cc1", paidWith: "company", status: "recorded", amount: 289 }),
      ]}
    />,
  );
  expect(screen.getByText("Owed to you")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: /Company card/ }));
  expect(screen.queryByText("Owed to you")).not.toBeInTheDocument();
});

/* ── which job ────────────────────────────────────────────────────────────

   A receipt for a job is a cost on that job, and the app knew it for the two
   seconds somebody was holding the docket. Optional, and it stays optional —
   a new drill is the van's, not Tuesday's. */

describe("attaching a receipt to a job", () => {
  const jobs = [
    {
      kind: "visit" as const,
      id: "v1",
      clientName: "Northgate Realty",
      label: "Quarterly service",
      siteLabel: null,
      jobNumber: "1042",
    },
    {
      kind: "project" as const,
      id: "p1",
      clientName: "Acme Industrial",
      label: "Plant room",
      siteLabel: null,
      jobNumber: null,
    },
  ];

  it("offers the picker, and sends kind and id — never the label", async () => {
    const user = userEvent.setup();
    submit.mockResolvedValue({ ok: true });
    render(<MyExpensesFace today={TODAY} claims={[]} jobs={jobs} />);

    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.getByText("Not against a job")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pick a job" }));
    await user.click(screen.getByRole("option", { name: /Northgate Realty/ }));
    expect(screen.getByText("#1042 · Northgate Realty · Quarterly service")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/What was it for/i), "Copper fittings");
    await user.type(screen.getByLabelText(/Total paid/i), "84.50");
    await user.click(screen.getByRole("button", { name: "Send for approval" }));

    /* The label the person just read came from the picker; the one that gets
       STORED is built on the server from the row it finds. Sending it would
       let a browser write anything into an expense list. */
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ job: { kind: "visit", id: "v1" } }),
      ),
    );
  });

  /* "Nothing in particular" is the picker's own escape, and it means the same
     thing here — this was not for a job. */
  it("lets you take the job back off", async () => {
    const user = userEvent.setup();
    render(<MyExpensesFace today={TODAY} claims={[]} jobs={jobs} />);
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    await user.click(screen.getByRole("button", { name: "Pick a job" }));
    await user.click(screen.getByRole("option", { name: /Acme Industrial/ }));
    expect(screen.getByText("Acme Industrial · Plant room")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change" }));
    /* The escape hatch says what it means HERE — the picker's default words
       name a destination ("keep it in my notes") that an expense doesn't have. */
    expect(screen.queryByText(/keep it in my notes/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Not for a job in particular" }));
    expect(screen.getByText("Not against a job")).toBeInTheDocument();
  });

  /* AN EMPTY LIST HIDES THE CONTROL. A workspace with no open work has nothing
     to attach to, and a dead row saying so is the hint text this app doesn't
     write. */
  it("says nothing at all when there is no open work", async () => {
    const user = userEvent.setup();
    render(<MyExpensesFace today={TODAY} claims={[]} jobs={[]} />);
    await user.click(screen.getByRole("button", { name: "Enter it myself" }));
    expect(screen.queryByText("Not against a job")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pick a job" })).not.toBeInTheDocument();
  });

  it("shows the job on a filed row, on both kinds", async () => {
    const user = userEvent.setup();
    render(
      <MyExpensesFace
        today={TODAY}
        claims={[
          claim({ id: "o1", status: "pending", job: { kind: "visit", id: "v1", label: "#1042 · Northgate" } }),
          claim({
            id: "cc1",
            paidWith: "company",
            status: "recorded",
            description: "Makita drill",
            job: { kind: "project", id: "p1", label: "Acme · Plant room" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("#1042 · Northgate")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Company card/ }));
    expect(screen.getByText("Acme · Plant room")).toBeInTheDocument();
  });
});
