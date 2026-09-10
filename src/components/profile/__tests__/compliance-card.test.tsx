import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StoredDocument } from "@/lib/documents/query";
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
  over: {
    licences?: StaffLicence[];
    records?: Record<string, StaffLicenceRecord[]>;
    documents?: Record<string, StoredDocument[]>;
  } = {}
) {
  const actions = {
    onAdd: jest.fn().mockResolvedValue({ ok: true }),
    onUpdate: jest.fn().mockResolvedValue({ ok: true }),
    onRemove: jest.fn().mockResolvedValue({ ok: true }),
    onRecordTerm: jest.fn().mockResolvedValue({ ok: true }),
    onAttachDoc: jest.fn().mockResolvedValue({ ok: true }),
    onRemoveTerm: jest.fn().mockResolvedValue({ ok: true }),
  };
  const view = render(
    <ComplianceCard
      licences={over.licences ?? LICENCES}
      staffId="S1"
      records={over.records ?? {}}
      documents={over.documents ?? {}}
      today={TODAY} warnDays={30}
      {...actions}
    />
  );
  return { ...view, ...actions };
}

const openCard = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole("button", { name: `Open ${name}` }));

/* NO REMIND ME. The per-card chips were the only door into the morning email
   for a staff ticket. The org's expiry window nudges now (lib/expiry.ts). */
describe("no Remind me on a ticket", () => {
  it("offers no reminder chips — the org's expiry window nudges instead", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("REMIND ME")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Remind me" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/days before/)).not.toBeInTheDocument();
  });
});

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

  /* ONE QUESTION, ASKED ONCE, AND NOT BY HAND. Adding a ticket asks what it is;
     the number is what the scan is about to hand over, and the scan panel asks
     for it there. It was on the identity card too, so with the panel open
     "Licence no." appeared twice on one screen with nothing to say which won,
     and the panel's copy silently did. */
  it("never asks for the number by hand while adding", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByLabelText("Licence no.")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Enter manually" }));

    // exactly one, and it is the scan panel's
    const panel = within(dialog).getByText("SCAN THE CARD").closest(".vm-card") as HTMLElement;
    expect(within(dialog).getAllByLabelText("Licence no.")).toHaveLength(1);
    expect(within(panel).getByLabelText("Licence no.")).toBeInTheDocument();
  });

  /* A number typed by hand goes in through the scan panel, the same way a
     scanned one does, and with no expiry the action puts it on the ticket
     (splitAddScan). */
  it("sends the type, the type's colour, and a number typed by hand", async () => {
    const user = userEvent.setup();
    const { onAdd } = setup();

    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Licence or ticket"), "ARC licence");
    await user.click(within(dialog).getByRole("button", { name: "Enter manually" }));
    await user.type(within(dialog).getByLabelText("Licence no."), "AU999");
    await user.click(within(dialog).getByRole("button", { name: "Add licence" }));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "ARC licence", color: "#00A389" }),
      expect.objectContaining({ number: "AU999", expiresOn: "", documentId: null, source: "manual" })
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

/* A TICKET THAT CAN NEVER HOLD A TERM STILL HAS TO KEEP ITS PHOTO.

   A term is a PERIOD and expires_on is NOT NULL, so a white card — one of the
   four seeded types, and a ticket that genuinely never lapses — can hold no
   term at all. The screen shipped with its only "Add document" inside the
   CURRENT TERM card, so the one kind of ticket whose entire content is a photo
   had nowhere to put it. Everything below fails on that screen. */
describe("filing a document against a ticket with no expiry", () => {
  const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
    id: "doc-9",
    kind: "licence",
    fileName: "white-card.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    uploadedById: "S1",
    createdAt: "2026-09-01T00:00:00.000Z",
    url: "https://signed.example/white-card.jpg",
    image: true,
    policyId: null,
    financeId: null,
    credentialRecordId: null,
    licenceRecordId: null,
    workRightsRecordId: null,
    ...over,
  });

  const file = () => new File(["x"], "white-card.jpg", { type: "image/jpeg" });

  beforeEach(() => uploadFile.mockReset());

  it("offers the door on the ticket itself, where the term card would be", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "White card");
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByText("CURRENT TERM")).not.toBeInTheDocument();
    expect(within(dialog).getByText("DOCUMENTS")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Add document")).toBeInTheDocument();
  });

  /* The ticket OWNS it; nothing owns the filing. That null is the whole fix —
     documents.licence_record_id has always been allowed to be one, and
     looseTermDocuments already reads exactly those rows back. */
  it("files the upload against the TICKET, under no term", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { onAttachDoc } = setup();

    await openCard(user, "White card");
    await user.upload(within(screen.getByRole("dialog")).getByLabelText("Add document"), file());

    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "licence");
    expect(onAttachDoc).toHaveBeenCalledWith("L2", null, "doc-9");
  });

  it("lists what has been filed against it", async () => {
    const user = userEvent.setup();
    setup({ documents: { L2: [doc()] } });
    await openCard(user, "White card");

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/white-card\.jpg/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/No photo or scan filed/)).not.toBeInTheDocument();
  });

  it("says plainly when nothing has been filed yet", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "White card");
    expect(
      within(screen.getByRole("dialog")).getByText("No photo or scan filed against this ticket yet.")
    ).toBeInTheDocument();
  });

  it("files nothing when the upload itself refuses", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: false, error: "That upload didn't finish." });
    const { onAttachDoc } = setup();

    await openCard(user, "White card");
    await user.upload(within(screen.getByRole("dialog")).getByLabelText("Add document"), file());
    expect(onAttachDoc).not.toHaveBeenCalled();
  });

  /* And the term's own door is untouched: ONE "Add document" on a screen that
     has a term, and it names that term. Two would be a question the person
     shouldn't have to answer. */
  it("still files under the term in force, when there is one", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { onAttachDoc } = setup({ records: { L1: [term()] } });

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByLabelText("Add document")).toHaveLength(1);

    await user.upload(within(dialog).getByLabelText("Add document"), file());
    expect(onAttachDoc).toHaveBeenCalledWith("L1", "T1", "doc-9");
  });
});

/* ADDING A TICKET BY SCANNING IT, WITH NO EXPIRY ON IT.

   The panel used to send what it read only when there was an expiry, so a
   white card — which has none — was saved without the photo that had already
   been uploaded, or the number read off it. It all goes with the save now,
   and the action decides whether it is a term. */
describe("adding a ticket by scanning it", () => {
  const pdf = () => new File(["x"], "white-card.pdf", { type: "application/pdf" });
  const read = (over: Record<string, unknown> = {}) => ({
    ok: true,
    number: "WC-12345",
    issuer: "SafeWork NSW",
    issuingState: "NSW",
    classes: null,
    startsOn: "2019-03-02",
    expiresOn: null,
    ...over,
  });

  beforeEach(() => {
    uploadFile.mockReset();
    readStaffLicenceDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
  });

  const scanAndAdd = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /Add a licence or ticket/ }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("SCANNED");
    await user.type(within(dialog).getByLabelText("Licence or ticket"), "White card");
    await user.click(within(dialog).getByRole("button", { name: "Add licence" }));
  };

  it("sends the photo and what was read, with no expiry on the card", async () => {
    const user = userEvent.setup();
    readStaffLicenceDocument.mockResolvedValue(read());
    const { onAdd } = setup();

    await scanAndAdd(user);

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "White card" }),
      expect.objectContaining({ number: "WC-12345", expiresOn: "", documentId: "doc-7", source: "scan" })
    );
  });

  it("sends a card with an expiry the same way", async () => {
    const user = userEvent.setup();
    readStaffLicenceDocument.mockResolvedValue(read({ expiresOn: "2029-03-02" }));
    const { onAdd } = setup();

    await scanAndAdd(user);

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ typeName: "White card" }),
      expect.objectContaining({ expiresOn: "2029-03-02", documentId: "doc-7", source: "scan" })
    );
  });
});

/* SCANNING A TICKET THAT HAS NO EXPIRY, ON THE RECORD PANEL.

   The panel is open by default on a ticket with no term. Scan a white card and
   Tiff reads it — but there is no expiry to read, so "Save term" could never be
   pressed, and the file the panel had ALREADY uploaded sat in state that only a
   saved term consumes: owned by nothing, shown nowhere. The button files it
   against the ticket now, and says so. */
describe("scanning a ticket with no expiry on the record panel", () => {
  const pdf = () => new File(["x"], "white-card.pdf", { type: "application/pdf" });
  const read = (over: Record<string, unknown> = {}) => ({
    ok: true,
    number: "WC-12345",
    issuer: "SafeWork NSW",
    issuingState: "NSW",
    classes: null,
    startsOn: "2019-03-02",
    expiresOn: null,
    ...over,
  });

  beforeEach(() => {
    uploadFile.mockReset();
    readStaffLicenceDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
    readStaffLicenceDocument.mockResolvedValue(read());
  });

  const scan = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) => {
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("SCANNED");
  };

  const scanWhiteCard = async (user: ReturnType<typeof userEvent.setup>) => {
    await openCard(user, "White card");
    const dialog = screen.getByRole("dialog");
    await scan(user, dialog);
    return dialog;
  };

  it("files the uploaded scan against the ticket instead of dead-ending", async () => {
    const user = userEvent.setup();
    const { onAttachDoc, onRecordTerm } = setup();

    const dialog = await scanWhiteCard(user);
    expect(within(dialog).queryByRole("button", { name: "Save term" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    // the ticket owns it; nothing owns the filing — and no term was invented
    expect(onAttachDoc).toHaveBeenCalledWith("L2", null, "doc-7");
    expect(onRecordTerm).not.toHaveBeenCalled();
  });

  it("lets go of the scan once it has landed", async () => {
    const user = userEvent.setup();
    setup();

    const dialog = await scanWhiteCard(user);
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    // a ticket with no term keeps its panel — it is the screen — back at the start
    expect(await within(dialog).findByText("Scan or photograph the licence")).toBeInTheDocument();
    expect(within(dialog).queryByText("SCANNED")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "File the document" })).not.toBeInTheDocument();
  });

  /* Tiff could not read it, so the panel went to manual with a line saying so,
     and the file arrived through onAttached rather than onRead. It is filed all
     the same — and once it has gone, the line about it goes too. */
  it("files a scan Tiff could not read, and clears the line that said so", async () => {
    const user = userEvent.setup();
    readStaffLicenceDocument.mockResolvedValue({ ok: false, reason: "Tiff couldn't complete that." });
    const { onAttachDoc } = setup();

    await openCard(user, "White card");
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    expect(
      await within(dialog).findByText("Tiff couldn't read that one — enter the details below.")
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    expect(onAttachDoc).toHaveBeenCalledWith("L2", null, "doc-7");
    expect(await within(dialog).findByText("Scan or photograph the licence")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Tiff couldn't read that one/)).not.toBeInTheDocument();
  });

  it("closes the renewal panel once it has landed, on a ticket that has a term", async () => {
    const user = userEvent.setup();
    const { onAttachDoc } = setup({ records: { L1: [term()] } });

    await openCard(user, "ARC licence");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));
    await scan(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    // filed against the ticket, never under the term it failed to renew
    expect(onAttachDoc).toHaveBeenCalledWith("L1", null, "doc-7");
    expect(await within(dialog).findByRole("button", { name: "Record renewal" })).toBeInTheDocument();
  });

  it("keeps the scan when the filing is refused, so pressing again is a retry", async () => {
    const user = userEvent.setup();
    const { onAttachDoc } = setup();
    onAttachDoc.mockResolvedValueOnce({ ok: false, error: "That document couldn't be filed." });

    const dialog = await scanWhiteCard(user);
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    expect(await within(dialog).findByText("That document couldn't be filed.")).toBeInTheDocument();
    expect(within(dialog).getByText("SCANNED")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));
    expect(onAttachDoc).toHaveBeenCalledTimes(2);
    expect(onAttachDoc).toHaveBeenLastCalledWith("L2", null, "doc-7");
  });

  it("saves a term the moment an expiry is picked, with the scan inside it", async () => {
    const user = userEvent.setup();
    const { onAttachDoc, onRecordTerm } = setup();

    const dialog = await scanWhiteCard(user);
    await user.click(within(dialog).getByLabelText("Expiry"));
    await user.click(await screen.findByRole("button", { name: "Friday 24 July 2026" }));
    await user.click(within(dialog).getByRole("button", { name: "Save term" }));

    expect(onRecordTerm).toHaveBeenCalledWith(
      "L2",
      expect.objectContaining({ expiresOn: "2026-07-24", documentId: "doc-7", source: "scan" })
    );
    expect(onAttachDoc).not.toHaveBeenCalled();
  });

  it("still has nothing to press with neither an expiry nor a document", async () => {
    const user = userEvent.setup();
    setup();
    await openCard(user, "White card");
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Enter manually" }));
    expect(within(dialog).getByRole("button", { name: "Save term" })).toBeDisabled();
  });
});
