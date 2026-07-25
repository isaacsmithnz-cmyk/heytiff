import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffLicence } from "@/lib/staff/types";
import { todayInAu } from "@/lib/au-dates";
import { ComplianceCard } from "../compliance-card";
import { TODAY } from "./fixtures/staff";

/* The Compliance card: credential cards plus the little add form.

   No router.refresh() anywhere. Both actions revalidate the two paths that
   render this screen, so the RSC payload that comes back with the result
   already carries the new list — the explicit refresh was a second round trip
   doing the same job, later. */

const LICENCES: StaffLicence[] = [
  {
    id: "L1",
    typeName: "ARC licence",
    licenceNumber: "AU123",
    expiryDate: "2026-08-07",
    color: "#00A389",
  },
  { id: "L2", typeName: "White card", licenceNumber: null, expiryDate: null, color: null },
];

function setup(licences: StaffLicence[] = LICENCES) {
  const onAdd = jest.fn().mockResolvedValue({ ok: true });
  const onRemove = jest.fn().mockResolvedValue({ ok: true });
  const view = render(
    <ComplianceCard licences={licences} today={TODAY} onAdd={onAdd} onRemove={onRemove} />
  );
  return { ...view, onAdd, onRemove };
}

describe("the credential grid", () => {
  it("renders each licence with its badge, number and status", () => {
    const { container } = setup();
    // "ARC licence" is also an <option> in the add form — this is the card
    const card = container.querySelector(".credgrid .cred")!;
    expect(card).toHaveTextContent("ARC licence");
    expect(screen.getByText("ARC")).toBeInTheDocument();
    expect(screen.getByText("No. AU123")).toBeInTheDocument();
    expect(screen.getByText("Expires 07/08/2026")).toBeInTheDocument();
    // 14 days out, same window and the same wording as the dashboard chip
    expect(screen.getByText("Expires in 2 weeks")).toBeInTheDocument();
  });

  it("says so plainly when a licence carries no number or expiry", () => {
    setup();
    expect(screen.getByText("No. —")).toBeInTheDocument();
    expect(screen.getByText("No expiry date")).toBeInTheDocument();
    expect(screen.getByText("No expiry")).toBeInTheDocument();
  });

  it("shows the empty state when there are none", () => {
    setup([]);
    expect(screen.getByText("No licences added yet")).toBeInTheDocument();
  });
});

describe("adding one", () => {
  it("sends the type, number, expiry and the type's colour", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Licence type" }), "ARC licence");
    await user.type(screen.getByLabelText("Licence number"), "AU999");
    // picked, not typed — the calendar emits ISO. Today is the one day this
    // card can name without knowing what day the suite is run on.
    await user.click(screen.getByLabelText("Expiry"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: /Add/ }));

    expect(onAdd).toHaveBeenCalledWith({
      typeName: "ARC licence",
      licenceNumber: "AU999",
      expiryDate: todayInAu(),
      color: "#00A389",
    });
  });

  it("asks for the expiry with a calendar, not a text box", async () => {
    const user = userEvent.setup();
    setup();
    const expiry = screen.getByLabelText("Expiry");
    expect(expiry.tagName).toBe("BUTTON");
    expect(expiry).toHaveAttribute("aria-haspopup", "dialog");

    await user.click(expiry);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("swaps in a free-text name for a custom ticket", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Licence type" }), "__custom");
    await user.type(screen.getByPlaceholderText("Name this licence / ticket…"), "Working at Heights");
    await user.click(screen.getByRole("button", { name: /Add/ }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "Working at Heights", color: "" })
    );
  });

  /* An impossible expiry isn't something a person can ENTER any more, and the
     reason has changed: it isn't that the control refuses 31 February, it's
     that there is nowhere to say it. 31 February is not a cell on a calendar,
     and the picker has no text entry at all — open it and count the inputs.

     buildLicenceRow still refuses one too — a direct POST can send anything —
     and that is pinned in lib/staff/__tests__/licence.test.ts. */
  it("gives an impossible date nowhere to be typed", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Licence type" }), "White card");
    await user.click(screen.getByLabelText("Expiry"));

    const pop = screen.getByRole("dialog");
    expect(pop.querySelectorAll("input")).toHaveLength(0);
    expect(within(pop).queryAllByRole("textbox")).toHaveLength(0);

    // and what does come out is a real calendar date
    await user.click(within(pop).getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ expiryDate: todayInAu() }));
  });

  it("refuses an unnamed licence", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(
      await screen.findByText("Choose a licence type, or name a custom one.")
    ).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("clears the form once it saved, and shows what went wrong when it didn't", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "Licence type" }), "White card");
    await user.type(screen.getByLabelText("Licence number"), "WC1");
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(await screen.findByLabelText("Licence number")).toHaveValue("");

    onAdd.mockResolvedValueOnce({ ok: false, error: "Couldn't add that licence." });
    await user.selectOptions(screen.getByRole("combobox", { name: "Licence type" }), "White card");
    await user.click(screen.getByRole("button", { name: /Add/ }));
    expect(await screen.findByText("Couldn't add that licence.")).toBeInTheDocument();
  });
});

describe("removing one", () => {
  it("removes by id", async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();
    await user.click(screen.getByRole("button", { name: "Remove ARC licence" }));
    expect(onRemove).toHaveBeenCalledWith("L1");
  });

  it("surfaces a refusal instead of pretending it went", async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();
    onRemove.mockResolvedValueOnce({ ok: false, error: "Couldn't remove that licence." });
    await user.click(screen.getByRole("button", { name: "Remove White card" }));
    expect(await screen.findByText("Couldn't remove that licence.")).toBeInTheDocument();
  });
});
