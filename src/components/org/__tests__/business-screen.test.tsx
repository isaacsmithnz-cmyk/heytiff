import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgAccount } from "@/lib/org/account";
import type { OwnerCandidate } from "@/lib/org/ownership";
import type { StoredDocument } from "@/lib/documents/query";
import type { OrgCredential } from "@/lib/org/credentials";
import type { OrgCredentialRecord } from "@/lib/org/credential-records";
import type { OrgSettings } from "@/lib/org/settings";

/* The uploader's helper is stubbed: it exists to reach a signed slot and PUT
   bytes at real storage, and pulling it in for real would drag the server
   action (and Auth0) into a DOM test. What matters here is what the screen does
   with the document id that comes back. */
const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

/* Tiff's reader is stubbed for the same reason, and it has to be: it is a
   `"use server"` module, so importing it for real pulls Auth0 and next/server
   into a jsdom suite and the whole file fails to LOAD rather than to pass. */
const readOrgCredentialDocument = jest.fn();
jest.mock("@/app/actions/org-credential-ai", () => ({
  readOrgCredentialDocument: (...a: unknown[]) => readOrgCredentialDocument(...a),
}));

import { ToastProvider } from "@/components/parts/toast";
import { BusinessScreen } from "../business-screen";

/* Settings › Business (v2, 25 October 2026): one page of groups under thin
   lines, Brand, Trading details, Contact, Licences and insurance, Payments
   and reminders, Account, in that order.

   What this file pins:

     TYPED DETAILS EDIT IN PLACE. Each group of them has one Edit, and its
     read and edit faces name the same things in the same order.

     A SETTING YOU PICK SAVES ITSELF, as the preferences section, one field
     at a time, and says so in a toast.

     A BAD ABN NEVER LEAVES THE BROWSER. The group runs the same checksum the
     action runs, so the action is not called at all and the ABN box is the
     one that gets marked.

     THE MODAL IS NOT THERE UNTIL IT IS. It portals to <body>, so "no dialog
     in the document" is the only honest way to say it's closed. */

const TODAY = "2026-07-24";

const ORG: OrgSettings = {
  id: "org-1",
  trading_name: "Smith Air Conditioning",
  legal_name: "Smith Air Pty Ltd",
  abn: "51824753556",
  acn: "123456789",
  gst_registered: true,
  payment_terms_days: 14,
  expiry_warn_days: 30,
  expiry_email: true,
  email: "office@smithair.com.au",
  phone: "(03) 9000 0000",
  website: "smithair.com.au",
  address: "12 Trade Street",
  suburb: "Ringwood",
  state: "VIC",
  postcode: "3134",
  logo_url: null,
  brand_color: null,
};

const ACCOUNT: OrgAccount = {
  ownerName: "Isaac Smith",
  ownerEmail: "isaac@smithair.com.au",
  ownerIsYou: false,
  activeStaff: 7,
  totalStaff: 9,
  // an EVENING signup, AU time — 11 March there, still 10 March in UTC. The
  // card must print the 11th (see the auDayOf note in org-screen).
  createdAt: "2025-03-10T14:30:00Z",
  plan: "standard",
};

const CANDIDATES: OwnerCandidate[] = [
  { userId: "auth0|liv", name: "Liv Nguyen", email: "liv@smithair.com.au", role: "admin" },
  { userId: "auth0|sam", name: "Sam Reed", email: "sam@smithair.com.au", role: "owner" },
];

const CREDENTIALS: OrgCredential[] = [
  {
    id: "C1",
    kind: "licence",
    name: "ARC refrigerant trading authorisation",
    number: "AU12345",
    issuer: "Australian Refrigeration Council",
    expiryDate: "2026-08-07",
    color: null,
  },
  {
    id: "C2",
    kind: "insurance",
    name: "Public liability",
    number: "PL-9",
    issuer: "QBE",
    expiryDate: null,
    color: null,
  },
];

function setup(
  over: {
    org?: Partial<OrgSettings>;
    credentials?: OrgCredential[];
    logoUrl?: string;
    addressLookup?: boolean;
    account?: OrgAccount | null;
    candidates?: OwnerCandidate[];
    onTransferOwnership?: jest.Mock;
    onRecordTerm?: jest.Mock;
    /** the terms behind the cards, keyed by credential id */
    records?: Record<string, OrgCredentialRecord[]>;
    /** the paperwork behind the cards, keyed by credential id */
    documents?: Record<string, StoredDocument[]>;
  } = {}
) {
  const actions = {
    onSave: jest.fn().mockResolvedValue({ ok: true }),
    onAddCredential: jest.fn().mockResolvedValue({ ok: true }),
    onUpdateCredential: jest.fn().mockResolvedValue({ ok: true }),
    onRemoveCredential: jest.fn().mockResolvedValue({ ok: true }),
    onSetLogo: jest.fn().mockResolvedValue({ ok: true }),
    onClearLogo: jest.fn().mockResolvedValue({ ok: true }),
    onSetBrandColor: jest.fn().mockResolvedValue({ ok: true }),
    onClearBrandColor: jest.fn().mockResolvedValue({ ok: true }),
    onRecordTerm: over.onRecordTerm ?? jest.fn().mockResolvedValue({ ok: true }),
    onAttachCredentialDoc: jest.fn().mockResolvedValue({ ok: true }),
    onRemoveTerm: jest.fn().mockResolvedValue({ ok: true }),
    /* Present = "you are the master". The page passes it only for the master
       owner, so a test for a co-owner's screen passes `onTransferOwnership:
       undefined` rather than a stub that refuses. */
    onTransferOwnership:
      over.onTransferOwnership === undefined
        ? jest.fn().mockResolvedValue({ ok: true })
        : over.onTransferOwnership,
  };
  const view = render(
    <ToastProvider>
    <BusinessScreen
      org={{ ...ORG, ...(over.org ?? {}) }}
      credentials={over.credentials ?? CREDENTIALS}
      credentialRecords={over.records ?? {}}
      credentialDocuments={over.documents ?? {}}
      account={over.account === undefined ? ACCOUNT : over.account}
      ownerCandidates={over.candidates ?? CANDIDATES}
      logoUrl={over.logoUrl ?? null}
      today={TODAY} warnDays={30}
      addressLookup={over.addressLookup ?? false}
      actions={actions}
    />
    </ToastProvider>
  );
  return { ...view, actions };
}

/* The group a heading names, so a test says WHICH group it is in instead of
   counting down a page. */
const group = (title: string) =>
  screen.getByRole("heading", { level: 2, name: title }).closest(".st2-group") as HTMLElement;

describe("the business page", () => {
  it("is six titled groups, in the order a customer meets them", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Business");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Brand",
      "Trading details",
      "Contact",
      "Licences and insurance",
      "Payments and reminders",
      "Account",
    ]);
  });

  it("has nothing to save until an Edit is pressed", () => {
    setup();
    expect(screen.getByRole("button", { name: "Edit trading details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit contact" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });

  /* The documents are drawn on the templates; this page carries no second,
     drifting copy of them. */
  it("sends you to the templates to see the logo on a document", () => {
    setup();
    expect(screen.getByRole("link", { name: "View on templates" })).toHaveAttribute("href", "/dashboard/admin/templates");
  });

  it("says initials stand in when there is no logo, and shows the logo when there is", () => {
    const { container, unmount } = setup();
    expect(container.querySelector(".orglogo-thumb img")).toBeNull();
    expect(screen.getByText("No logo, initials stand in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload a logo" })).toBeInTheDocument();
    unmount();

    const withLogo = setup({ logoUrl: "https://signed.example/logo.png" });
    expect(withLogo.container.querySelector(".orglogo-thumb img")).toHaveAttribute("src", "https://signed.example/logo.png");
    expect(screen.getByRole("button", { name: "Replace logo" })).toBeInTheDocument();
  });

  /* Read and edit name the same five things in the same order, or pressing
     Edit replaces the rows you were reading with an unrelated form. */
  it("trading details reads back the same fields it edits", async () => {
    const user = userEvent.setup();
    setup();
    const card = group("Trading details");
    const labels = () => Array.from(card.querySelectorAll(".st2-kv dt, .pt-field-label")).map((l) => (l.textContent ?? "").trim());
    const inRead = labels();
    expect(inRead).toEqual(["Trading name", "Legal name", "ABN", "ACN", "GST"]);

    await user.click(within(card).getByRole("button", { name: "Edit trading details" }));
    expect(labels()).toEqual(inRead);
  });

  it("says Not set for a blank, never a dash", () => {
    setup({ org: { acn: null } });
    const card = group("Trading details");
    expect(within(card).getByText("Not set")).toBeInTheDocument();
    expect(within(card).queryByText("—")).not.toBeInTheDocument();
  });

  it("reads the address as one row", () => {
    setup();
    expect(within(group("Contact")).getByText("12 Trade Street, Ringwood VIC 3134")).toBeInTheDocument();
  });

  /* The hints the redesign deleted. They explained the software to itself;
     the ABN one is an ERROR on the field, which is what it was promising. */
  it("carries none of the old explanatory hints", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Edit trading details" }));
    expect(screen.queryByText(/Shown across HeyTiff/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ATO checksum/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    expect(screen.queryByText(/public-holiday calendar/)).not.toBeInTheDocument();
  });

  it("keeps the website with the contact details, where it prints", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.clear(screen.getByLabelText("Website"));
    await user.type(screen.getByLabelText("Website"), "blueskyair.com.au");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(actions.onSave).toHaveBeenCalledWith("contact", expect.objectContaining({ website: "blueskyair.com.au" }));
  });

  it("goes back to reading once it saves", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("button", { name: "Edit contact" })).toBeInTheDocument();
  });

  it("keeps what was typed and says why when the save is refused", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    actions.onSave.mockResolvedValueOnce({ ok: false, error: "That email is already in use." });
    await user.click(screen.getByRole("button", { name: "Edit contact" }));
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "new@smithair.com.au");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email is already in use.");
    expect(screen.getByLabelText("Email")).toHaveValue("new@smithair.com.au");
  });
});

/* PAYMENTS AND REMINDERS — picked, not typed, and each saves itself as the
   preferences section, its own field only. */
describe("payments and reminders", () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, chooser: string, option: string) => {
    await user.click(screen.getByRole("combobox", { name: chooser }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
  };

  it("reads payment terms and the warning window back on their choosers", () => {
    setup();
    expect(screen.getByRole("combobox", { name: "Payment terms" })).toHaveTextContent("14 days");
    expect(screen.getByRole("combobox", { name: "Warn before papers run out" })).toHaveTextContent("30 days before");
    expect(screen.getByRole("switch", { name: "Morning email" })).toHaveAttribute("aria-checked", "true");
  });

  it("saves payment terms the moment they're picked, and nothing else", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await pick(user, "Payment terms", "30 days");
    expect(actions.onSave).toHaveBeenCalledWith("preferences", { payment_terms_days: "30" });
    expect(await screen.findByText("Payment terms set to 30 days")).toBeInTheDocument();
  });

  it("calls nought days what they are", () => {
    setup({ org: { payment_terms_days: 0 } });
    expect(screen.getByRole("combobox", { name: "Payment terms" })).toHaveTextContent("On receipt");
  });

  /* A business that typed 10 before the list existed still sees 10. */
  it("keeps a saved value that isn't one of the list's", () => {
    setup({ org: { payment_terms_days: 10 } });
    expect(screen.getByRole("combobox", { name: "Payment terms" })).toHaveTextContent("10 days");
  });

  it("saves the warning window as the preferences section", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await pick(user, "Warn before papers run out", "60 days before");
    expect(actions.onSave).toHaveBeenCalledWith("preferences", { expiry_warn_days: "60" });
  });

  it("turns the morning email off with its switch", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("switch", { name: "Morning email" }));
    expect(actions.onSave).toHaveBeenCalledWith("preferences", { expiry_email: "No" });
  });

  it("puts the old value back when the toast's Undo is pressed", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await pick(user, "Payment terms", "30 days");
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(actions.onSave).toHaveBeenLastCalledWith("preferences", { payment_terms_days: "14" });
  });

  it("says why under the group when a pick is refused", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    actions.onSave.mockResolvedValueOnce({ ok: false, error: "Payment terms are whole days — 0 to 180." });
    await pick(user, "Payment terms", "30 days");
    expect(await within(group("Payments and reminders")).findByRole("alert")).toHaveTextContent("whole days");
  });
});

describe("saving trading details", () => {
  it("sends the identity section when the fields are clean", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Edit trading details" }));
    await user.clear(screen.getByLabelText(/Trading name/));
    await user.type(screen.getByLabelText(/Trading name/), "Smith Air Co");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "identity",
      expect.objectContaining({ trading_name: "Smith Air Co" })
    );
  });

  it("blocks a bad ABN on the field, and never calls the action", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Edit trading details" }));
    const abn = screen.getByLabelText("ABN");
    await user.clear(abn);
    await user.type(abn, "51824753557"); // one digit out
    await user.click(screen.getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("That ABN doesn't check out")).toBeInTheDocument();
    expect(abn).toHaveAttribute("aria-invalid", "true");
    expect(actions.onSave).not.toHaveBeenCalled();
  });
});

describe("the licences", () => {
  it("lists each one as a row: its name, who issued it and its number, and when it runs out", () => {
    setup();
    const card = group("Licences and insurance");
    expect(within(card).getAllByRole("listitem")).toHaveLength(2);
    expect(within(card).getByText("Australian Refrigeration Council, No. AU12345")).toBeInTheDocument();
    expect(within(card).getByText("QBE, No. PL-9")).toBeInTheDocument();
    // 14 days out, inside the 30-day window: a look, in the same words as Home's
    expect(within(card).getByText("Runs out Fri 7 Aug")).toBeInTheDocument();
    expect(within(card).getByText("No end date")).toBeInTheDocument();
  });

  it("offers Renew only on one that has run out or is about to", () => {
    setup();
    expect(screen.getAllByRole("button", { name: "Renew" })).toHaveLength(1);
  });

  it("says ran out, in red, once the date has passed", () => {
    setup({ credentials: [{ ...CREDENTIALS[0]!, expiryDate: "2026-07-01" }] });
    expect(screen.getByText("Ran out Wed 1 July")).toBeInTheDocument();
  });

  it("leads with Add when there are none", () => {
    setup({ credentials: [] });
    expect(screen.getByText("No licences or insurance on file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a licence or policy" })).toBeInTheDocument();
  });

  it("opens no modal until something is clicked", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens Renew on the update, not the record", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Renew" }));
    expect(within(screen.getByRole("dialog")).getByText("Update licence")).toBeInTheDocument();
  });
});

/* THE CREDENTIAL MODAL — the vehicle card's shape, one level up.

   The contract this file pins changed with the rebuild, and deliberately:

     OPENING A CARD LANDS ON ITS RECORD, not on a form. What an owner wants
     when they click "Public liability" is the cover they hold and the paper
     behind it; renaming the card is a door off that screen, not the screen.

     A RENEWAL IS A NEW TERM. Recording one calls onRecordTerm with the card's
     id — it never calls onUpdateCredential, because nothing about the card
     itself changed and the term before it is still on file.

     THE HISTORY IS VISIBLE FROM OUTSIDE. A card says how many terms it has,
     so there is a reason to open it.

     THE NAME IS STILL REQUIRED, and still refused in the browser rather than
     after a round trip — the modal runs the very validator the action runs. */
describe("the credential modal", () => {
  const term = (over: Partial<OrgCredentialRecord> = {}): OrgCredentialRecord => ({
    id: "R1",
    credentialId: "C2",
    issuer: "QBE",
    number: "PL-9",
    cover: "Public and products liability",
    sumInsured: 20_000_000,
    premium: 2400,
    excess: 500,
    workersCount: null,
    wages: null,
    startsOn: "2025-08-07",
    expiresOn: "2026-08-07",
    documentId: null,
    source: "manual",
    createdAt: "2025-08-01T00:00:00.000Z",
    ...over,
  });

  it("adds one from the tile", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ credentials: [] });

    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Working at Heights");
    await user.click(within(dialog).getByRole("button", { name: "Add card" }));

    expect(actions.onAddCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "licence", name: "Working at Heights" }),
      // nothing was scanned, so the card is born without a term
      undefined
    );
    // it saved, so it closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a card on the term in force, with its facts and its history", async () => {
    const user = userEvent.setup();
    setup({
      records: { C2: [term(), term({ id: "R0", expiresOn: "2025-08-07", startsOn: "2024-08-07", premium: 2100 })] },
    });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");

    // the term in force, as the certificate prints it
    expect(within(dialog).getByText("Current policy")).toBeInTheDocument();
    expect(within(dialog).getByText("Public and products liability")).toBeInTheDocument();
    expect(within(dialog).getByText("$20m")).toBeInTheDocument();
    expect(within(dialog).getByText("7 Aug 2026")).toBeInTheDocument();

    // and the one before it, which the old modal would have destroyed
    const history = within(dialog).getByText("Policy history").closest(".rcw-grp") as HTMLElement;
    expect(within(history).getByText("7 Aug 2025")).toBeInTheDocument();
    expect(within(history).getByText("$2,100")).toBeInTheDocument();
  });

  it("records a renewal as a NEW term, never as an edit of the card", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));

    await user.type(within(dialog).getByLabelText("Insurer"), "CGU");
    // no expiry yet: nothing to save
    expect(within(dialog).getByRole("button", { name: "Save policy" })).toBeDisabled();

    // the expiry is picked, never typed — the calendar is the only way in
    await user.click(within(dialog).getByLabelText("Expiry"));
    await user.click(await screen.findByRole("button", { name: "Friday 24 July 2026" }));
    await user.click(within(dialog).getByRole("button", { name: "Save policy" }));

    expect(actions.onRecordTerm).toHaveBeenCalledWith(
      "C2",
      expect.objectContaining({ issuer: "CGU", expiresOn: "2026-07-24", source: "manual" })
    );
    expect(actions.onUpdateCredential).not.toHaveBeenCalled();
  });

  /* FILING A TERM IS ITS OWN SCREEN. It used to unroll as a panel below the
     history, off the bottom of a long modal — pressed, nothing visibly
     happened. Now the card hands over to a screen with a back chevron, and the
     card behind it is gone while you are on it. */
  it("hands over to a screen to file a term, and comes back on the chevron", async () => {
    const user = userEvent.setup();
    setup({ records: { C2: [term()] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("Current policy")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));

    expect(within(dialog).getByText("The new certificate")).toBeInTheDocument();
    expect(within(dialog).queryByText("Current policy")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(within(dialog).getByText("Current policy")).toBeInTheDocument();
  });

  it("renames a card behind the Edit details door, and updates it by id", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));

    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Public liability");
    expect(within(dialog).getByLabelText("Issuer")).toHaveValue("QBE");

    await user.clear(within(dialog).getByLabelText("Number"));
    await user.type(within(dialog).getByLabelText("Number"), "PL-10");
    await user.click(within(dialog).getByRole("button", { name: "Save details" }));

    expect(actions.onUpdateCredential).toHaveBeenCalledWith(
      "C2",
      expect.objectContaining({ kind: "insurance", name: "Public liability", number: "PL-10" })
    );
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });

  /* Once a term owns the number, the issuer and the expiry, the details screen
     stops offering them — they are a cache of the term now, and a blank draft
     saved over them would wipe the very columns the dashboard chip reads. */
  it("stops offering the term's own fields once a term exists", async () => {
    const user = userEvent.setup();
    setup({ records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));

    expect(within(dialog).getByLabelText(/^Name/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Number")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Issuer")).not.toBeInTheDocument();
  });

  it("asks for the expiry with a calendar, never a text box", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));

    // the shared popover picker: a button that opens the drawn calendar —
    // there is nothing to type a date into, well- or ill-formatted
    expect(within(dialog).getByLabelText("Expiry")).toHaveAttribute("type", "button");
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
  });

  it("deletes only once it has asked, in its own dialog", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Edit details/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete card" }));
    expect(actions.onRemoveCredential).not.toHaveBeenCalled();

    const ask = screen.getByRole("dialog", { name: "Delete Public liability?" });
    await user.click(within(ask).getByRole("button", { name: "Delete card" }));
    expect(actions.onRemoveCredential).toHaveBeenCalledWith("C2");
  });

  it("has no Delete when there is nothing yet to delete", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Delete card" })
    ).not.toBeInTheDocument();
  });

  /* THE TYPE IS ASKED BEFORE THE SCANNER. The scan panel picks Tiff's reader,
     the words on the drop zone and the kind the file is stamped with, all from
     whatever Type says at that instant — so a screen that opens on a scanner
     headed "the licence certificate" has already answered for the person
     holding a certificate of currency. It is a segmented control, and it comes
     first in the document. */
  it("asks what it is before it offers the scanner, and the scanner follows", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");

    const type = within(dialog).getByRole("radiogroup", { name: "Type" });
    const scan = within(dialog).getByText(/Scan or upload the/);
    expect(type.compareDocumentPosition(scan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(dialog).getByText("Scan or upload the licence certificate")).toBeInTheDocument();
    await user.click(within(type).getByRole("radio", { name: "Insurance" }));
    expect(
      within(dialog).getByText("Scan or upload the certificate of currency")
    ).toBeInTheDocument();
  });

  /* ONE QUESTION, ASKED ONCE. The term panel asks for the number and the
     issuer itself, so leaving them on the identity card printed "Licence no."
     and "Issued by" twice on one screen with nothing to say which won — and
     the term's copy silently did. */
  /* ONE QUESTION, ASKED ONCE — AND NOT BY HAND. Adding a card asks what it is
     and what to call it; the number and the issuer are what the scan is about
     to hand over, and the term panel asks for them there. They were on the
     identity card too, so with the panel open they appeared twice on one
     screen with nothing to say which won — and the term's copy silently did. */
  it("never asks for the number or the issuer by hand while adding", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByLabelText("Number")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Issuer")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));

    // exactly one of each, and it is the TERM's
    expect(within(dialog).getByLabelText("Licence no.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Issued by")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Number")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Issuer")).not.toBeInTheDocument();
  });

  it("refuses an unnamed credential without calling anything", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");

    // the name is the one thing the card cannot be without, so the button that
    // would save it is not a live button at all
    expect(within(dialog).getByRole("button", { name: "Add card" })).toBeDisabled();
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });

  it("keeps the modal open and says why when the action refuses", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    actions.onAddCredential.mockResolvedValueOnce({ ok: false, error: "Couldn't add that." });

    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "ARC");
    await user.click(within(dialog).getByRole("button", { name: "Add card" }));

    expect(await screen.findByText("Couldn't add that.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Cancel without writing", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });

  

  /* THE MENU CARRIES ITS OWN ANSWER, so what you asked for is legible without
     opening it. Four chips in a card of their own said the same thing with a
     whole panel. */
  /* WHAT THE PAPER CAN CARRY, ON THE SCREEN.

     "Limit of liability" and "Excess" are public-liability facts. A workers
     compensation policy has neither — the employer's liability under the state
     Act is uncapped — so both sat empty on every one of them. That matters
     more than it looks: on a PUBLIC LIABILITY policy an em-dash under LIMIT
     means the business cannot prove the number a head contractor asked for,
     and that reading only survives if a dash is never printed for a fact the
     document was incapable of carrying. */
  it("does not offer a workers compensation policy a limit or an excess", async () => {
    const user = userEvent.setup();
    const wc: OrgCredential = { ...CREDENTIALS[1], name: "Workers compensation" };
    setup({ credentials: [wc], records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Workers compensation" }));
    const dialog = screen.getByRole("dialog");
    // not in the facts it reads back
    expect(within(dialog).queryByText("Limit")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Excess")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Insurer")).toBeInTheDocument();

    // nor in the boxes it asks for
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).queryByLabelText("Limit of liability ($)")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Excess ($)")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Insurer")).toBeInTheDocument();
  });

  /* THE TWO NUMBERS THE CERTIFICATE ITSELF TELLS PRINCIPALS TO CHECK. icare's
     "Important information" block asks a head contractor to compare the number
     of workers on site to the number estimated, and to judge whether the wages
     cover the labour component of the work. Isaac's certificate prints 11 and
     $943,669.32, and until now the app filed the PDF and threw both away. */
  it("gives a workers compensation policy the two figures it does carry", async () => {
    const user = userEvent.setup();
    const wc: OrgCredential = { ...CREDENTIALS[1], name: "Workers compensation" };
    setup({
      credentials: [wc],
      records: { C2: [term({ workersCount: 11, wages: 943_669.32 })] },
    });

    await user.click(screen.getByRole("button", { name: "Workers compensation" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Workers")).toBeInTheDocument();
    expect(within(dialog).getByText("11")).toBeInTheDocument();
    expect(within(dialog).getByText("Wages")).toBeInTheDocument();
    expect(within(dialog).getByText("$943,669")).toBeInTheDocument();

    // and the boxes to type them into, when the scan did not
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).getByLabelText("Workers covered")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Wages declared ($)")).toBeInTheDocument();
  });

  /* The cover wording on a workers comp certificate is boilerplate — every NSW
     one recites the same statutory liability — and the line that varies, and
     that the certificate tells principals to confirm, is the industry
     classification the premium is rated under. So the box keeps the column and
     takes the name worth typing into it. */
  it("calls the cover box what that paper calls it", async () => {
    const user = userEvent.setup();
    const wc: OrgCredential = { ...CREDENTIALS[1], name: "Workers compensation" };
    setup({ credentials: [wc], records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Workers compensation" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Industry classification")).toBeInTheDocument();
    expect(within(dialog).queryByText("Cover")).not.toBeInTheDocument();
  });

  it("offers a public liability policy neither figure", async () => {
    const user = userEvent.setup();
    setup({ records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText("Workers")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Wages")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Cover")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).queryByLabelText("Workers covered")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Wages declared ($)")).not.toBeInTheDocument();
  });

  it("still offers them to the policy that prints them", async () => {
    const user = userEvent.setup();
    setup({ records: { C2: [term()] } });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Limit")).toBeInTheDocument();
    expect(within(dialog).getByText("Excess")).toBeInTheDocument();
  });

  /* A HEADING, A BORDER AND A SHADOW SPENT ON THE ABSENCE OF A THING. A card
     holding its first term showed a full-width POLICY HISTORY panel whose only
     content was "No previous policy terms recorded". */
  /* NO REMIND ME. The per-card button was the only door into the morning
     email and the only door into the bell for a licence — a button doing the
     job a setting should. The org's expiry window nudges now (lib/expiry.ts);
     Tiff's "remind me Monday" tasks are a separate feature. */
  it("offers no Remind me on a card — the org's expiry window nudges instead", async () => {
    const user = userEvent.setup();
    setup({ records: { C2: [term()] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Remind me/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("menuitemcheckbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/days before/)).not.toBeInTheDocument();
    // the one button that changes anything is still there
    expect(within(dialog).getByRole("button", { name: "Update policy" })).toBeInTheDocument();
  });

  it("shows no history panel until there is history", async () => {
    const user = userEvent.setup();
    const { unmount } = setup({ records: { C2: [term()] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    expect(within(screen.getByRole("dialog")).queryByText("Policy history")).not.toBeInTheDocument();
    unmount();

    setup({ records: { C2: [term(), term({ id: "R0", expiresOn: "2025-08-07" })] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    expect(within(screen.getByRole("dialog")).getByText("Policy history")).toBeInTheDocument();
  });

});

/* The address, which is FOUR fields and one lookup.

   This is the surface where autocomplete earns its keep: pick the address once
   and suburb, state and postcode fill themselves — including the state, which
   also picks the org's public-holiday calendar. The street box keeps the STREET
   line, not the whole formatted address, or the suburb would be printed twice
   on the same card.

   `fetch` is mocked for these tests and the only URL it may see is our own
   /api/address; the key lives on the server and has no way into this file. */
describe("the address", () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  const SUGGESTION = { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" };
  const PARTS = { address: "12 Trade St", suburb: "Ringwood", state: "VIC", postcode: "3134" };
  const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { op } = JSON.parse(init.body);
      if (op === "suggest")
        return Promise.resolve(jsonOk({ enabled: true, suggestions: [SUGGESTION] }));
      return Promise.resolve(
        jsonOk({ enabled: true, formatted: SUGGESTION.text, parts: PARTS })
      );
    });
  });

  // The Contact group names its own Edit, so this finds it among the Company
  // tab's three groups without counting down the page.
  const openContact = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Edit contact" }));
  const saveContact = () => screen.getByRole("button", { name: /Save/ });

  const blank = {
    org: { address: null, suburb: null, state: null, postcode: null },
  };

  it("is four plain boxes when no key is configured", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: false });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade Street");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(saveContact());
    expect(actions.onSave).toHaveBeenCalledWith(
      "contact",
      expect.objectContaining({ address: "12 Trade Street" })
    );
  });

  it("fills suburb, state and postcode from one pick", async () => {
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));

    await waitFor(() => expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood"));
    // the State chooser, so the holiday calendar follows — a code it can show
    expect(screen.getByLabelText(/^State/)).toHaveTextContent("VIC");
    expect(screen.getByLabelText("Postcode")).toHaveValue("3134");
  });

  it("keeps the street line in the street box, not the whole address", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));

    await waitFor(() => expect(screen.getByLabelText("Street address")).toHaveValue("12 Trade St"));

    await user.click(saveContact());
    expect(actions.onSave).toHaveBeenCalledWith("contact", expect.objectContaining(PARTS));
  });

  /* A suburb-level match has no street number and no route, and an empty
     street box would be a worse answer than the line the person picked. */
  it("falls back to the formatted line when Google had no street", async () => {
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { op } = JSON.parse(init.body);
      if (op === "suggest")
        return Promise.resolve(
          jsonOk({ enabled: true, suggestions: [{ placeId: "P2", text: "Ringwood VIC, Australia" }] })
        );
      return Promise.resolve(
        jsonOk({
          enabled: true,
          formatted: "Ringwood VIC, Australia",
          parts: { address: "", suburb: "Ringwood", state: "VIC", postcode: "" },
        })
      );
    });
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "Ringwood");
    await screen.findByRole("listbox");
    await user.click(screen.getByText("Ringwood VIC, Australia"));

    await waitFor(() =>
      expect(screen.getByLabelText("Street address")).toHaveValue("Ringwood VIC, Australia")
    );
    expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood");
  });

  it("still lets an address be typed in full, and typed over afterwards", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));
    await waitFor(() => expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood"));

    // Google's answer is a starting point, not a lock
    await user.clear(screen.getByLabelText("Street address"));
    await user.type(screen.getByLabelText("Street address"), "Unit 9, 12 Trade St");
    await user.click(saveContact());

    expect(actions.onSave).toHaveBeenCalledWith(
      "contact",
      expect.objectContaining({ address: "Unit 9, 12 Trade St", suburb: "Ringwood", state: "VIC" })
    );
  });

  it("only ever talks to our own proxy", async () => {
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    for (const [url] of fetchMock.mock.calls) expect(url).toBe("/api/address");
  });
});

/* The logo, which used to be a tile reading "Coming soon — needs document
   storage". It saves itself the moment a file is chosen, because the thing you
   are looking at is the confirmation. */
describe("the logo", () => {
  const file = () => new File(["x"], "logo.png", { type: "image/png" });

  beforeEach(() => uploadFile.mockReset());

  /* THE BUG THIS SCREEN SHIPPED WITH. The uploader was the last field of an
     identity EDIT form, so reading the page showed no logo and no control — the
     feature was indistinguishable from missing. Nothing here may press Edit
     first. */
  it("is on the screen in read mode, with no Edit pressed", () => {
    const { container } = setup();
    expect(container.querySelector(".orglogo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload a logo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Company logo")).toBeInTheDocument();
  });

  it("uploads as an org_logo and points the org at what came back", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { actions } = setup();

    await user.upload(screen.getByLabelText("Company logo"), file());

    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "org_logo");
    expect(actions.onSetLogo).toHaveBeenCalledWith("doc-9", null);
  });

  it("says what went wrong instead of pretending it saved", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: false, error: "That file is too big — 10 MB is the limit." });
    const { actions } = setup();

    await user.upload(screen.getByLabelText("Company logo"), file());

    expect(
      await screen.findByText("That file is too big — 10 MB is the limit.")
    ).toBeInTheDocument();
    expect(actions.onSetLogo).not.toHaveBeenCalled();
  });

  /* A pale logo on a white thumbnail is not there. The thumbnail sits on the dark
     the logo would get on a document, so what you are looking at is what prints. */
  it("sits a pale logo's thumbnail on a dark ground", () => {
    const { container } = setup({
      logoUrl: "https://signed.example/logo.png",
      org: { logo_tone: "light" },
    });
    expect(container.querySelector(".orglogo-thumb")).toHaveClass("dark");
  });

  it("leaves a dark or unmeasured logo's thumbnail on paper", () => {
    const { container } = setup({ logoUrl: "https://signed.example/logo.png", org: { logo_tone: "dark" } });
    expect(container.querySelector(".orglogo-thumb")).not.toHaveClass("dark");
  });

  it("offers Remove only once there is a logo", async () => {
    const user = userEvent.setup();
    const plain = setup();
    expect(screen.queryByRole("button", { name: "Remove logo" })).not.toBeInTheDocument();
    plain.unmount();

    const withLogo = setup({ logoUrl: "https://signed.example/logo.png" });
    await user.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(withLogo.actions.onClearLogo).toHaveBeenCalled();
  });

  /* A drop bypasses the input's `accept` entirely, so the row re-checks the
     type itself and answers without a round trip. */
  it("refuses a dropped non-image without uploading it", () => {
    const { container } = setup();
    const tile = container.querySelector(".orglogo")!;
    const pdf = new File(["x"], "quote.pdf", { type: "application/pdf" });

    fireEvent.drop(tile, { dataTransfer: { files: [pdf] } });

    expect(screen.getByText("That's not an image — PNG, JPG or WEBP.")).toBeInTheDocument();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("uploads an image that was dropped on the row", async () => {
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-4" } });
    const { container, actions } = setup();
    const tile = container.querySelector(".orglogo")!;

    fireEvent.drop(tile, { dataTransfer: { files: [file()] } });

    await waitFor(() => expect(actions.onSetLogo).toHaveBeenCalledWith("doc-4", null));
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "org_logo");
  });
});

describe("the account", () => {
  it("says who holds it", () => {
    setup();
    expect(within(group("Account")).getByText("Isaac Smith")).toBeInTheDocument();
  });

  it("says so when the owner is the person reading it", () => {
    const { unmount } = setup();
    expect(screen.queryByText("Isaac Smith (you)")).not.toBeInTheDocument();
    unmount();

    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    expect(screen.getByText("Isaac Smith (you)")).toBeInTheDocument();
  });

  /* A login has an address before it has a name; the row says the address
     rather than a dash for a real person. */
  it("falls back to the email's local part when there is no name", () => {
    setup({ account: { ...ACCOUNT, ownerName: null } });
    expect(within(group("Account")).getByText("isaac")).toBeInTheDocument();
  });

  it("is absent entirely when the caller had no session to resolve it", () => {
    setup({ account: null });
    expect(screen.queryByRole("heading", { level: 2, name: "Account" })).not.toBeInTheDocument();
  });
});

/* HANDING THE ACCOUNT OVER — the one master-only act on this screen.

   It is the only control on the Account tab, and it exists because
   `primary_owner_user_id` was written once at first login and never again:
   the card stated who held the account with no way to change it, which is
   how Isaac found it ("it doesn't look like i can change the org owner").

   Three things this suite is really pinning: the button belongs to the MASTER
   and nobody else, picking is not committing, and the consequence is on screen
   before the button that causes it. */
describe("handing the account over", () => {
  const openHandover = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole("button", { name: "Hand over the account" }));

  it("offers the handover to the master owner", () => {
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    expect(screen.getByRole("button", { name: /Hand over/ })).toBeInTheDocument();
  });

  /* A co-owner is a full owner everywhere else on this screen — they edit the
     ABN, the address, the licences. The page passes no action for them, so the
     control is not rendered rather than rendered-and-refused. */
  it("does not offer it to a co-owner", () => {
    setup({ onTransferOwnership: undefined as unknown as jest.Mock });
    expect(screen.queryByRole("button", { name: /Hand over/ })).not.toBeInTheDocument();
  });

  /* Reading someone else's ownership is not the same as holding it: the master
     flag is what the button hangs off, not the action alone. */
  it("does not offer it while someone else holds the account", () => {
    setup({ account: { ...ACCOUNT, ownerIsYou: false } });
    expect(screen.queryByRole("button", { name: /Hand over/ })).not.toBeInTheDocument();
  });

  it("opens no dialog until it is asked for", () => {
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists everyone else with a login, and says what each of them is today", async () => {
    const user = userEvent.setup();
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Liv Nguyen")).toBeInTheDocument();
    expect(within(dialog).getByText("sam@smithair.com.au")).toBeInTheDocument();
    expect(within(dialog).getByText("Admin")).toBeInTheDocument();
    expect(within(dialog).getByText("Co-owner")).toBeInTheDocument();
  });

  /* PICKING IS NOT COMMITTING. The write is the one act on this screen the
     person doing it cannot undo alone — only the new owner can hand it back —
     so a misclick in a list must not be the whole transaction. */
  it("writes nothing when a person is chosen", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);
    await user.click(screen.getByRole("radio", { name: /Liv Nguyen/ }));

    expect(actions.onTransferOwnership).not.toHaveBeenCalled();
  });

  it("cannot be committed before anyone is chosen", async () => {
    const user = userEvent.setup();
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /Hand over the account/ })).toBeDisabled();
  });

  /* The consequence the outgoing owner is actually agreeing to, and the extra
     one that rides along when the person is not already an owner. */
  it("says what it costs, and names the promotion when there is one", async () => {
    const user = userEvent.setup();
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);
    await user.click(screen.getByRole("radio", { name: /Liv Nguyen/ }));

    expect(screen.getByText("Liv Nguyen becomes the account owner.")).toBeInTheDocument();
    expect(screen.getByText(/What you lose is the master’s protection/)).toBeInTheDocument();
    expect(screen.getByText(/Liv Nguyen becomes an owner as part of this/)).toBeInTheDocument();
  });

  /* A co-owner already holds every capability, so handing it to them promotes
     nobody — claiming otherwise would be a warning about nothing. */
  it("claims no promotion when the person is already an owner", async () => {
    const user = userEvent.setup();
    setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);
    await user.click(screen.getByRole("radio", { name: /Sam Reed/ }));

    expect(screen.getByText("Sam Reed becomes the account owner.")).toBeInTheDocument();
    expect(screen.queryByText(/becomes an owner as part of this/)).not.toBeInTheDocument();
  });

  it("hands it over by user id, then closes", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ account: { ...ACCOUNT, ownerIsYou: true } });
    await openHandover(user);
    await user.click(screen.getByRole("radio", { name: /Liv Nguyen/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Hand over the account/ }));

    expect(actions.onTransferOwnership).toHaveBeenCalledWith("auth0|liv");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays open and says why when the server refuses", async () => {
    const user = userEvent.setup();
    const onTransferOwnership = jest
      .fn()
      .mockResolvedValue({ ok: false, error: "Only the account owner can hand the account over." });
    setup({ account: { ...ACCOUNT, ownerIsYou: true }, onTransferOwnership });

    await openHandover(user);
    await user.click(screen.getByRole("radio", { name: /Liv Nguyen/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Hand over the account/ }));

    expect(
      await screen.findByText("Only the account owner can hand the account over.")
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  /* A one-person business is the normal case, not a failure — and the empty
     state has to say what would change it, since "nobody" is a fact about
     logins, not about the staff list. */
  it("says why the list is empty rather than offering an empty one", async () => {
    const user = userEvent.setup();
    setup({ account: { ...ACCOUNT, ownerIsYou: true }, candidates: [] });
    await openHandover(user);

    expect(screen.getByText("There is nobody else signed in")).toBeInTheDocument();
    expect(screen.getByText(/accepted their invite and signed in/)).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Hand over the account/ })).toBeDisabled();
  });
});

/* A CARD THAT CAN NEVER HOLD A TERM STILL HAS TO KEEP ITS CERTIFICATE.

   A term is a PERIOD and expires_on is NOT NULL, so a licence with no renewal
   date on it can hold no term at all. The screen shipped with its only "Add
   document" inside the CURRENT POLICY card, so a card with no expiry — and a
   certificate is exactly the thing a person opens one to keep — had nowhere to
   put it. Everything below fails on that screen.

   C2 is the fixture with `expiryDate: null`. */
describe("filing a document against a card with no expiry", () => {
  const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
    id: "doc-9",
    kind: "org_insurance",
    fileName: "certificate.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    uploadedById: "staff-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    url: "https://signed.example/certificate.pdf",
    image: false,
    policyId: null,
    financeId: null,
    credentialRecordId: null,
    licenceRecordId: null,
    workRightsRecordId: null,
    ...over,
  });

  const file = () => new File(["x"], "certificate.pdf", { type: "application/pdf" });

  beforeEach(() => uploadFile.mockReset());

  it("offers the door on the card itself, where the term card would be", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).queryByText("Current policy")).not.toBeInTheDocument();
    expect(within(dialog).getByText("Documents")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Add document")).toBeInTheDocument();
  });

  /* The card OWNS it; nothing owns the filing. That null is the whole fix —
     documents.credential_record_id has always been allowed to be one, and
     looseDocuments already reads exactly those rows back. */
  it("files the upload against the CARD, under no term", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    await user.upload(within(screen.getByRole("dialog")).getByLabelText("Add document"), file());

    // the kind is the ownership guard: an insurance card files org_insurance
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "org_insurance");
    expect(actions.onAttachCredentialDoc).toHaveBeenCalledWith("C2", null, "doc-9");
  });

  it("lists what has been filed against it", async () => {
    const user = userEvent.setup();
    setup({ documents: { C2: [doc()] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/certificate\.pdf/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/No paperwork filed/)).not.toBeInTheDocument();
  });

  it("says plainly when nothing has been filed yet", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    expect(
      within(screen.getByRole("dialog")).getByText("No paperwork filed against this card yet.")
    ).toBeInTheDocument();
  });

  it("files nothing when the upload itself refuses", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: false, error: "That upload didn't finish." });
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    await user.upload(within(screen.getByRole("dialog")).getByLabelText("Add document"), file());
    expect(actions.onAttachCredentialDoc).not.toHaveBeenCalled();
  });

  /* And the term's own door is untouched: ONE "Add document" on a screen that
     has a term, and it names that term. Two would be a question the person
     shouldn't have to answer. */
  it("still files under the term in force, when there is one", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { actions } = setup({
      records: {
        C2: [
          {
            id: "R1",
            credentialId: "C2",
            issuer: "QBE",
            number: "PL-9",
            cover: null,
            sumInsured: null,
            premium: null,
            workersCount: null,
            wages: null,
            excess: null,
            startsOn: null,
            expiresOn: "2026-08-07",
            documentId: null,
            source: "manual",
            createdAt: null,
          },
        ],
      },
    });

    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByLabelText("Add document")).toHaveLength(1);

    await user.upload(within(dialog).getByLabelText("Add document"), file());
    expect(actions.onAttachCredentialDoc).toHaveBeenCalledWith("C2", "R1", "doc-9");
  });
});

/* ADDING A CARD BY SCANNING A CERTIFICATE WITH NO EXPIRY ON IT.

   The panel used to send what it read only when there was an expiry, so a
   licence with no renewal date was saved without the certificate that had
   already been uploaded, or the number and issuer read off it. It all goes
   with the save now, and the action decides whether it is a term. */
describe("adding a card by scanning it", () => {
  beforeEach(() => {
    uploadFile.mockReset();
    readOrgCredentialDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
    readOrgCredentialDocument.mockResolvedValue({
      ok: true,
      issuer: "VBA",
      number: "CL-12345",
      cover: null,
      sumInsured: null,
      premium: null,
      excess: null,
      workersCount: null,
      wages: null,
      startsOn: "2020-01-01",
      expiresOn: null,
    });
  });

  it("sends the certificate and what was read, with no expiry on it", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ credentials: [] });

    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Contractor licence");
    await user.upload(
      within(dialog).getByLabelText("Scan document"),
      new File(["x"], "licence.pdf", { type: "application/pdf" })
    );
    await within(dialog).findByText("Read from the certificate");
    await user.click(within(dialog).getByRole("button", { name: "Add card" }));

    expect(actions.onAddCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "licence", name: "Contractor licence" }),
      expect.objectContaining({
        number: "CL-12345",
        issuer: "VBA",
        expiresOn: "",
        documentId: "doc-7",
        source: "scan",
      })
    );
  });
});

/* SCANNING A CERTIFICATE THAT HAS NO EXPIRY, ON THE UPDATE SCREEN.

   Tiff reads it, but a licence with no renewal date has no expiry to read, so
   the Save button could never be pressed — and the file the panel had ALREADY
   uploaded sat in state that only a saved term consumes: owned by nothing,
   shown nowhere. The button files it against the card now, and says so.
   C2 is the fixture with `expiryDate: null`. */
describe("scanning a certificate with no expiry on the update screen", () => {
  const pdf = () => new File(["x"], "certificate.pdf", { type: "application/pdf" });

  beforeEach(() => {
    uploadFile.mockReset();
    readOrgCredentialDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
    readOrgCredentialDocument.mockResolvedValue({
      ok: true,
      issuer: "QBE",
      number: "PL-9",
      cover: null,
      sumInsured: null,
      premium: null,
      excess: null,
      workersCount: null,
      wages: null,
      startsOn: "2020-01-01",
      expiresOn: null,
    });
  });

  const scanOnUpdate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("Read from the certificate");
    return dialog;
  };

  it("files the uploaded certificate against the card instead of dead-ending", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    const dialog = await scanOnUpdate(user);
    expect(within(dialog).queryByRole("button", { name: "Save policy" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    // the card owns it; nothing owns the filing — and no term was invented
    expect(actions.onAttachCredentialDoc).toHaveBeenCalledWith("C2", null, "doc-7", { number: "PL-9", issuer: "QBE" });
    expect(actions.onRecordTerm).not.toHaveBeenCalled();
  });

  it("goes back to the card once it has landed", async () => {
    const user = userEvent.setup();
    setup();

    const dialog = await scanOnUpdate(user);
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    expect(await within(dialog).findByRole("button", { name: "Update policy" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Read from the certificate")).not.toBeInTheDocument();
  });

  it("keeps the certificate when the filing is refused, so pressing again is a retry", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    actions.onAttachCredentialDoc.mockResolvedValueOnce({ ok: false, error: "That document couldn't be filed." });

    const dialog = await scanOnUpdate(user);
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));

    expect(await within(dialog).findByText("That document couldn't be filed.")).toBeInTheDocument();
    expect(within(dialog).getByText("Read from the certificate")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "File the document" }));
    expect(actions.onAttachCredentialDoc).toHaveBeenCalledTimes(2);
  });

  /* The footnote says the term in force "moves into the history". Filing a
     document moves nothing, so while the button is filing it must not say so. */
  it("does not promise to retire the term in force when it is only filing", async () => {
    const user = userEvent.setup();
    setup({
      records: {
        C2: [
          {
            id: "R1",
            credentialId: "C2",
            issuer: "QBE",
            number: "PL-9",
            cover: null,
            sumInsured: null,
            premium: null,
            workersCount: null,
            wages: null,
            excess: null,
            startsOn: null,
            expiresOn: "2026-08-07",
            documentId: null,
            source: "manual",
            createdAt: null,
          },
        ],
      },
    });

    const dialog = await scanOnUpdate(user);
    expect(within(dialog).getByRole("button", { name: "File the document" })).toBeInTheDocument();
    expect(within(dialog).queryByText(/moves into the history/)).not.toBeInTheDocument();
  });

  it("still has nothing to press with neither an expiry nor a document", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).getByRole("button", { name: "Save policy" })).toBeDisabled();
  });
});

/* THE BUTTON SAYS WHEN IT NEEDS AN EXPIRY — the business side of the same
   rule, now the star has gone with v2's fields: a certificate waiting on the
   update screen is filed without an expiry, and adding a card never needs one. */
describe("the expiry, when the button needs one", () => {
  const pdf = () => new File(["x"], "certificate.pdf", { type: "application/pdf" });

  beforeEach(() => {
    uploadFile.mockReset();
    readOrgCredentialDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
    readOrgCredentialDocument.mockResolvedValue({
      ok: true,
      issuer: "QBE",
      number: "PL-9",
      cover: null,
      sumInsured: null,
      premium: null,
      excess: null,
      workersCount: null,
      wages: null,
      startsOn: null,
      expiresOn: null,
    });
  });

  const openUpdate = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    return dialog;
  };

  it("holds Save on the update screen while only a term can be saved", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openUpdate(user);
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).getByRole("button", { name: "Save policy" })).toBeDisabled();
  });

  it("files a waiting certificate without one", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openUpdate(user);
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("Read from the certificate");
    expect(within(dialog).getByRole("button", { name: "File the document" })).toBeEnabled();
  });

  it("never needs one while adding a card", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "ARC");
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(within(dialog).getByRole("button", { name: "Add card" })).toBeEnabled();
  });
});

/* WHAT A DAILY USER READS ON A BUSINESS CARD — the 2026-09-14 review. The line
   under the status said "Nothing filed against this card yet" beside a
   certificate listed under Documents, and "term" was still on the screen. */
describe("the words on a business card", () => {
  const doc = (over: Partial<StoredDocument> = {}): StoredDocument => ({
    id: "doc-9",
    kind: "org_insurance",
    fileName: "certificate.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2048,
    uploadedById: "staff-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    url: "https://signed.example/certificate.pdf",
    image: false,
    policyId: null,
    financeId: null,
    credentialRecordId: null,
    licenceRecordId: null,
    workRightsRecordId: null,
    ...over,
  });
  const record = (over: Partial<OrgCredentialRecord> = {}): OrgCredentialRecord => ({
    id: "R1",
    credentialId: "C2",
    issuer: "QBE",
    number: "PL-9",
    cover: null,
    sumInsured: null,
    premium: null,
    excess: null,
    workersCount: null,
    wages: null,
    startsOn: "2025-08-07",
    expiresOn: "2026-08-07",
    documentId: null,
    source: "manual",
    createdAt: "2025-08-01T00:00:00.000Z",
    ...over,
  });

  /* Every text node, joined with a space. `textContent` glues neighbouring
     elements together — "no term" beside a file name reads "termwhite-card",
     which a word boundary never matches — and a sweep that cannot see the word
     guards nothing. Seen passing with "Filed under no term" put back. */
  const words = (el: HTMLElement) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out: string[] = [];
    while (walk.nextNode()) out.push(walk.currentNode.textContent ?? "");
    return out.join(" ");
  };

  it("says what is on file once a certificate is filed against a card with no term", async () => {
    const user = userEvent.setup();
    setup({ documents: { C2: [doc()] } });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("1 document filed against this card")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nothing filed against this card yet")).not.toBeInTheDocument();
  });

  it("never says term, and asks in a dialog rather than on a second click", async () => {
    const user = userEvent.setup();
    setup({
      records: { C2: [record(), record({ id: "R0", expiresOn: "2025-06-30", startsOn: "2024-07-01" })] },
      documents: { C2: [doc()] },
    });
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");

    const history = within(dialog).getByText("Policy history").closest(".rcw-grp") as HTMLElement;
    await user.click(within(history).getByRole("button", { name: "Open" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove from history" }));
    // it asks once, in its own dialog, without the word
    const ask = screen.getByRole("dialog", { name: "Remove this policy from the history?" });
    expect(words(ask)).not.toMatch(/\bterms?\b/i);
    await user.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(within(dialog).getByText("Other documents")).toBeInTheDocument();
    expect(words(dialog)).not.toMatch(/\bterms?\b/i);

    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.click(within(dialog).getByRole("button", { name: "Enter it by hand" }));
    expect(dialog.textContent).toMatch(/The policy expiring/);
    expect(words(dialog)).not.toMatch(/\bterms?\b/i);
  });
});

/* A SCAN IN PROGRESS OUTLIVES A STRAY ESCAPE — the business side: adding a
   card, and the update screen, which Escape used to leave for the card behind
   it with the scan gone. */
describe("a scan in progress survives Escape", () => {
  const pdf = () => new File(["x"], "certificate.pdf", { type: "application/pdf" });

  beforeEach(() => {
    uploadFile.mockReset();
    readOrgCredentialDocument.mockReset();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
    readOrgCredentialDocument.mockResolvedValue({
      ok: true,
      issuer: "QBE",
      number: "PL-9",
      cover: null,
      sumInsured: null,
      premium: null,
      excess: null,
      workersCount: null,
      wages: null,
      startsOn: null,
      expiresOn: null,
    });
  });

  it("keeps the add window and the scan when Escape is pressed", async () => {
    const user = userEvent.setup();
    setup({ credentials: [] });
    await user.click(screen.getByRole("button", { name: "Add a licence or policy" }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("Read from the certificate");
    await user.keyboard("{Escape}");
    expect(within(screen.getByRole("dialog")).getByText("Read from the certificate")).toBeInTheDocument();
    const scrim = document.querySelector(".pt-scrim") as HTMLElement;
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("stays on the update screen with the scan when Escape is pressed", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.upload(within(dialog).getByLabelText("Scan document"), pdf());
    await within(dialog).findByText("Read from the certificate");
    await user.keyboard("{Escape}");
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "File the document" })).toBeInTheDocument();
  });

  it("still goes back to the card on Escape when nothing has been scanned", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update policy" }));
    await user.keyboard("{Escape}");
    expect(await within(screen.getByRole("dialog")).findByRole("button", { name: "Update policy" })).toBeInTheDocument();
  });
});
