import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffLicence } from "@/lib/staff/types";
import type { StaffLicenceRecord } from "@/lib/staff/licence-records";

/* Tiff's reader is stubbed, and it has to be: it is a `"use server"` module,
   so importing it for real pulls Auth0 and next/server into a jsdom suite and
   the whole file fails to LOAD rather than to pass. */
const readStaffLicenceDocument = jest.fn();
jest.mock("@/app/actions/staff-licence-ai", () => ({
  readStaffLicenceDocument: (...a: unknown[]) => readStaffLicenceDocument(...a),
}));

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

import { ComplianceCard } from "../compliance-card";
import { TODAY } from "./fixtures/staff";

/* The Compliance card: a wall of tickets you can OPEN.

   THE CONTRACT CHANGED with the terms rebuild, and deliberately. It used to be
   an inline add-form over cards with a remove × on each, which made a ticket a
   thing you add and delete and nothing else — so recording a renewal meant
   deleting the licence and adding it back, and the term before it went with
   it. What this file pins now:

     A CARD IS A DOOR, and what is behind it leads with the term in force.

     A RENEWAL IS A NEW TERM. Recording one calls onRecordTerm with the
     ticket's id; it never calls onUpdate, because nothing about the ticket
     itself changed and the term before it is still on file.

     DELETING IS DELIBERATE. The × is gone from the wall — a ticket is removed
     from behind Edit details, on a second press.

     WHAT SURVIVED REVIEW STAYS PINNED: the faceless CR80 card, the status
     wording shared with the dashboard chip, the em dash for a fact nobody has
     entered, and dates that are PICKED and never typed.

   No router.refresh() anywhere. Every action revalidates the two paths that
   render this screen, so the RSC payload that comes back already carries the
   new list. */

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

const term = (over: Partial<StaffLicenceRecord> = {}): StaffLicenceRecord => ({
  id: "T1",
  licenceId: "L1",
  issuer: "Australian Refrigeration Council",
  number: "AU123",
  classes: "Split systems — install and decommission",
  issuingState: "NSW",
  startsOn: "2024-08-07",
  expiresOn: "2026-08-07",
  documentId: null,
  source: "scan",
  createdAt: "2024-08-01T00:00:00.000Z",
  ...over,
});

function setup(
  over: { licences?: StaffLicence[]; records?: Record<string, StaffLicenceRecord[]> } = {}
) {
  const actions = {
    onAdd: jest.fn().mockResolvedValue({ ok: true }),
    onUpdate: jest.fn().mockResolvedValue({ ok: true }),
    onRemove: jest.fn().mockResolvedValue({ ok: true }),
    onRecordTerm: jest.fn().mockResolvedValue({ ok: true }),
    onAttachDoc: jest.fn().mockResolvedValue({ ok: true }),
    onRemoveTerm: jest.fn().mockResolvedValue({ ok: true }),
    onRemind: jest.fn().mockResolvedValue({ ok: true }),
  };
  const view = render(
    <ComplianceCard
      licences={over.licences ?? LICENCES}
      staffId="S1"
      records={over.records ?? {}}
      today={TODAY}
      {...actions}
    />
  );
  return { ...view, ...actions };
}

const openCard = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name: `Open ${name}` }));

describe("the licence wall", () => {
  it("renders each licence as a card with its stamp, number and status", () => {
    const { container } = setup();
    const card = container.querySelector(".liccards .idc")!;
    expect(card).toHaveTextContent("ARC licence");
    expect(within(card as HTMLElement).getByText("ARC")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("AU123")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("07/08/2026")).toBeInTheDocument();
    // 14 days out, same window and the same wording as the dashboard chip
    expect(within(card as HTMLElement).getByText("Expires in 2 weeks")).toBeInTheDocument();
  });

  it("carries the licence's own details and no holder — the rail already said who", () => {
    const { container } = setup();
    const card = container.querySelector(".liccards .idc")!;
    // no photo block: a wall of these would otherwise repeat one face
    expect(card).toHaveClass("faceless");
    expect(card.querySelector(".idc-photo")).toBeNull();
  });

  it("says so plainly when a licence carries no number or expiry", () => {
    const { container } = setup();
    const cards = [...container.querySelectorAll(".liccards .idc")];
    const bare = cards.find((c) => c.textContent?.includes("No expiry"))!;
    expect(within(bare as HTMLElement).getAllByText("—")).toHaveLength(2);
  });

  it("says on the card how many terms are on file", () => {
    setup({ records: { L1: [term(), term({ id: "T0", expiresOn: "2024-08-07" })] } });
    expect(screen.getByText("2 terms on file")).toBeInTheDocument();
  });

  it("shows the empty state when there are none", () => {
    setup({ licences: [] });
    expect(screen.getByText("No licences added yet")).toBeInTheDocument();
  });

  it("has no remove × on the wall — deleting is deliberate now", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Remove ARC licence" })).not.toBeInTheDocument();
  });

  it("opens no modal until a card is clicked", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the licence modal", () => {
  it("opens a card on the term in force, with its facts and its history", async () => {
    const user = userEvent.setup();
    setup({ records: { L1: [term(), term({ id: "T0", expiresOn: "2024-08-07", startsOn: "2022-08-07" })] } });

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("CURRENT TERM")).toBeInTheDocument();
    expect(within(dialog).getByText("Split systems — install and decommission")).toBeInTheDocument();
    expect(within(dialog).getByText("NSW")).toBeInTheDocument();
    expect(within(dialog).getByText("7 Aug 2026")).toBeInTheDocument();

    // and the one before it, which deleting-and-re-adding used to destroy
    const history = within(dialog).getByText("PREVIOUS TERMS").closest(".vm-card") as HTMLElement;
    expect(within(history).getByText("7 Aug 2024")).toBeInTheDocument();
  });

  it("opens straight onto the record panel when nothing has been filed", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("RECORD THE TERM")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Record renewal" })).not.toBeInTheDocument();
  });

  it("records a renewal as a NEW term, never as an edit of the ticket", async () => {
    const user = userEvent.setup();
    const { onRecordTerm, onUpdate } = setup({ records: { L1: [term()] } });

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter manually" }));

    await user.type(within(dialog).getByLabelText("Licence no."), "AU999");
    // no expiry yet: nothing to save
    expect(within(dialog).getByRole("button", { name: "Save term" })).toBeDisabled();

    // the expiry is PICKED, never typed — the calendar is the only way in
    await user.click(within(dialog).getByLabelText("Expiry"));
    await user.click(await screen.findByRole("button", { name: "Friday 24 July 2026" }));
    await user.click(within(dialog).getByRole("button", { name: "Save term" }));

    expect(onRecordTerm).toHaveBeenCalledWith(
      "L1",
      expect.objectContaining({ number: "AU999", expiresOn: "2026-07-24", source: "manual" })
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("gives an impossible date nowhere to be typed", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "White card");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Enter manually" }));

    const expiry = within(dialog).getByLabelText("Expiry");
    expect(expiry.tagName).toBe("BUTTON");
    await user.click(expiry);

    // the popover is the SECOND dialog on screen — the modal is the first
    const pop = screen.getAllByRole("dialog").at(-1)!;
    expect(pop.querySelectorAll("input")).toHaveLength(0);
    expect(within(pop).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("renames a ticket behind the Edit details door, and updates it by id", async () => {
    const user = userEvent.setup();
    const { onUpdate, onAdd } = setup();

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));

    expect(within(dialog).getByLabelText("Licence or ticket")).toHaveValue("ARC licence");
    await user.clear(within(dialog).getByLabelText("Licence no."));
    await user.type(within(dialog).getByLabelText("Licence no."), "AU777");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onUpdate).toHaveBeenCalledWith(
      "L1",
      expect.objectContaining({ typeName: "ARC licence", licenceNumber: "AU777" })
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  /* Once a term owns the number and the expiry they are a cache of it, and the
     details screen stops offering them — a blank draft saved over them would
     wipe the columns the dashboard chip and the completeness strip read. */
  it("stops offering the term's own fields once a term exists", async () => {
    const user = userEvent.setup();
    setup({ records: { L1: [term()] } });

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));

    expect(within(dialog).getByLabelText("Licence or ticket")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Licence no.")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Expiry")).not.toBeInTheDocument();
  });

  it("deletes only after a second, deliberate click", async () => {
    const user = userEvent.setup();
    const { onRemove } = setup();

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onRemove).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /Tap again to delete/ }));
    expect(onRemove).toHaveBeenCalledWith("L1");
  });

  it("sets a reminder against the ticket, and cannot before there is an expiry", async () => {
    const user = userEvent.setup();
    const { onRemind } = setup({ records: { L1: [term()] } });

    await openCard(user, "ARC licence");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "30 days before" })
    );
    expect(onRemind).toHaveBeenCalledWith("L1", 30, true);
  });

  it("leaves the reminder chips dead until a term is on file", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "White card"); // no expiry at all
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "30 days before" })
    ).toBeDisabled();
  });
});

describe("adding one", () => {
  it("offers a tile that opens the modal on the scan panel", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("SCAN THE CARD")).toBeInTheDocument();
    expect(within(dialog).getByText(/Scan or photograph the licence/)).toBeInTheDocument();
  });

  it("says plainly that nothing else on the card is read", async () => {
    /* A driver licence is a government ID. The reader is deliberately narrow
       (lib/staff/licence-readers.ts) and the person handing it over is told
       so, on the screen where they hand it over. */
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    expect(
      within(screen.getByRole("dialog")).getByText(/not your name, date of birth or address/)
    ).toBeInTheDocument();
  });

  it("sends the type and the type's colour, with no term when nothing was scanned", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Licence or ticket"), "ARC licence");
    await user.type(within(dialog).getByLabelText("Licence no."), "AU999");
    await user.click(within(dialog).getByRole("button", { name: "Add licence" }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "ARC licence", licenceNumber: "AU999", color: "#00A389" }),
      undefined
    );
  });

  it("takes a free-text name for a ticket the registry has never heard of", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Licence or ticket"), "Working at Heights");
    await user.click(within(dialog).getByRole("button", { name: "Add licence" }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "Working at Heights", color: "" }),
      undefined
    );
  });

  it("refuses an unnamed licence without calling anything", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    // the name is the one thing a ticket cannot be without, so the button that
    // would save it is not a live button at all
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add licence" })
    ).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("keeps the modal open and says why when the action refuses", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();
    onAdd.mockResolvedValueOnce({ ok: false, error: "Couldn't add that licence." });

    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Licence or ticket"), "White card");
    await user.click(within(dialog).getByRole("button", { name: "Add licence" }));

    expect(await screen.findByText("Couldn't add that licence.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
